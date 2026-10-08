import json
import os
import uuid

from flask import Blueprint, request, jsonify, session
from werkzeug.utils import secure_filename

from . import fanty_game as fg
from .db import get_db
from .rooms_common import (
    RoomError,
    UPLOAD_DIR,
    ALLOWED_IMAGE_EXT,
    clean_str,
    get_room_or_404,
    get_player_or_404,
    player_public,
    create_room_and_host,
    add_player,
    resize_and_save_image,
)

fanty_bp = Blueprint("fanty", __name__, url_prefix="/api/fanty")

MAX_TEXT_LEN = 300


def error(message, status=400):
    return jsonify({"error": message}), status


def _room_or_404(db, code):
    room = get_room_or_404(db, code)
    if not room or room["game_type"] != "fanty":
        return None
    return room


@fanty_bp.route("/rooms", methods=["POST"])
def create_room():
    data = request.get_json(silent=True) or {}
    device_mode = data.get("deviceMode") if data.get("deviceMode") in ("remote", "local") else "remote"
    game_mode = data.get("gameMode")
    if game_mode not in fg.GAME_MODES:
        return error("Выберите режим игры")
    location = data.get("location")
    if location not in fg.LOCATIONS:
        return error("Выберите место игры")
    categories = [c for c in (data.get("categories") or []) if c in fg.CATEGORIES]
    if not categories:
        return error("Выберите хотя бы один тип фантов")
    pick_mode = data.get("pickMode") if data.get("pickMode") in fg.PICK_MODES else "fair"
    pair_mode = data.get("pairMode") if data.get("pairMode") in fg.PAIR_MODES else "any"

    gender = data.get("gender") if data.get("gender") in ("m", "f") else None
    if game_mode == "team" and pair_mode == "mixed" and gender is None:
        return error("Выберите пол")

    db = get_db()
    dare_count, truth_count = fg.content_pool_sizes(db, game_mode, location, categories, pair_mode)
    if game_mode == "truth_or_dare" and dare_count == 0 and truth_count == 0:
        return error("Для этих настроек нет ни одного фанта или вопроса — измените место или категории")
    if game_mode != "truth_or_dare" and dare_count == 0:
        return error("Для этих настроек нет ни одного фанта — измените место или категории")

    try:
        room_id, code, token, player_id = create_room_and_host(
            db,
            "fanty",
            data.get("name"),
            data.get("avatarType"),
            data.get("avatarValue"),
            device_mode,
            created_by_user_id=session.get("user_id"),
            gender=gender,
        )
    except RoomError as e:
        return error(e.message, e.status)

    db.execute(
        "INSERT INTO fanty_settings (room_id, game_mode, location, categories, pick_mode, pair_mode) VALUES (?, ?, ?, ?, ?, ?)",
        (room_id, game_mode, location, json.dumps(categories), pick_mode, pair_mode),
    )
    fg.init_state(db, room_id, player_id)
    db.commit()
    return jsonify({"code": code, "token": token, "playerId": player_id})


@fanty_bp.route("/rooms/<code>/local-players", methods=["POST"])
def add_local_player(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    host = get_player_or_404(db, room["id"], data.get("token"))
    if not host or not host["is_host"]:
        return error("Только хост может добавлять локальных игроков")
    if room["device_mode"] != "local":
        return error("Добавление игроков доступно только в локальном режиме")
    if room["status"] != "lobby":
        return error("Игра уже началась")

    settings = fg.get_settings(db, room["id"])
    gender = data.get("gender") if data.get("gender") in ("m", "f") else None
    if fg.gender_required(settings) and gender is None:
        return error("Выберите пол")

    try:
        _token, player_id = add_player(
            db, room, data.get("name"), data.get("avatarType"), data.get("avatarValue"), gender=gender
        )
    except RoomError as e:
        return error(e.message, e.status)
    db.commit()
    return jsonify({"ok": True, "playerId": player_id})


@fanty_bp.route("/rooms/<code>/start", methods=["POST"])
def start_room(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player or not player["is_host"]:
        return error("Только хост может начать игру")
    if room["status"] != "lobby":
        return error("Игра уже началась")
    active = fg.get_active_players(db, room["id"])
    settings = fg.get_settings(db, room["id"])
    min_players = fg.min_players_for(settings["game_mode"])
    if len(active) < min_players:
        return error(f"Нужно минимум {min_players} игрока(ов)")
    if fg.gender_required(settings) and not fg.has_both_genders(active):
        return error("Нужен хотя бы один игрок каждого пола")
    fg.start_game(db, room)
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/spin", methods=["POST"])
def spin(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    if room["status"] != "playing":
        return error("Игра не идёт")
    state = fg.get_state(db, room["id"])
    if state["phase"] != "ready_to_spin":
        return error("Сейчас нельзя крутить бутылку")
    if not fg.can_spin(room, state, player):
        return error("Сейчас не ваша очередь крутить бутылку")
    fg.spin_main(db, room)
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/choose", methods=["POST"])
def choose(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    state = fg.get_state(db, room["id"])
    if state["phase"] != "awaiting_choice":
        return error("Сейчас нельзя выбирать")
    if not fg.can_act_as_picked(room, state, player):
        return error("Выбор может сделать только выпавший игрок")
    choice = data.get("choice")
    if choice not in ("truth", "action"):
        return error("Некорректный выбор")
    fg.choose_truth_or_action(db, room, choice)
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/start-performance", methods=["POST"])
def start_performance(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    state = fg.get_state(db, room["id"])
    if state["phase"] != "awaiting_action":
        return error("Сейчас нельзя это начать")
    if not fg.can_act_as_picked(room, state, player):
        return error("Начать может только выполняющий фант")
    fg.start_performance(db, room)
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/spin-partner", methods=["POST"])
def spin_partner(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    state = fg.get_state(db, room["id"])
    if state["phase"] != "awaiting_partner_spin":
        return error("Сейчас нельзя крутить бутылку для напарника")
    if not fg.can_act_as_picked(room, state, player):
        return error("Крутить может только выпавший игрок")
    fg.spin_partner(db, room)
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/resolve", methods=["POST"])
def resolve(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player or not player["is_host"]:
        return error("Только хост может подтвердить выполнение")
    state = fg.get_state(db, room["id"])
    if state["phase"] != "awaiting_action":
        return error("Сейчас нечего засчитывать")
    counted = bool(data.get("counted"))
    photos = [clean_str(p, 200) for p in (data.get("photoFilenames") or []) if isinstance(p, str)]
    photos = [p for p in photos if p][: fg.MAX_PHOTOS]
    fg.resolve_round(db, room, counted, photos)
    return jsonify({"ok": True})


MAX_ROUND_PHOTO_DIMENSION = 1600
ROUND_PHOTO_THUMB_DIMENSION = 240


@fanty_bp.route("/rooms/<code>/upload-photo", methods=["POST"])
def upload_photo(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    file = request.files.get("file")
    if not file or not file.filename:
        return error("Файл не передан")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_IMAGE_EXT:
        return error("Недопустимый формат файла")
    base = uuid.uuid4().hex
    filename = f"{base}.{ext}"
    # Thumb filename follows a fixed "<base>_thumb.<ext>" convention — the
    # frontend derives it from the full filename by string replacement, so
    # there's no need to track it separately in the DB or the API response.
    thumb_filename = f"{base}_thumb.{ext}"
    dest = os.path.join(UPLOAD_DIR, secure_filename(filename))
    thumb_dest = os.path.join(UPLOAD_DIR, secure_filename(thumb_filename))
    resize_and_save_image(
        file, dest, MAX_ROUND_PHOTO_DIMENSION, thumb_path=thumb_dest, thumb_dimension=ROUND_PHOTO_THUMB_DIMENSION
    )
    return jsonify({"filename": filename})


@fanty_bp.route("/rooms/<code>/end", methods=["POST"])
def end_room(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player or not player["is_host"]:
        return error("Только хост может завершить игру")
    db.execute("UPDATE rooms SET status = 'finished' WHERE id = ?", (room["id"],))
    db.commit()
    return jsonify({"ok": True})


@fanty_bp.route("/rooms/<code>/discard", methods=["POST"])
def discard_room(code):
    # Called when the host leaves the finished-game summary screen — fanty
    # rooms are single-device now, so that's the one clear "we're done"
    # signal. Deletes the room (cascades to rounds/photos rows) and the
    # uploaded round-photo files themselves, so nothing from this party
    # lingers on disk once nobody is looking at the summary any more.
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return jsonify({"ok": True})
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player or not player["is_host"]:
        return error("Только хост может завершить игру")
    if room["status"] != "finished":
        return error("Можно удалить только завершённую игру")

    photo_rows = db.execute(
        """SELECT frp.filename FROM fanty_round_photos frp
           JOIN fanty_rounds fr ON fr.id = frp.round_id
           WHERE fr.room_id = ?""",
        (room["id"],),
    ).fetchall()
    filenames = []
    for row in photo_rows:
        filename = row["filename"]
        base, ext = os.path.splitext(filename)
        filenames.append(filename)
        filenames.append(f"{base}_thumb{ext}")

    db.execute("DELETE FROM rooms WHERE id = ?", (room["id"],))
    db.commit()

    for filename in filenames:
        path = os.path.join(UPLOAD_DIR, secure_filename(filename))
        try:
            os.remove(path)
        except OSError:
            pass

    return jsonify({"ok": True})


@fanty_bp.route("/dares/<int:dare_id>/like", methods=["POST"])
def like_dare(dare_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone():
        return error("Фант не найден", 404)
    db.execute("UPDATE fanty_dares SET likes = likes + 1 WHERE id = ?", (dare_id,))
    db.commit()
    likes = db.execute("SELECT likes FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone()["likes"]
    return jsonify({"likes": likes})


@fanty_bp.route("/truths/<int:truth_id>/like", methods=["POST"])
def like_truth(truth_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone():
        return error("Вопрос не найден", 404)
    db.execute("UPDATE fanty_truths SET likes = likes + 1 WHERE id = ?", (truth_id,))
    db.commit()
    likes = db.execute("SELECT likes FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone()["likes"]
    return jsonify({"likes": likes})


def _build_summary(db, room):
    rounds = db.execute(
        "SELECT * FROM fanty_rounds WHERE room_id = ? ORDER BY round_number", (room["id"],)
    ).fetchall()
    players = {
        p["id"]: p for p in db.execute("SELECT * FROM players WHERE room_id = ?", (room["id"],)).fetchall()
    }

    placeholder = {"name": "?", "gender": None}

    def pname(pid):
        p = players.get(pid)
        return p["name"] if p else "?"

    result = []
    for r in rounds:
        text = None
        if r["content_type"] == "dare":
            row = db.execute("SELECT text FROM fanty_dares WHERE id = ?", (r["dare_id"],)).fetchone()
            text = row["text"] if row else None
            if text and r["partner_player_id"]:
                text = fg.format_team_text(
                    text,
                    players.get(r["picked_player_id"], placeholder),
                    players.get(r["partner_player_id"], placeholder),
                )
        elif r["content_type"] == "truth":
            row = db.execute("SELECT text FROM fanty_truths WHERE id = ?", (r["truth_id"],)).fetchone()
            text = row["text"] if row else None
        photos = db.execute(
            "SELECT filename FROM fanty_round_photos WHERE round_id = ? ORDER BY order_index", (r["id"],)
        ).fetchall()
        result.append(
            {
                "roundNumber": r["round_number"],
                "pickedName": pname(r["picked_player_id"]),
                "partnerName": pname(r["partner_player_id"]) if r["partner_player_id"] else None,
                "choice": r["choice"],
                "contentType": r["content_type"],
                "text": text,
                "counted": bool(r["counted"]),
                "photos": [f"/uploads/{p['filename']}" for p in photos],
            }
        )
    return result


def _build_state(db, room, player):
    players = db.execute(
        "SELECT * FROM players WHERE room_id = ? ORDER BY joined_at", (room["id"],)
    ).fetchall()
    active_count = sum(1 for p in players if not p["is_display"])
    settings = fg.get_settings(db, room["id"])

    state = {
        "room": {"code": room["code"], "status": room["status"], "deviceMode": room["device_mode"]},
        "settings": {
            "gameMode": settings["game_mode"],
            "location": settings["location"],
            "categories": fg.settings_categories(settings),
            "pickMode": settings["pick_mode"],
            "pairMode": settings["pair_mode"],
        },
        "players": [player_public(p) for p in players],
        "me": player_public(player),
        "canStart": room["status"] == "lobby" and active_count >= fg.min_players_for(settings["game_mode"]),
        "minPlayers": fg.min_players_for(settings["game_mode"]),
    }

    if room["status"] == "finished":
        state["summary"] = _build_summary(db, room)
        return state
    if room["status"] != "playing":
        return state

    fstate = fg.get_state(db, room["id"])
    players_by_id = {p["id"]: p for p in players}
    placeholder = {"name": "?", "gender": None}

    can_act = fg.can_act_as_picked(room, fstate, player)

    fanty = {
        "phase": fstate["phase"],
        "roundNumber": fstate["round_number"],
        "nextSpinnerId": fstate["next_spinner_id"],
        "canSpin": fstate["phase"] == "ready_to_spin" and fg.can_spin(room, fstate, player),
    }

    if fstate["phase"] in ("awaiting_choice", "awaiting_partner_spin", "awaiting_action"):
        fanty["pickedPlayerId"] = fstate["current_picked_id"]
        fanty["canAct"] = can_act

    if fstate["phase"] == "awaiting_partner_spin":
        fanty["canSpinPartner"] = can_act

    if fstate["phase"] == "awaiting_action":
        fanty["partnerPlayerId"] = fstate["current_partner_id"]
        fanty["choice"] = fstate["current_choice"]
        text = None
        if fstate["current_content_type"] == "dare":
            row = db.execute(
                "SELECT text, music_filename, has_timer, timer_seconds FROM fanty_dares WHERE id = ?",
                (fstate["current_dare_id"],),
            ).fetchone()
            text = row["text"] if row else None
            if text and fstate["current_partner_id"]:
                text = fg.format_team_text(
                    text,
                    players_by_id.get(fstate["current_picked_id"], placeholder),
                    players_by_id.get(fstate["current_partner_id"], placeholder),
                )
            fanty["musicUrl"] = f"/uploads/{row['music_filename']}" if row and row["music_filename"] else None
            fanty["hasTimer"] = bool(row["has_timer"]) if row else False
            fanty["timerSeconds"] = row["timer_seconds"] if row else None
            fanty["performanceStartedAt"] = fstate["performance_started_at"]
        elif fstate["current_content_type"] == "truth":
            row = db.execute(
                "SELECT text FROM fanty_truths WHERE id = ?", (fstate["current_truth_id"],)
            ).fetchone()
            text = row["text"] if row else None
        fanty["contentType"] = fstate["current_content_type"]
        fanty["contentText"] = text
        fanty["contentId"] = fstate["current_dare_id"] or fstate["current_truth_id"]
        fanty["canResolve"] = bool(player["is_host"])

    state["fanty"] = fanty
    return state


@fanty_bp.route("/rooms/<code>/state", methods=["GET"])
def state(code):
    db = get_db()
    room = _room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    player = get_player_or_404(db, room["id"], request.args.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    return jsonify(_build_state(db, room, player))


@fanty_bp.route("/submit", methods=["POST"])
def submit_content():
    if not session.get("user_id"):
        return error("Предлагать свои фанты могут только зарегистрированные пользователи", 401)

    data = request.get_json(silent=True) or {}
    content_type = data.get("type")
    text = clean_str(data.get("text"), MAX_TEXT_LEN)
    if not text:
        return error("Введите текст")
    categories = [c for c in (data.get("categories") or []) if c in fg.CATEGORIES]
    if not categories:
        return error("Выберите хотя бы одну категорию")

    user_id = session.get("user_id")
    db = get_db()
    if content_type == "dare":
        kind = data.get("kind") if data.get("kind") in ("solo", "team") else "solo"
        locations = [loc for loc in (data.get("locations") or []) if loc in fg.LOCATIONS]
        if not locations:
            return error("Выберите хотя бы одно место")
        if db.execute("SELECT 1 FROM fanty_dares WHERE text = ?", (text,)).fetchone():
            return error("Такой фант уже есть")
        cur = db.execute(
            "INSERT INTO fanty_dares (text, kind, status, created_by_user_id) VALUES (?, ?, 'pending', ?)",
            (text, kind, user_id),
        )
        dare_id = cur.lastrowid
        db.executemany(
            "INSERT OR IGNORE INTO fanty_dare_categories (dare_id, category) VALUES (?, ?)",
            [(dare_id, c) for c in categories],
        )
        db.executemany(
            "INSERT OR IGNORE INTO fanty_dare_locations (dare_id, location) VALUES (?, ?)",
            [(dare_id, loc) for loc in locations],
        )
    elif content_type == "truth":
        if db.execute("SELECT 1 FROM fanty_truths WHERE text = ?", (text,)).fetchone():
            return error("Такой вопрос уже есть")
        cur = db.execute(
            "INSERT INTO fanty_truths (text, status, created_by_user_id) VALUES (?, 'pending', ?)",
            (text, user_id),
        )
        truth_id = cur.lastrowid
        db.executemany(
            "INSERT OR IGNORE INTO fanty_truth_categories (truth_id, category) VALUES (?, ?)",
            [(truth_id, c) for c in categories],
        )
    else:
        return error("Некорректный тип")

    db.commit()
    return jsonify({"ok": True})


@fanty_bp.route("/my-submissions")
def my_submissions():
    user_id = session.get("user_id")
    if not user_id:
        return error("Предлагать свои фанты могут только зарегистрированные пользователи", 401)

    db = get_db()
    dares = db.execute(
        "SELECT id, text, kind, status, created_at FROM fanty_dares WHERE created_by_user_id = ?",
        (user_id,),
    ).fetchall()
    truths = db.execute(
        "SELECT id, text, status, created_at FROM fanty_truths WHERE created_by_user_id = ?",
        (user_id,),
    ).fetchall()

    items = [
        {
            "id": r["id"],
            "type": "dare",
            "text": r["text"],
            "kind": r["kind"],
            "status": r["status"],
            "createdAt": r["created_at"],
        }
        for r in dares
    ] + [
        {"id": r["id"], "type": "truth", "text": r["text"], "status": r["status"], "createdAt": r["created_at"]}
        for r in truths
    ]
    items.sort(key=lambda i: i["createdAt"], reverse=True)
    approved_count = sum(1 for i in items if i["status"] == "active")

    return jsonify({"approvedCount": approved_count, "items": items})

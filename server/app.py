import os
import random
import uuid

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.utils import secure_filename

from . import game
from .db import get_db, close_db, init_db, register_app
from .seed_data import seed_prompts

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_NAME_LEN = 30
MAX_ANSWER_LEN = 300
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no O/0/I/1

os.makedirs(UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
register_app(app)


def _load_secret_key():
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    secret_path = os.path.join(BASE_DIR, ".flask_secret")
    if os.path.exists(secret_path):
        with open(secret_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    key = uuid.uuid4().hex + uuid.uuid4().hex
    with open(secret_path, "w", encoding="utf-8") as f:
        f.write(key)
    return key


app.secret_key = _load_secret_key()

with app.app_context():
    init_db()
    _db = get_db()
    seed_prompts(_db)
    close_db()


def gen_id():
    return str(uuid.uuid4())


def gen_room_code():
    return "".join(random.choice(CODE_ALPHABET) for _ in range(5))


def error(message, status=400):
    return jsonify({"error": message}), status


def clean_str(value, max_len):
    if not isinstance(value, str):
        return ""
    return value.strip()[:max_len]


def get_room_or_404(db, code):
    return db.execute("SELECT * FROM rooms WHERE code = ?", (code.upper(),)).fetchone()


def get_player_or_404(db, room_id, token):
    if not token:
        return None
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND token = ?", (room_id, token)
    ).fetchone()


def player_public(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "avatarType": row["avatar_type"],
        "avatarValue": row["avatar_value"],
        "isHost": bool(row["is_host"]),
        "isDisplay": bool(row["is_display"]),
        "totalScore": row["total_score"],
    }


def _validate_avatar(avatar_type, avatar_value):
    if avatar_type not in ("emoji", "photo"):
        return "emoji", "🙂"
    if avatar_type == "photo":
        path = os.path.join(UPLOAD_DIR, os.path.basename(avatar_value or ""))
        if not avatar_value or not os.path.isfile(path):
            return "emoji", "🙂"
        return "photo", os.path.basename(avatar_value)
    value = (avatar_value or "🙂").strip()
    if not value:
        value = "🙂"
    return "emoji", value[:8]


@app.route("/api/upload-avatar", methods=["POST"])
def upload_avatar():
    file = request.files.get("file")
    if not file or not file.filename:
        return error("Файл не передан")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_IMAGE_EXT:
        return error("Недопустимый формат файла")
    filename = f"{uuid.uuid4().hex}.{ext}"
    file.save(os.path.join(UPLOAD_DIR, secure_filename(filename)))
    return jsonify({"filename": filename})


@app.route("/api/rooms", methods=["POST"])
def create_room():
    data = request.get_json(silent=True) or {}
    name = clean_str(data.get("name"), MAX_NAME_LEN)
    if not name:
        return error("Введите имя")
    avatar_type, avatar_value = _validate_avatar(data.get("avatarType"), data.get("avatarValue"))

    db = get_db()
    for _ in range(10):
        code = gen_room_code()
        if not get_room_or_404(db, code):
            break
    else:
        return error("Не удалось создать комнату, попробуйте ещё раз", 500)

    room_id = gen_id()
    db.execute(
        "INSERT INTO rooms (id, code, status) VALUES (?, ?, 'lobby')", (room_id, code)
    )
    player_id = gen_id()
    token = uuid.uuid4().hex
    db.execute(
        """INSERT INTO players (id, room_id, token, name, avatar_type, avatar_value, is_host)
           VALUES (?, ?, ?, ?, ?, ?, 1)""",
        (player_id, room_id, token, name, avatar_type, avatar_value),
    )
    db.commit()
    return jsonify({"code": code, "token": token, "playerId": player_id})


@app.route("/api/rooms/<code>/taken-emojis", methods=["GET"])
def taken_emojis(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    rows = db.execute(
        """SELECT avatar_value FROM players
           WHERE room_id = ? AND is_display = 0 AND avatar_type = 'emoji'""",
        (room["id"],),
    ).fetchall()
    return jsonify({"taken": [r["avatar_value"] for r in rows]})


@app.route("/api/rooms/<code>/join", methods=["POST"])
def join_room(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)

    data = request.get_json(silent=True) or {}
    is_display = bool(data.get("isDisplay"))
    name = clean_str(data.get("name"), MAX_NAME_LEN) or ("Экран" if is_display else "")
    if not name:
        return error("Введите имя")
    if not is_display and room["status"] != "lobby":
        return error("Игра уже началась, подключиться нельзя")

    avatar_type, avatar_value = _validate_avatar(data.get("avatarType"), data.get("avatarValue"))
    if is_display:
        avatar_type, avatar_value = "emoji", "📺"
    elif avatar_type == "emoji":
        taken = db.execute(
            """SELECT 1 FROM players
               WHERE room_id = ? AND is_display = 0 AND avatar_type = 'emoji' AND avatar_value = ?""",
            (room["id"], avatar_value),
        ).fetchone()
        if taken:
            return error("Этот эмодзи уже выбрал другой игрок, выберите другой")

    player_id = gen_id()
    token = uuid.uuid4().hex
    db.execute(
        """INSERT INTO players (id, room_id, token, name, avatar_type, avatar_value, is_display)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (player_id, room["id"], token, name, avatar_type, avatar_value, int(is_display)),
    )
    db.commit()
    return jsonify({"code": room["code"], "token": token, "playerId": player_id})


def _build_state(db, room, player):
    game.tick(db, room)
    room = db.execute("SELECT * FROM rooms WHERE id = ?", (room["id"],)).fetchone()
    players = db.execute(
        "SELECT * FROM players WHERE room_id = ? ORDER BY joined_at", (room["id"],)
    ).fetchall()
    active_count = sum(1 for p in players if not p["is_display"])

    state = {
        "room": {
            "code": room["code"],
            "status": room["status"],
            "currentRound": room["current_round"],
            "totalRounds": game.TOTAL_ROUNDS,
        },
        "players": [player_public(p) for p in players],
        "me": player_public(player),
        "canStart": room["status"] == "lobby" and active_count >= game.MIN_PLAYERS,
        "minPlayers": game.MIN_PLAYERS,
    }

    if room["status"] == "answering":
        if player["is_display"]:
            active_players = game.get_active_players(db, room["id"])
            players_breakdown = []
            total_answered = 0
            total_needed = 0
            for p in active_players:
                rows = game.player_round_prompts(db, room["id"], room["current_round"], p["id"])
                answered_count = sum(1 for r in rows if r["answered"])
                players_breakdown.append(
                    {
                        "playerId": p["id"],
                        "name": p["name"],
                        "avatarType": p["avatar_type"],
                        "avatarValue": p["avatar_value"],
                        "answered": answered_count,
                        "total": len(rows),
                    }
                )
                total_answered += answered_count
                total_needed += len(rows)
            state["answering"] = {
                "answered": total_answered,
                "total": total_needed,
                "players": players_breakdown,
            }
        else:
            rows = game.player_round_prompts(db, room["id"], room["current_round"], player["id"])
            remaining = [r for r in rows if not r["answered"]]
            current = remaining[0] if remaining else None
            state["answering"] = {
                "currentPrompt": (
                    {"id": current["id"], "text": current["prompt_text"]} if current else None
                ),
                "answeredCount": len(rows) - len(remaining),
                "totalCount": len(rows),
                "waiting": current is None,
            }

    elif room["status"] == "voting":
        rp, total = game.current_voting_round_prompt(db, room)
        if rp is not None:
            prompt_text = db.execute(
                "SELECT text FROM prompts WHERE id = ?", (rp["prompt_id"],)
            ).fetchone()["text"]
            eligible = game.eligible_voter_ids(db, room["id"], rp["group_id"])
            i_can_vote = player["id"] in eligible and not player["is_display"]
            already_voted = bool(
                db.execute(
                    "SELECT 1 FROM votes WHERE round_prompt_id = ? AND voter_player_id = ?",
                    (rp["id"], player["id"]),
                ).fetchone()
            )
            submissions = db.execute(
                """SELECT s.id, s.answer_text,
                          (SELECT COUNT(*) FROM votes v WHERE v.submission_id = s.id) AS votes_count
                   FROM submissions s WHERE s.round_prompt_id = ? ORDER BY s.id""",
                (rp["id"],),
            ).fetchall()
            state["voting"] = {
                "index": room["voting_index"] + 1,
                "total": total,
                "promptText": prompt_text,
                "submissions": [
                    {"id": s["id"], "text": s["answer_text"], "votesCount": s["votes_count"]}
                    for s in submissions
                ],
                "iCanVote": i_can_vote,
                "alreadyVoted": already_voted,
            }

    elif room["status"] == "voting_results":
        rp, total = game.current_voting_round_prompt(db, room)
        if rp is not None:
            prompt_text = db.execute(
                "SELECT text FROM prompts WHERE id = ?", (rp["prompt_id"],)
            ).fetchone()["text"]
            submissions = db.execute(
                "SELECT id, answer_text, points FROM submissions WHERE round_prompt_id = ? ORDER BY points DESC",
                (rp["id"],),
            ).fetchall()
            state["votingResults"] = {
                "index": room["voting_index"] + 1,
                "total": total,
                "promptText": prompt_text,
                "submissions": [
                    {"id": s["id"], "text": s["answer_text"], "points": s["points"]}
                    for s in submissions
                ],
            }

    elif room["status"] == "round_results":
        rows = db.execute(
            """SELECT p.id AS player_id, p.name, p.avatar_type, p.avatar_value,
                      COALESCE(SUM(s.points), 0) AS round_points
               FROM players p
               LEFT JOIN submissions s ON s.player_id = p.id
                   AND s.round_prompt_id IN (
                       SELECT id FROM round_prompts WHERE room_id = ? AND round_number = ?
                   )
               WHERE p.room_id = ? AND p.is_display = 0
               GROUP BY p.id
               ORDER BY round_points DESC""",
            (room["id"], room["current_round"], room["id"]),
        ).fetchall()
        state["roundResults"] = {
            "roundNumber": room["current_round"],
            "roundScores": [
                {
                    "playerId": r["player_id"],
                    "name": r["name"],
                    "avatarType": r["avatar_type"],
                    "avatarValue": r["avatar_value"],
                    "points": r["round_points"],
                }
                for r in rows
            ],
        }

    elif room["status"] == "overall_results":
        leaderboard = db.execute(
            """SELECT id, name, avatar_type, avatar_value, total_score FROM players
               WHERE room_id = ? AND is_display = 0 ORDER BY total_score DESC""",
            (room["id"],),
        ).fetchall()
        state["overallResults"] = {
            "roundNumber": room["current_round"],
            "leaderboard": [
                {
                    "playerId": r["id"],
                    "name": r["name"],
                    "avatarType": r["avatar_type"],
                    "avatarValue": r["avatar_value"],
                    "totalScore": r["total_score"],
                }
                for r in leaderboard
            ],
        }

    elif room["status"] == "final_results":
        leaderboard = db.execute(
            """SELECT id, name, avatar_type, avatar_value, total_score FROM players
               WHERE room_id = ? AND is_display = 0 ORDER BY total_score DESC""",
            (room["id"],),
        ).fetchall()
        state["finalResults"] = {
            "leaderboard": [
                {
                    "playerId": r["id"],
                    "name": r["name"],
                    "avatarType": r["avatar_type"],
                    "avatarValue": r["avatar_value"],
                    "totalScore": r["total_score"],
                }
                for r in leaderboard
            ],
        }

    return state


@app.route("/api/rooms/<code>/state", methods=["GET"])
def room_state(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    player = get_player_or_404(db, room["id"], request.args.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    return jsonify(_build_state(db, room, player))


@app.route("/api/rooms/<code>/start", methods=["POST"])
def start_game(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    if not player["is_host"]:
        return error("Только хост может начать игру")
    if room["status"] != "lobby":
        return error("Игра уже началась")
    active = game.get_active_players(db, room["id"])
    if len(active) < game.MIN_PLAYERS:
        return error(f"Нужно минимум {game.MIN_PLAYERS} игрока(ов)")
    game.start_round(db, room, 1)
    return jsonify({"ok": True})


@app.route("/api/rooms/<code>/next", methods=["POST"])
def advance_room(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    if not player["is_host"]:
        return error("Только хост может продолжить игру")

    if room["status"] == "voting_results":
        game.advance_after_voting_results(db, room)
    elif room["status"] == "round_results":
        game.advance_after_round_results(db, room)
    elif room["status"] == "overall_results":
        game.advance_after_overall_results(db, room)
    else:
        return error("Сейчас нет действия «далее»")
    return jsonify({"ok": True})


@app.route("/api/rooms/<code>/submit", methods=["POST"])
def submit_answer(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    if room["status"] != "answering":
        return error("Сейчас не время отвечать")

    round_prompt_id = data.get("roundPromptId")
    answer_text = clean_str(data.get("answerText"), MAX_ANSWER_LEN)
    if not answer_text:
        return error("Введите ответ")

    rp = db.execute(
        "SELECT * FROM round_prompts WHERE id = ? AND room_id = ? AND round_number = ?",
        (round_prompt_id, room["id"], room["current_round"]),
    ).fetchone()
    if not rp:
        return error("Задание не найдено", 404)
    group_id = game.player_group_id(db, room["id"], room["current_round"], player["id"])
    if group_id != rp["group_id"]:
        return error("Это задание не для вас")
    existing = db.execute(
        "SELECT 1 FROM submissions WHERE round_prompt_id = ? AND player_id = ?",
        (rp["id"], player["id"]),
    ).fetchone()
    if existing:
        return error("Вы уже ответили на это задание")

    db.execute(
        "INSERT INTO submissions (id, round_prompt_id, player_id, answer_text) VALUES (?, ?, ?, ?)",
        (gen_id(), rp["id"], player["id"], answer_text),
    )
    db.commit()
    game.tick(db, room)
    return jsonify({"ok": True})


@app.route("/api/rooms/<code>/vote", methods=["POST"])
def submit_vote(code):
    db = get_db()
    room = get_room_or_404(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    player = get_player_or_404(db, room["id"], data.get("token"))
    if not player:
        return error("Игрок не найден", 404)
    if room["status"] != "voting":
        return error("Сейчас не время голосовать")

    submission_id = data.get("submissionId")
    rp, _total = game.current_voting_round_prompt(db, room)
    if rp is None:
        return error("Голосование завершено")
    submission = db.execute(
        "SELECT * FROM submissions WHERE id = ? AND round_prompt_id = ?",
        (submission_id, rp["id"]),
    ).fetchone()
    if not submission:
        return error("Вариант не найден", 404)
    eligible = game.eligible_voter_ids(db, room["id"], rp["group_id"])
    if player["id"] not in eligible:
        return error("Вы не можете голосовать за это задание")
    existing = db.execute(
        "SELECT 1 FROM votes WHERE round_prompt_id = ? AND voter_player_id = ?",
        (rp["id"], player["id"]),
    ).fetchone()
    if existing:
        return error("Вы уже проголосовали")

    db.execute(
        "INSERT INTO votes (id, round_prompt_id, submission_id, voter_player_id) VALUES (?, ?, ?, ?)",
        (gen_id(), rp["id"], submission_id, player["id"]),
    )
    db.commit()
    game.tick(db, room)
    return jsonify({"ok": True})


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


STATIC_ROOT = BASE_DIR


@app.route("/")
@app.route("/r/<path:_rest>")
def spa(_rest=None):
    return send_from_directory(STATIC_ROOT, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    full_path = os.path.join(STATIC_ROOT, filename)
    if os.path.isfile(full_path):
        return send_from_directory(STATIC_ROOT, filename)
    return send_from_directory(STATIC_ROOT, "index.html")


if __name__ == "__main__":
    app.run(debug=True, port=5001)

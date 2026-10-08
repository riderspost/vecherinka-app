import hmac
import os
import sqlite3
import uuid
from functools import wraps

from flask import Blueprint, request, jsonify, session, send_from_directory
from werkzeug.utils import secure_filename

from .db import get_db
from . import ai_prompts
from . import fanty_game
from .rooms_common import UPLOAD_DIR, ALLOWED_AUDIO_EXT, delete_room_and_files

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN_DIR = os.path.join(BASE_DIR, "admin")
MAX_PROMPT_LEN = 300

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")
if not ADMIN_USERNAME or not ADMIN_PASSWORD:
    raise RuntimeError(
        "ADMIN_USERNAME and ADMIN_PASSWORD must be set as environment variables "
        "(see .env.example) — there is no built-in default admin password."
    )

admin_bp = Blueprint("admin", __name__, url_prefix="/admin")


def is_admin():
    return bool(session.get("is_admin"))


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_admin():
            return jsonify({"error": "Требуется вход в админ-панель"}), 401
        return view(*args, **kwargs)

    return wrapped


@admin_bp.route("/api/login", methods=["POST"])
def admin_login():
    data = request.get_json(force=True, silent=True) or {}
    username = data.get("username") or ""
    password = data.get("password") or ""

    valid = hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD)
    if not valid:
        return jsonify({"error": "Неверный логин или пароль"}), 401

    session["is_admin"] = True
    return jsonify({"ok": True})


@admin_bp.route("/api/logout", methods=["POST"])
def admin_logout():
    session.pop("is_admin", None)
    return jsonify({"ok": True})


@admin_bp.route("/api/session")
def admin_session():
    return jsonify({"authenticated": is_admin()})


@admin_bp.route("/api/users")
@admin_required
def admin_list_users():
    db = get_db()
    rows = db.execute(
        """SELECT id, email, name, email_verified, games_created_count, created_at
           FROM users
           ORDER BY games_created_count DESC, created_at DESC"""
    ).fetchall()
    return jsonify(
        [
            {
                "id": r["id"],
                "email": r["email"],
                "name": r["name"],
                "emailVerified": bool(r["email_verified"]),
                "gamesCreated": r["games_created_count"],
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    )


@admin_bp.route("/api/rooms")
@admin_required
def admin_list_rooms():
    db = get_db()
    rooms = db.execute("SELECT * FROM rooms ORDER BY created_at DESC").fetchall()
    result = []
    for r in rooms:
        host = db.execute(
            "SELECT name FROM players WHERE room_id = ? AND is_host = 1 LIMIT 1", (r["id"],)
        ).fetchone()
        player_count = db.execute(
            "SELECT COUNT(*) AS c FROM players WHERE room_id = ? AND is_display = 0", (r["id"],)
        ).fetchone()["c"]
        if r["game_type"] == "fanty":
            rounds_played = db.execute(
                "SELECT COUNT(*) AS c FROM fanty_rounds WHERE room_id = ?", (r["id"],)
            ).fetchone()["c"]
        else:
            rounds_played = r["current_round"]
        idle_minutes = db.execute(
            "SELECT CAST((julianday('now') - julianday(?)) * 24 * 60 AS INTEGER) AS m",
            (r["last_active_at"],),
        ).fetchone()["m"]
        result.append(
            {
                "code": r["code"],
                "gameType": r["game_type"],
                "status": r["status"],
                "hostName": host["name"] if host else None,
                "playerCount": player_count,
                "roundsPlayed": rounds_played,
                "createdAt": r["created_at"],
                "idleMinutes": idle_minutes,
            }
        )
    return jsonify(result)


@admin_bp.route("/api/rooms/<code>", methods=["DELETE"])
@admin_required
def admin_delete_room(code):
    db = get_db()
    room = db.execute("SELECT * FROM rooms WHERE code = ?", (code.upper(),)).fetchone()
    if not room:
        return jsonify({"error": "Комната не найдена"}), 404
    delete_room_and_files(db, room)
    return jsonify({"ok": True})


@admin_bp.route("/api/prompts")
@admin_required
def admin_list_prompts():
    db = get_db()
    rows = db.execute(
        """SELECT p.id, p.text, p.status, p.likes,
                  (SELECT COUNT(*) FROM round_prompts rp WHERE rp.prompt_id = p.id) AS uses
           FROM prompts p
           ORDER BY p.id DESC"""
    ).fetchall()
    return jsonify(
        [
            {"id": r["id"], "text": r["text"], "status": r["status"], "uses": r["uses"], "likes": r["likes"]}
            for r in rows
        ]
    )


@admin_bp.route("/api/prompts", methods=["POST"])
@admin_required
def admin_add_prompt():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Введите текст вопроса"}), 400
    if len(text) > MAX_PROMPT_LEN:
        return jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM prompts WHERE text = ?", (text,)).fetchone():
        return jsonify({"error": "Такой вопрос уже есть в списке"}), 400

    cur = db.execute("INSERT INTO prompts (text, status) VALUES (?, 'active')", (text,))
    db.commit()
    return jsonify({"id": cur.lastrowid, "text": text, "status": "active", "uses": 0, "likes": 0})


@admin_bp.route("/api/prompts/<int:prompt_id>", methods=["PUT"])
@admin_required
def admin_edit_prompt(prompt_id):
    db = get_db()
    existing = db.execute("SELECT * FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Вопрос не найден"}), 404

    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Введите текст вопроса"}), 400
    if len(text) > MAX_PROMPT_LEN:
        return jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400

    dupe = db.execute("SELECT 1 FROM prompts WHERE text = ? AND id != ?", (text, prompt_id)).fetchone()
    if dupe:
        return jsonify({"error": "Такой вопрос уже есть в списке"}), 400

    db.execute("UPDATE prompts SET text = ? WHERE id = ?", (text, prompt_id))
    db.commit()
    uses = db.execute(
        "SELECT COUNT(*) AS c FROM round_prompts WHERE prompt_id = ?", (prompt_id,)
    ).fetchone()["c"]
    return jsonify({"id": prompt_id, "text": text, "status": existing["status"], "uses": uses, "likes": existing["likes"]})


@admin_bp.route("/api/prompts/<int:prompt_id>", methods=["DELETE"])
@admin_required
def admin_delete_prompt(prompt_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM prompts WHERE id = ?", (prompt_id,)).fetchone():
        return jsonify({"error": "Вопрос не найден"}), 404

    try:
        db.execute("DELETE FROM prompts WHERE id = ?", (prompt_id,))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify({"error": "Нельзя удалить — этот вопрос уже использовался в игре"}), 400

    return jsonify({"ok": True})


@admin_bp.route("/api/prompts/generate", methods=["POST"])
@admin_required
def admin_generate_prompts():
    data = request.get_json(force=True, silent=True) or {}
    try:
        count = int(data.get("count", 10))
    except (TypeError, ValueError):
        count = 10
    count = max(1, min(count, 30))
    theme = (data.get("theme") or "").strip()[:200]

    db = get_db()
    existing_texts = [r["text"] for r in db.execute("SELECT text FROM prompts").fetchall()]

    try:
        generated, model_used = ai_prompts.generate_prompts(count, theme, existing_texts)
    except ai_prompts.AIGenerationError as e:
        return jsonify({"error": str(e)}), 502

    added = 0
    if generated:
        cur = db.executemany(
            "INSERT OR IGNORE INTO prompts (text, status) VALUES (?, 'pending')",
            [(t,) for t in generated],
        )
        db.commit()
        added = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    return jsonify({
        "requested": count,
        "generated": len(generated),
        "added": added,
        "prompts": generated,
        "model": model_used,
    })


@admin_bp.route("/api/prompts/<int:prompt_id>/activate", methods=["POST"])
@admin_required
def admin_activate_prompt(prompt_id):
    db = get_db()
    row = db.execute("SELECT status FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
    if not row:
        return jsonify({"error": "Вопрос не найден"}), 404
    db.execute("UPDATE prompts SET status = 'active' WHERE id = ?", (prompt_id,))
    db.commit()
    return jsonify({"ok": True})


def _parse_ids(raw):
    if not isinstance(raw, list):
        return []
    ids = []
    for v in raw:
        try:
            ids.append(int(v))
        except (TypeError, ValueError):
            continue
    return ids


@admin_bp.route("/api/prompts/bulk-activate", methods=["POST"])
@admin_required
def admin_bulk_activate():
    data = request.get_json(force=True, silent=True) or {}
    ids = _parse_ids(data.get("ids"))
    if not ids:
        return jsonify({"error": "Не выбрано ни одного вопроса"}), 400

    db = get_db()
    placeholders = ",".join("?" * len(ids))
    cur = db.execute(
        f"UPDATE prompts SET status = 'active' WHERE id IN ({placeholders})", ids
    )
    db.commit()
    return jsonify({"activated": cur.rowcount})


@admin_bp.route("/api/prompts/bulk-delete", methods=["POST"])
@admin_required
def admin_bulk_delete():
    data = request.get_json(force=True, silent=True) or {}
    ids = _parse_ids(data.get("ids"))
    if not ids:
        return jsonify({"error": "Не выбрано ни одного вопроса"}), 400

    db = get_db()
    placeholders = ",".join("?" * len(ids))
    used_ids = {
        row["prompt_id"]
        for row in db.execute(
            f"SELECT DISTINCT prompt_id FROM round_prompts WHERE prompt_id IN ({placeholders})", ids
        ).fetchall()
    }
    deletable = [i for i in ids if i not in used_ids]
    deleted = 0
    if deletable:
        placeholders2 = ",".join("?" * len(deletable))
        cur = db.execute(f"DELETE FROM prompts WHERE id IN ({placeholders2})", deletable)
        db.commit()
        deleted = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    return jsonify({"deleted": deleted, "blocked": len(used_ids)})


def _activate_one(table, item_id):
    db = get_db()
    if not db.execute(f"SELECT 1 FROM {table} WHERE id = ?", (item_id,)).fetchone():
        return jsonify({"error": "Не найдено"}), 404
    db.execute(f"UPDATE {table} SET status = 'active' WHERE id = ?", (item_id,))
    db.commit()
    return jsonify({"ok": True})


def _bulk_activate(table, ids):
    if not ids:
        return jsonify({"error": "Не выбрано ни одного элемента"}), 400
    db = get_db()
    placeholders = ",".join("?" * len(ids))
    cur = db.execute(f"UPDATE {table} SET status = 'active' WHERE id IN ({placeholders})", ids)
    db.commit()
    return jsonify({"activated": cur.rowcount})


def _bulk_delete(table, ids, used_ids):
    if not ids:
        return jsonify({"error": "Не выбрано ни одного элемента"}), 400
    db = get_db()
    deletable = [i for i in ids if i not in used_ids]
    deleted = 0
    if deletable:
        placeholders = ",".join("?" * len(deletable))
        cur = db.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})", deletable)
        db.commit()
        deleted = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return jsonify({"deleted": deleted, "blocked": len(used_ids)})


def _fanty_content_is_live(db, column, content_id):
    # Is this dare/truth the one currently showing on someone's screen right
    # now, in a room that's still actually playing? Editing or deleting it
    # out from under a live round would change or vanish the text a player
    # is mid-performing — distinct from the historical-use check on DELETE,
    # which only cares whether it was *ever* played, not right now.
    return (
        db.execute(
            f"""SELECT 1 FROM fanty_state fs
                JOIN rooms r ON r.id = fs.room_id
                WHERE r.status = 'playing' AND fs.{column} = ?""",
            (content_id,),
        ).fetchone()
        is not None
    )


def _fanty_content_locked_for_edit(db, state_column, rounds_column, content_id):
    # Blocks edits not just while the content is live right now, but for
    # the whole rest of an unfinished game once it's been played in any
    # round of it. The finished-game summary re-reads the dare/truth text
    # fresh from fanty_dares/fanty_truths rather than storing a snapshot at
    # resolve time, so an edit to an earlier round's content — while that
    # same game is still going — would silently rewrite what the "Итоги
    # игры" screen shows for a round players already played differently.
    if _fanty_content_is_live(db, state_column, content_id):
        return True
    return (
        db.execute(
            f"""SELECT 1 FROM fanty_rounds fr
                JOIN rooms r ON r.id = fr.room_id
                WHERE r.status != 'finished' AND fr.{rounds_column} = ?""",
            (content_id,),
        ).fetchone()
        is not None
    )


@admin_bp.route("/api/fanty/dares")
@admin_required
def admin_list_dares():
    db = get_db()
    rows = db.execute(
        """SELECT d.id, d.text, d.kind, d.status, d.mixed_pair, d.likes,
                  d.music_filename, d.has_timer, d.timer_seconds,
                  COALESCE(u.email, 'admin') AS created_by,
                  (SELECT COUNT(*) FROM fanty_rounds fr WHERE fr.dare_id = d.id) AS uses
           FROM fanty_dares d LEFT JOIN users u ON u.id = d.created_by_user_id
           ORDER BY d.id DESC"""
    ).fetchall()
    result = []
    for r in rows:
        cats = [
            c["category"]
            for c in db.execute("SELECT category FROM fanty_dare_categories WHERE dare_id = ?", (r["id"],)).fetchall()
        ]
        locs = [
            l["location"]
            for l in db.execute("SELECT location FROM fanty_dare_locations WHERE dare_id = ?", (r["id"],)).fetchall()
        ]
        result.append(
            {
                "id": r["id"],
                "text": r["text"],
                "kind": r["kind"],
                "status": r["status"],
                "uses": r["uses"],
                "likes": r["likes"],
                "categories": cats,
                "locations": locs,
                "mixedPair": bool(r["mixed_pair"]),
                "musicUrl": f"/uploads/{r['music_filename']}" if r["music_filename"] else None,
                "hasTimer": bool(r["has_timer"]),
                "timerSeconds": r["timer_seconds"],
                "createdBy": r["created_by"],
            }
        )
    return jsonify(result)


@admin_bp.route("/api/fanty/upload-audio", methods=["POST"])
@admin_required
def admin_upload_audio():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Файл не передан"}), 400
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_AUDIO_EXT:
        return jsonify({"error": "Недопустимый формат файла (нужен mp3/ogg/wav/m4a)"}), 400
    filename = f"{uuid.uuid4().hex}.{ext}"
    file.save(os.path.join(UPLOAD_DIR, secure_filename(filename)))
    return jsonify({"filename": filename})


def _parse_dare_payload(data):
    """Validates + normalizes a create/edit dare payload. Returns (fields, categories, locations, error_response)."""
    text = (data.get("text") or "").strip()
    if not text:
        return None, None, None, (jsonify({"error": "Введите текст фанта"}), 400)
    if len(text) > MAX_PROMPT_LEN:
        return None, None, None, (jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400)
    kind = data.get("kind") if data.get("kind") in ("solo", "team") else "solo"
    mixed_pair = bool(data.get("mixedPair")) and kind == "team"
    categories = [c for c in (data.get("categories") or []) if c in fanty_game.CATEGORIES]
    locations = [loc for loc in (data.get("locations") or []) if loc in fanty_game.LOCATIONS]
    if not categories:
        return None, None, None, (jsonify({"error": "Выберите хотя бы одну категорию"}), 400)
    if not locations:
        return None, None, None, (jsonify({"error": "Выберите хотя бы одно место"}), 400)

    music_filename = data.get("musicFilename") or None
    if music_filename and not os.path.isfile(os.path.join(UPLOAD_DIR, os.path.basename(music_filename))):
        music_filename = None
    has_timer = bool(data.get("hasTimer"))
    timer_seconds = 60
    if has_timer:
        try:
            timer_seconds = int(data.get("timerSeconds") or 60)
        except (TypeError, ValueError):
            timer_seconds = 60
        timer_seconds = max(5, min(600, timer_seconds))

    fields = {
        "text": text,
        "kind": kind,
        "mixed_pair": int(mixed_pair),
        "music_filename": music_filename,
        "has_timer": int(has_timer),
        "timer_seconds": timer_seconds,
    }
    return fields, categories, locations, None


def _dare_json(dare_id, fields, status, uses, categories, locations):
    return {
        "id": dare_id,
        "text": fields["text"],
        "kind": fields["kind"],
        "status": status,
        "uses": uses,
        "categories": categories,
        "locations": locations,
        "mixedPair": bool(fields["mixed_pair"]),
        "musicUrl": f"/uploads/{fields['music_filename']}" if fields["music_filename"] else None,
        "hasTimer": bool(fields["has_timer"]),
        "timerSeconds": fields["timer_seconds"],
    }


@admin_bp.route("/api/fanty/dares", methods=["POST"])
@admin_required
def admin_add_dare():
    data = request.get_json(force=True, silent=True) or {}
    fields, categories, locations, err = _parse_dare_payload(data)
    if err:
        return err

    db = get_db()
    if db.execute("SELECT 1 FROM fanty_dares WHERE text = ?", (fields["text"],)).fetchone():
        return jsonify({"error": "Такой фант уже есть"}), 400
    cur = db.execute(
        """INSERT INTO fanty_dares (text, kind, status, mixed_pair, music_filename, has_timer, timer_seconds)
           VALUES (?, ?, 'active', ?, ?, ?, ?)""",
        (
            fields["text"],
            fields["kind"],
            fields["mixed_pair"],
            fields["music_filename"],
            fields["has_timer"],
            fields["timer_seconds"],
        ),
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
    db.commit()
    return jsonify(_dare_json(dare_id, fields, "active", 0, categories, locations))


@admin_bp.route("/api/fanty/dares/<int:dare_id>", methods=["PUT"])
@admin_required
def admin_edit_dare(dare_id):
    db = get_db()
    existing = db.execute("SELECT * FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Не найдено"}), 404
    if _fanty_content_locked_for_edit(db, "current_dare_id", "dare_id", dare_id):
        return jsonify({"error": "Этот фант используется в ещё не завершённой игре — подождите, пока она закончится"}), 400

    data = request.get_json(force=True, silent=True) or {}
    fields, categories, locations, err = _parse_dare_payload(data)
    if err:
        return err

    dupe = db.execute(
        "SELECT 1 FROM fanty_dares WHERE text = ? AND id != ?", (fields["text"], dare_id)
    ).fetchone()
    if dupe:
        return jsonify({"error": "Такой фант уже есть"}), 400

    db.execute(
        """UPDATE fanty_dares SET text=?, kind=?, mixed_pair=?, music_filename=?, has_timer=?, timer_seconds=?
           WHERE id=?""",
        (
            fields["text"],
            fields["kind"],
            fields["mixed_pair"],
            fields["music_filename"],
            fields["has_timer"],
            fields["timer_seconds"],
            dare_id,
        ),
    )
    db.execute("DELETE FROM fanty_dare_categories WHERE dare_id = ?", (dare_id,))
    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_categories (dare_id, category) VALUES (?, ?)",
        [(dare_id, c) for c in categories],
    )
    db.execute("DELETE FROM fanty_dare_locations WHERE dare_id = ?", (dare_id,))
    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_locations (dare_id, location) VALUES (?, ?)",
        [(dare_id, loc) for loc in locations],
    )
    db.commit()
    uses = db.execute(
        "SELECT COUNT(*) AS c FROM fanty_rounds WHERE dare_id = ?", (dare_id,)
    ).fetchone()["c"]
    return jsonify(_dare_json(dare_id, fields, existing["status"], uses, categories, locations))


@admin_bp.route("/api/fanty/dares/<int:dare_id>", methods=["DELETE"])
@admin_required
def admin_delete_dare(dare_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone():
        return jsonify({"error": "Не найдено"}), 404
    if _fanty_content_is_live(db, "current_dare_id", dare_id):
        return jsonify({"error": "Этот фант сейчас выполняется в активной игре — подождите, пока раунд закончится"}), 400
    try:
        db.execute("DELETE FROM fanty_dares WHERE id = ?", (dare_id,))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify({"error": "Нельзя удалить — этот фант уже использовался в игре"}), 400
    return jsonify({"ok": True})


@admin_bp.route("/api/fanty/dares/<int:dare_id>/activate", methods=["POST"])
@admin_required
def admin_activate_dare(dare_id):
    return _activate_one("fanty_dares", dare_id)


@admin_bp.route("/api/fanty/dares/bulk-activate", methods=["POST"])
@admin_required
def admin_bulk_activate_dares():
    data = request.get_json(force=True, silent=True) or {}
    return _bulk_activate("fanty_dares", _parse_ids(data.get("ids")))


@admin_bp.route("/api/fanty/dares/bulk-delete", methods=["POST"])
@admin_required
def admin_bulk_delete_dares():
    data = request.get_json(force=True, silent=True) or {}
    ids = _parse_ids(data.get("ids"))
    db = get_db()
    used_ids = set()
    if ids:
        placeholders = ",".join("?" * len(ids))
        used_ids = {
            row["dare_id"]
            for row in db.execute(
                f"SELECT DISTINCT dare_id FROM fanty_rounds WHERE dare_id IN ({placeholders})", ids
            ).fetchall()
        }
        used_ids |= {i for i in ids if _fanty_content_is_live(db, "current_dare_id", i)}
    return _bulk_delete("fanty_dares", ids, used_ids)


@admin_bp.route("/api/fanty/truths")
@admin_required
def admin_list_truths():
    db = get_db()
    rows = db.execute(
        """SELECT t.id, t.text, t.status, t.likes,
                  COALESCE(u.email, 'admin') AS created_by,
                  (SELECT COUNT(*) FROM fanty_rounds fr WHERE fr.truth_id = t.id) AS uses
           FROM fanty_truths t LEFT JOIN users u ON u.id = t.created_by_user_id
           ORDER BY t.id DESC"""
    ).fetchall()
    result = []
    for r in rows:
        cats = [
            c["category"]
            for c in db.execute(
                "SELECT category FROM fanty_truth_categories WHERE truth_id = ?", (r["id"],)
            ).fetchall()
        ]
        result.append(
            {
                "id": r["id"],
                "text": r["text"],
                "status": r["status"],
                "likes": r["likes"],
                "uses": r["uses"],
                "categories": cats,
                "createdBy": r["created_by"],
            }
        )
    return jsonify(result)


@admin_bp.route("/api/fanty/truths", methods=["POST"])
@admin_required
def admin_add_truth():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Введите текст вопроса"}), 400
    if len(text) > MAX_PROMPT_LEN:
        return jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400
    categories = list(dict.fromkeys(c for c in (data.get("categories") or []) if c in fanty_game.MOOD_CATEGORIES))
    if not categories:
        return jsonify({"error": "Выберите категорию"}), 400
    if len(categories) > 1:
        return jsonify({"error": "Для вопроса можно выбрать только одну категорию"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM fanty_truths WHERE text = ?", (text,)).fetchone():
        return jsonify({"error": "Такой вопрос уже есть"}), 400
    cur = db.execute("INSERT INTO fanty_truths (text, status) VALUES (?, 'active')", (text,))
    truth_id = cur.lastrowid
    db.executemany(
        "INSERT OR IGNORE INTO fanty_truth_categories (truth_id, category) VALUES (?, ?)",
        [(truth_id, c) for c in categories],
    )
    db.commit()
    return jsonify({"id": truth_id, "text": text, "status": "active", "uses": 0, "categories": categories})


@admin_bp.route("/api/fanty/truths/<int:truth_id>", methods=["PUT"])
@admin_required
def admin_edit_truth(truth_id):
    db = get_db()
    existing = db.execute("SELECT * FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone()
    if not existing:
        return jsonify({"error": "Не найдено"}), 404
    if _fanty_content_locked_for_edit(db, "current_truth_id", "truth_id", truth_id):
        return jsonify({"error": "Этот вопрос используется в ещё не завершённой игре — подождите, пока она закончится"}), 400

    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Введите текст вопроса"}), 400
    if len(text) > MAX_PROMPT_LEN:
        return jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400
    categories = list(dict.fromkeys(c for c in (data.get("categories") or []) if c in fanty_game.MOOD_CATEGORIES))
    if not categories:
        return jsonify({"error": "Выберите категорию"}), 400
    if len(categories) > 1:
        return jsonify({"error": "Для вопроса можно выбрать только одну категорию"}), 400

    dupe = db.execute("SELECT 1 FROM fanty_truths WHERE text = ? AND id != ?", (text, truth_id)).fetchone()
    if dupe:
        return jsonify({"error": "Такой вопрос уже есть"}), 400

    db.execute("UPDATE fanty_truths SET text = ? WHERE id = ?", (text, truth_id))
    db.execute("DELETE FROM fanty_truth_categories WHERE truth_id = ?", (truth_id,))
    db.executemany(
        "INSERT OR IGNORE INTO fanty_truth_categories (truth_id, category) VALUES (?, ?)",
        [(truth_id, c) for c in categories],
    )
    db.commit()
    uses = db.execute(
        "SELECT COUNT(*) AS c FROM fanty_rounds WHERE truth_id = ?", (truth_id,)
    ).fetchone()["c"]
    return jsonify(
        {"id": truth_id, "text": text, "status": existing["status"], "uses": uses, "categories": categories}
    )


@admin_bp.route("/api/fanty/truths/<int:truth_id>", methods=["DELETE"])
@admin_required
def admin_delete_truth(truth_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone():
        return jsonify({"error": "Не найдено"}), 404
    if _fanty_content_is_live(db, "current_truth_id", truth_id):
        return jsonify({"error": "Этот вопрос сейчас используется в активной игре — подождите, пока раунд закончится"}), 400
    try:
        db.execute("DELETE FROM fanty_truths WHERE id = ?", (truth_id,))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify({"error": "Нельзя удалить — этот вопрос уже использовался в игре"}), 400
    return jsonify({"ok": True})


@admin_bp.route("/api/fanty/truths/<int:truth_id>/activate", methods=["POST"])
@admin_required
def admin_activate_truth(truth_id):
    return _activate_one("fanty_truths", truth_id)


@admin_bp.route("/api/fanty/truths/bulk-activate", methods=["POST"])
@admin_required
def admin_bulk_activate_truths():
    data = request.get_json(force=True, silent=True) or {}
    return _bulk_activate("fanty_truths", _parse_ids(data.get("ids")))


@admin_bp.route("/api/fanty/truths/bulk-delete", methods=["POST"])
@admin_required
def admin_bulk_delete_truths():
    data = request.get_json(force=True, silent=True) or {}
    ids = _parse_ids(data.get("ids"))
    db = get_db()
    used_ids = set()
    if ids:
        placeholders = ",".join("?" * len(ids))
        used_ids = {
            row["truth_id"]
            for row in db.execute(
                f"SELECT DISTINCT truth_id FROM fanty_rounds WHERE truth_id IN ({placeholders})", ids
            ).fetchall()
        }
        used_ids |= {i for i in ids if _fanty_content_is_live(db, "current_truth_id", i)}
    return _bulk_delete("fanty_truths", ids, used_ids)


@admin_bp.route("/")
@admin_bp.route("/<path:path>")
def admin_static(path="index.html"):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    full = os.path.join(ADMIN_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(ADMIN_DIR, path)
    return send_from_directory(ADMIN_DIR, "index.html")

import hmac
import os
import sqlite3
from functools import wraps

from flask import Blueprint, request, jsonify, session, send_from_directory

from .db import get_db
from . import ai_prompts
from . import fanty_game

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


@admin_bp.route("/api/prompts")
@admin_required
def admin_list_prompts():
    db = get_db()
    rows = db.execute(
        """SELECT p.id, p.text, p.status,
                  (SELECT COUNT(*) FROM round_prompts rp WHERE rp.prompt_id = p.id) AS uses
           FROM prompts p
           ORDER BY p.id DESC"""
    ).fetchall()
    return jsonify(
        [{"id": r["id"], "text": r["text"], "status": r["status"], "uses": r["uses"]} for r in rows]
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
    return jsonify({"id": cur.lastrowid, "text": text, "status": "active", "uses": 0})


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


@admin_bp.route("/api/fanty/dares")
@admin_required
def admin_list_dares():
    db = get_db()
    rows = db.execute(
        """SELECT d.id, d.text, d.kind, d.status,
                  (SELECT COUNT(*) FROM fanty_rounds fr WHERE fr.dare_id = d.id) AS uses
           FROM fanty_dares d ORDER BY d.id DESC"""
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
                "categories": cats,
                "locations": locs,
            }
        )
    return jsonify(result)


@admin_bp.route("/api/fanty/dares", methods=["POST"])
@admin_required
def admin_add_dare():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "Введите текст фанта"}), 400
    if len(text) > MAX_PROMPT_LEN:
        return jsonify({"error": f"Слишком длинный текст (макс. {MAX_PROMPT_LEN} символов)"}), 400
    kind = data.get("kind") if data.get("kind") in ("solo", "team") else "solo"
    categories = [c for c in (data.get("categories") or []) if c in fanty_game.CATEGORIES]
    locations = [loc for loc in (data.get("locations") or []) if loc in fanty_game.LOCATIONS]
    if not categories:
        return jsonify({"error": "Выберите хотя бы одну категорию"}), 400
    if not locations:
        return jsonify({"error": "Выберите хотя бы одно место"}), 400

    db = get_db()
    if db.execute("SELECT 1 FROM fanty_dares WHERE text = ?", (text,)).fetchone():
        return jsonify({"error": "Такой фант уже есть"}), 400
    cur = db.execute("INSERT INTO fanty_dares (text, kind, status) VALUES (?, ?, 'active')", (text, kind))
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
    return jsonify(
        {
            "id": dare_id,
            "text": text,
            "kind": kind,
            "status": "active",
            "uses": 0,
            "categories": categories,
            "locations": locations,
        }
    )


@admin_bp.route("/api/fanty/dares/<int:dare_id>", methods=["DELETE"])
@admin_required
def admin_delete_dare(dare_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone():
        return jsonify({"error": "Не найдено"}), 404
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
    return _bulk_delete("fanty_dares", ids, used_ids)


@admin_bp.route("/api/fanty/truths")
@admin_required
def admin_list_truths():
    db = get_db()
    rows = db.execute(
        """SELECT t.id, t.text, t.status,
                  (SELECT COUNT(*) FROM fanty_rounds fr WHERE fr.truth_id = t.id) AS uses
           FROM fanty_truths t ORDER BY t.id DESC"""
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
            {"id": r["id"], "text": r["text"], "status": r["status"], "uses": r["uses"], "categories": cats}
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


@admin_bp.route("/api/fanty/truths/<int:truth_id>", methods=["DELETE"])
@admin_required
def admin_delete_truth(truth_id):
    db = get_db()
    if not db.execute("SELECT 1 FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone():
        return jsonify({"error": "Не найдено"}), 404
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

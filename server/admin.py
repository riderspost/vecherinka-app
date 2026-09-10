import hmac
import os
import sqlite3
from functools import wraps

from flask import Blueprint, request, jsonify, session, send_from_directory

from .db import get_db
from . import ai_prompts

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


@admin_bp.route("/")
@admin_bp.route("/<path:path>")
def admin_static(path="index.html"):
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    full = os.path.join(ADMIN_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(ADMIN_DIR, path)
    return send_from_directory(ADMIN_DIR, "index.html")

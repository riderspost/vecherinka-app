import re
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash

from .db import get_db
from .mailer import send_email

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 8
RESET_TOKEN_TTL = timedelta(hours=1)


def error(message, status=400):
    return jsonify({"error": message}), status


def normalize_email(value):
    return (value or "").strip().lower()


def get_current_user(db):
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def _login(user_id):
    session.permanent = True
    session["user_id"] = user_id


@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = data.get("password") or ""

    if not EMAIL_RE.match(email):
        return error("Введите корректный email")
    if len(password) < MIN_PASSWORD_LEN:
        return error(f"Пароль должен быть не короче {MIN_PASSWORD_LEN} символов")

    db = get_db()
    existing = db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return error("Этот email уже зарегистрирован")

    user_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
        (user_id, email, generate_password_hash(password, method="pbkdf2:sha256")),
    )
    db.commit()
    _login(user_id)
    return jsonify({"ok": True, "email": email})


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = data.get("password") or ""

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return error("Неверный email или пароль")

    _login(user["id"])
    return jsonify({"ok": True, "email": user["email"]})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@auth_bp.route("/session")
def get_session():
    db = get_db()
    user = get_current_user(db)
    if not user:
        return jsonify({"authenticated": False})
    return jsonify({"authenticated": True, "email": user["email"]})


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user:
        token = uuid.uuid4().hex
        expires_at = (datetime.utcnow() + RESET_TOKEN_TTL).isoformat()
        db.execute(
            "UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?",
            (token, expires_at, user["id"]),
        )
        db.commit()
        reset_url = f"{request.url_root}account?token={token}"
        send_email(
            user["email"],
            "Восстановление пароля — Вечеринка",
            f"""
            <p>Вы запросили восстановление пароля в приложении «Вечеринка».</p>
            <p><a href="{reset_url}">Придумать новый пароль</a></p>
            <p>Ссылка действительна 1 час. Если это были не вы — просто проигнорируйте это письмо.</p>
            """,
        )
    # Всегда одинаковый ответ, чтобы не палить, зарегистрирован ли email
    return jsonify({"ok": True})


@auth_bp.route("/reset-password", methods=["POST"])
def reset_password():
    data = request.get_json(silent=True) or {}
    token = data.get("token") or ""
    password = data.get("password") or ""

    if len(password) < MIN_PASSWORD_LEN:
        return error(f"Пароль должен быть не короче {MIN_PASSWORD_LEN} символов")

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE reset_token = ?", (token,)).fetchone() if token else None
    if not user or not user["reset_token_expires_at"]:
        return error("Ссылка недействительна или устарела")
    if datetime.utcnow() > datetime.fromisoformat(user["reset_token_expires_at"]):
        return error("Ссылка недействительна или устарела")

    db.execute(
        "UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?",
        (generate_password_hash(password, method="pbkdf2:sha256"), user["id"]),
    )
    db.commit()
    _login(user["id"])
    return jsonify({"ok": True, "email": user["email"]})

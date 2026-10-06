import random
import re
import uuid
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash

from .db import get_db
from .mailer import send_email
from .rooms_common import MAX_NAME_LEN, clean_str, validate_avatar

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LEN = 8
RESET_TOKEN_TTL = timedelta(hours=1)
VERIFY_CODE_TTL = timedelta(minutes=15)


def error(message, status=400, **extra):
    body = {"error": message}
    body.update(extra)
    return jsonify(body), status


def normalize_email(value):
    return (value or "").strip().lower()


def hash_password(password):
    return generate_password_hash(password, method="pbkdf2:sha256")


def get_current_user(db):
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def _login(user_id):
    session.permanent = True
    session["user_id"] = user_id


def _send_verification_code(db, user):
    code = f"{random.randint(0, 999999):06d}"
    expires_at = (datetime.utcnow() + VERIFY_CODE_TTL).isoformat()
    db.execute(
        "UPDATE users SET verification_code = ?, verification_code_expires_at = ? WHERE id = ?",
        (code, expires_at, user["id"]),
    )
    db.commit()
    send_email(
        user["email"],
        "Код подтверждения — Вечеринка",
        f"""
        <p>Ваш код подтверждения email в приложении «Вечеринка»:</p>
        <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">{code}</p>
        <p>Код действителен 15 минут.</p>
        """,
    )


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
    existing = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    password_hash = hash_password(password)

    if existing and existing["email_verified"]:
        return error("Этот email уже зарегистрирован")

    if existing:
        # Брошенная незавершённая регистрация — обновляем пароль и шлём новый код.
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, existing["id"]))
        db.commit()
        user = existing
    else:
        user_id = str(uuid.uuid4())
        db.execute(
            "INSERT INTO users (id, email, password_hash, email_verified) VALUES (?, ?, ?, 0)",
            (user_id, email, password_hash),
        )
        db.commit()
        user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()

    _send_verification_code(db, user)
    return jsonify({"ok": True, "email": email, "needsVerification": True})


@auth_bp.route("/verify-email", methods=["POST"])
def verify_email():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    code = (data.get("code") or "").strip()

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if (
        not user
        or not user["verification_code"]
        or not user["verification_code_expires_at"]
        or user["verification_code"] != code
    ):
        return error("Неверный код")
    if datetime.utcnow() > datetime.fromisoformat(user["verification_code_expires_at"]):
        return error("Код устарел, запросите новый")

    db.execute(
        "UPDATE users SET email_verified = 1, verification_code = NULL, verification_code_expires_at = NULL WHERE id = ?",
        (user["id"],),
    )
    db.commit()
    _login(user["id"])
    return jsonify({"ok": True, "email": user["email"]})


@auth_bp.route("/resend-code", methods=["POST"])
def resend_code():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ? AND email_verified = 0", (email,)).fetchone()
    if user:
        _send_verification_code(db, user)
    return jsonify({"ok": True})


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    password = data.get("password") or ""

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return error("Неверный email или пароль")

    if not user["email_verified"]:
        _send_verification_code(db, user)
        return error("Подтвердите email — мы отправили новый код", needsVerification=True, email=user["email"])

    _login(user["id"])
    return jsonify({"ok": True, "email": user["email"]})


@auth_bp.route("/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


def _profile_complete(user):
    return bool(user["name"]) and bool(user["avatar_value"])


@auth_bp.route("/session")
def get_session():
    db = get_db()
    user = get_current_user(db)
    if not user:
        return jsonify({"authenticated": False})
    return jsonify(
        {
            "authenticated": True,
            "email": user["email"],
            "name": user["name"],
            "avatarType": user["avatar_type"] or "emoji",
            "avatarValue": user["avatar_value"],
            "profileComplete": _profile_complete(user),
        }
    )


@auth_bp.route("/profile", methods=["POST"])
def update_profile():
    db = get_db()
    user = get_current_user(db)
    if not user:
        return error("Требуется вход", 401)

    data = request.get_json(silent=True) or {}
    name = clean_str(data.get("name"), MAX_NAME_LEN)
    if not name:
        return error("Введите имя")
    avatar_type, avatar_value = validate_avatar(data.get("avatarType"), data.get("avatarValue"))

    db.execute(
        "UPDATE users SET name = ?, avatar_type = ?, avatar_value = ? WHERE id = ?",
        (name, avatar_type, avatar_value, user["id"]),
    )
    db.commit()
    return jsonify({"ok": True, "name": name, "avatarType": avatar_type, "avatarValue": avatar_value})


@auth_bp.route("/forgot-password", methods=["POST"])
def forgot_password():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user:
        return error("Пользователь с такой почтой не найден")

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
        (hash_password(password), user["id"]),
    )
    db.commit()
    _login(user["id"])
    return jsonify({"ok": True, "email": user["email"]})

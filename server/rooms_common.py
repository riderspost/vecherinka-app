import os
import random
import uuid

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_AUDIO_EXT = {"mp3", "ogg", "wav", "m4a"}
MAX_NAME_LEN = 30
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no O/0/I/1

os.makedirs(UPLOAD_DIR, exist_ok=True)


class RoomError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def gen_id():
    return str(uuid.uuid4())


def gen_room_code():
    return "".join(random.choice(CODE_ALPHABET) for _ in range(5))


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
        "gender": row["gender"],
    }


def validate_avatar(avatar_type, avatar_value):
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


def create_room_and_host(
    db, game_type, name, avatar_type, avatar_value, device_mode="remote", created_by_user_id=None, gender=None
):
    """Creates a room (in 'lobby' status) with the given host player. Returns (room_id, code, token, player_id)."""
    name = clean_str(name, MAX_NAME_LEN)
    if not name:
        raise RoomError("Введите имя")
    avatar_type, avatar_value = validate_avatar(avatar_type, avatar_value)

    for _ in range(10):
        code = gen_room_code()
        if not get_room_or_404(db, code):
            break
    else:
        raise RoomError("Не удалось создать комнату, попробуйте ещё раз", 500)

    room_id = gen_id()
    db.execute(
        "INSERT INTO rooms (id, code, status, game_type, device_mode, created_by_user_id) VALUES (?, ?, 'lobby', ?, ?, ?)",
        (room_id, code, game_type, device_mode, created_by_user_id),
    )
    player_id = gen_id()
    token = uuid.uuid4().hex
    db.execute(
        """INSERT INTO players (id, room_id, token, name, avatar_type, avatar_value, is_host, gender)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
        (player_id, room_id, token, name, avatar_type, avatar_value, gender),
    )
    return room_id, code, token, player_id


def add_player(db, room, name, avatar_type, avatar_value, is_display=False, is_host=False, gender=None):
    """Validates + inserts a new player row (join, or host-added local player). Returns (token, player_id)."""
    name = clean_str(name, MAX_NAME_LEN) or ("Экран" if is_display else "")
    if not name:
        raise RoomError("Введите имя")

    avatar_type, avatar_value = validate_avatar(avatar_type, avatar_value)
    if is_display:
        avatar_type, avatar_value = "emoji", "📺"
    elif avatar_type == "emoji":
        taken = db.execute(
            """SELECT 1 FROM players
               WHERE room_id = ? AND is_display = 0 AND avatar_type = 'emoji' AND avatar_value = ?""",
            (room["id"], avatar_value),
        ).fetchone()
        if taken:
            raise RoomError("Этот эмодзи уже выбрал другой игрок, выберите другой")

    player_id = gen_id()
    token = uuid.uuid4().hex
    db.execute(
        """INSERT INTO players (id, room_id, token, name, avatar_type, avatar_value, is_display, is_host, gender)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (player_id, room["id"], token, name, avatar_type, avatar_value, int(is_display), int(is_host), gender),
    )
    return token, player_id


def taken_emojis_for_room(db, room_id):
    rows = db.execute(
        """SELECT avatar_value FROM players
           WHERE room_id = ? AND is_display = 0 AND avatar_type = 'emoji'""",
        (room_id,),
    ).fetchall()
    return [r["avatar_value"] for r in rows]

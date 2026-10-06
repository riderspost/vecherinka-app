import io
import os
import random
import uuid

from PIL import Image, ImageOps

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_AUDIO_EXT = {"mp3", "ogg", "wav", "m4a"}
MAX_NAME_LEN = 30
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no O/0/I/1
JPEG_QUALITY = 85

os.makedirs(UPLOAD_DIR, exist_ok=True)


def resize_and_save_image(file_storage, dest_path, max_dimension):
    """Downscales an uploaded image to fit within max_dimension on its
    longest side before saving.

    Phone cameras routinely produce multi-megapixel, multi-MB photos, and
    the upload endpoints used to just save those verbatim — even for a
    22px avatar circle. Decoding and repainting a full-resolution bitmap
    at a tiny display size on every unrelated repaint is expensive enough
    that it showed up as a visible flicker on iOS Safari. Falls back to
    saving the raw bytes untouched if Pillow can't process the file (e.g.
    an unusual format) rather than failing the upload outright.
    """
    raw = file_storage.read()
    ext = dest_path.rsplit(".", 1)[-1].lower()

    if ext == "gif":
        # A naive Pillow re-save only keeps the first frame of an animated
        # GIF. GIFs aren't what phone cameras produce anyway, so the
        # oversized-image problem this function exists for doesn't apply.
        with open(dest_path, "wb") as f:
            f.write(raw)
        return

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # re-saving drops orientation EXIF otherwise
        img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

        if ext in ("jpg", "jpeg"):
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(dest_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
        elif ext == "webp":
            img.save(dest_path, "WEBP", quality=JPEG_QUALITY)
        else:
            img.save(dest_path, "PNG", optimize=True)
    except Exception:
        with open(dest_path, "wb") as f:
            f.write(raw)


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

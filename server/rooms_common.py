import io
import os
import random
import uuid

from PIL import Image, ImageOps
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_AUDIO_EXT = {"mp3", "ogg", "wav", "m4a"}
MAX_NAME_LEN = 30
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no O/0/I/1
JPEG_QUALITY = 85

os.makedirs(UPLOAD_DIR, exist_ok=True)


def _save_pillow_image(img, path, ext):
    if ext in ("jpg", "jpeg"):
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(path, "JPEG", quality=JPEG_QUALITY, optimize=True)
    elif ext == "webp":
        img.save(path, "WEBP", quality=JPEG_QUALITY)
    else:
        img.save(path, "PNG", optimize=True)


def resize_and_save_image(file_storage, dest_path, max_dimension, thumb_path=None, thumb_dimension=240):
    """Downscales an uploaded image to fit within max_dimension on its
    longest side before saving, and optionally writes a second, much
    smaller copy to thumb_path for use in grids/lists.

    Phone cameras routinely produce multi-megapixel, multi-MB photos, and
    the upload endpoints used to just save those verbatim — even for a
    22px avatar circle. Decoding and repainting a full-resolution bitmap
    at a tiny display size on every unrelated repaint is expensive enough
    that it showed up as a visible flicker on iOS Safari. Falls back to
    saving the raw bytes untouched (for both files) if Pillow can't
    process the file (e.g. an unusual format) rather than failing the
    upload outright.
    """
    raw = file_storage.read()
    ext = dest_path.rsplit(".", 1)[-1].lower()

    if ext == "gif":
        # A naive Pillow re-save only keeps the first frame of an animated
        # GIF. GIFs aren't what phone cameras produce anyway, so the
        # oversized-image problem this function exists for doesn't apply.
        with open(dest_path, "wb") as f:
            f.write(raw)
        if thumb_path:
            with open(thumb_path, "wb") as f:
                f.write(raw)
        return

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # re-saving drops orientation EXIF otherwise

        full_img = img.copy()
        full_img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
        _save_pillow_image(full_img, dest_path, ext)

        if thumb_path:
            thumb_img = img.copy()
            thumb_img.thumbnail((thumb_dimension, thumb_dimension), Image.LANCZOS)
            _save_pillow_image(thumb_img, thumb_path, thumb_path.rsplit(".", 1)[-1].lower())
    except Exception:
        with open(dest_path, "wb") as f:
            f.write(raw)
        if thumb_path:
            with open(thumb_path, "wb") as f:
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
    room = db.execute("SELECT * FROM rooms WHERE code = ?", (code.upper(),)).fetchone()
    if room:
        # Every lookup — state polls included — counts as activity, so an
        # abandoned room (tab closed, nobody polling any more) stops getting
        # touched and becomes eligible for the auto-close sweep below.
        db.execute("UPDATE rooms SET last_active_at = datetime('now') WHERE id = ?", (room["id"],))
        db.commit()
    return room


def delete_room_and_files(db, room):
    # Shared by the host-triggered /discard endpoints (either game) and the
    # abandoned-room sweep (server/app.py) — deleting the room cascades
    # everything in the DB (players, rounds, submissions, votes, fanty
    # state/photos rows), but the uploaded round-photo files themselves
    # live on disk and need cleaning up separately. Sentence-game rooms
    # have no photos, so that part is just a no-op for them.
    filenames = []
    if room["game_type"] == "fanty":
        photo_rows = db.execute(
            """SELECT frp.filename FROM fanty_round_photos frp
               JOIN fanty_rounds fr ON fr.id = frp.round_id
               WHERE fr.room_id = ?""",
            (room["id"],),
        ).fetchall()
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


def get_player_or_404(db, room_id, token):
    if not token:
        return None
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND token = ? AND left_at IS NULL", (room_id, token)
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
    if created_by_user_id:
        # A running tally, not a COUNT(*) over rooms — rooms themselves get
        # deleted (abandoned-room sweep, manual discard) once a game's over,
        # so this is the only place "how many games has this user ever
        # created" survives that cleanup.
        db.execute(
            "UPDATE users SET games_created_count = games_created_count + 1 WHERE id = ?",
            (created_by_user_id,),
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

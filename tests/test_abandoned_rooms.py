import io
import os

from PIL import Image

from tests.test_admin import admin_login
from tests.test_fanty_game import create_fanty_room, join_fanty
from tests.test_sentence_room import create_host


def _mark_stale(raw_db, code):
    raw_db.execute(
        "UPDATE rooms SET last_active_at = datetime('now', '-2 hours') WHERE code = ?", (code,)
    )
    raw_db.commit()


def test_abandoned_fanty_room_is_deleted_and_frees_its_dare(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    dare_id = state["fanty"]["contentId"]

    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (10, 20, 30)).save(buf, "JPEG")
    buf.seek(0)
    resp = client.post(
        f"/api/fanty/rooms/{code}/upload-photo",
        data={"file": (buf, "photo.jpg")},
        content_type="multipart/form-data",
    )
    filename = resp.get_json()["filename"]
    full_path = os.path.join(os.environ["UPLOAD_DIR"], filename)
    thumb_path = full_path.replace(".jpg", "_thumb.jpg")
    assert os.path.isfile(full_path)

    client.post(
        f"/api/fanty/rooms/{code}/resolve",
        json={"token": host_token, "counted": True, "photoFilenames": [filename]},
    )

    admin_login(client)
    # Still mid-game (not stale yet) — deleting the dare stays blocked.
    resp = client.delete(f"/admin/api/fanty/dares/{dare_id}")
    assert resp.status_code == 400

    _mark_stale(raw_db, code)

    # Any API request triggers the sweep, not just one for this room.
    client.get("/admin/api/fanty/dares")

    assert raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None
    assert not os.path.isfile(full_path)
    assert not os.path.isfile(thumb_path)

    resp = client.delete(f"/admin/api/fanty/dares/{dare_id}")
    assert resp.status_code == 200


def test_abandoned_sentence_room_is_deleted(client, raw_db):
    room = create_host(client)
    code = room["code"]
    raw_db.execute("UPDATE rooms SET status = 'answering' WHERE code = ?", (code,))
    raw_db.commit()
    _mark_stale(raw_db, code)

    client.get(f"/api/rooms/{code}/taken-emojis")

    assert raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None


def test_stale_lobby_room_is_deleted_after_an_hour(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    code = resp.get_json()["code"]
    _mark_stale(raw_db, code)

    client.get("/admin/api/fanty/dares")

    assert raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None


def test_fresh_lobby_room_is_kept(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    code = resp.get_json()["code"]

    client.get("/admin/api/fanty/dares")

    assert raw_db.execute("SELECT status FROM rooms WHERE code = ?", (code,)).fetchone()[0] == "lobby"


def test_recently_active_room_is_not_swept(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    # start() just bumped last_active_at to now — nowhere near the cutoff.

    client.get("/admin/api/fanty/dares")

    assert raw_db.execute("SELECT status FROM rooms WHERE code = ?", (code,)).fetchone()[0] == "playing"


def _set(raw_db, code, status, minutes_ago):
    raw_db.execute(
        "UPDATE rooms SET status = ?, last_active_at = datetime('now', ?) WHERE code = ?",
        (status, f"-{minutes_ago} minutes", code),
    )
    raw_db.commit()


def test_finished_rooms_close_after_five_quiet_minutes_but_running_ones_wait_an_hour(client, raw_db):
    finished = create_fanty_room(client, game_mode="solo").get_json()["code"]
    finished_sentence = create_host(client)["code"]
    running = create_fanty_room(client, game_mode="solo").get_json()["code"]
    just_finished = create_fanty_room(client, game_mode="solo").get_json()["code"]

    _set(raw_db, finished, "finished", 10)
    _set(raw_db, finished_sentence, "final_results", 10)
    _set(raw_db, running, "playing", 10)
    _set(raw_db, just_finished, "finished", 1)

    client.get("/api/my-rooms")  # any API request sweeps

    def exists(code):
        return raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is not None

    assert not exists(finished)
    assert not exists(finished_sentence)
    assert exists(running)
    assert exists(just_finished)


def test_my_rooms_does_not_list_finished_games(client, raw_db):
    from tests.test_auth import get_code, register

    register(client, email="fin@example.com")
    client.post("/api/auth/verify-email", json={"email": "fin@example.com", "code": get_code(raw_db, "fin@example.com")})
    code = client.post("/api/rooms", json={"name": "Хост", "avatarType": "emoji", "avatarValue": "🦊"}).get_json()["code"]
    assert [r["code"] for r in client.get("/api/my-rooms").get_json()] == [code]
    _set(raw_db, code, "final_results", 0)
    assert client.get("/api/my-rooms").get_json() == []

from tests.test_admin import admin_login
from tests.test_fanty_game import create_fanty_room, join_fanty
from tests.test_sentence_room import create_host


def _mark_stale(raw_db, code):
    raw_db.execute(
        "UPDATE rooms SET last_active_at = datetime('now', '-2 hours') WHERE code = ?", (code,)
    )
    raw_db.commit()


def test_abandoned_fanty_room_is_closed_and_unlocks_its_dare(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    dare_id = state["fanty"]["contentId"]
    client.post(f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True})

    admin_login(client)
    resp = client.put(
        f"/admin/api/fanty/dares/{dare_id}",
        json={"text": "Пока комната жива", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 400

    _mark_stale(raw_db, code)

    # Any API request triggers the sweep, not just one for this room.
    client.get("/admin/api/fanty/dares")

    assert raw_db.execute("SELECT status FROM rooms WHERE code = ?", (code,)).fetchone()[0] == "finished"
    resp = client.put(
        f"/admin/api/fanty/dares/{dare_id}",
        json={"text": "Комната закрылась как брошенная", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 200


def test_abandoned_sentence_room_is_closed(client, raw_db):
    room = create_host(client)
    code = room["code"]
    raw_db.execute("UPDATE rooms SET status = 'answering' WHERE code = ?", (code,))
    raw_db.commit()
    _mark_stale(raw_db, code)

    client.get(f"/api/rooms/{code}/taken-emojis")

    assert raw_db.execute("SELECT status FROM rooms WHERE code = ?", (code,)).fetchone()[0] == "final_results"


def test_stale_lobby_room_is_left_alone(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    code = resp.get_json()["code"]
    _mark_stale(raw_db, code)

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

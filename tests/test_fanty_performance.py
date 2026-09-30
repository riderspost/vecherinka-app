import io
import os

from tests.test_fanty_game import create_fanty_room, join_fanty

ADMIN_LOGIN = {"username": os.environ["ADMIN_USERNAME"], "password": os.environ["ADMIN_PASSWORD"]}


def _add_dare_with_timer_and_music(client):
    client.post("/admin/api/login", json=ADMIN_LOGIN)

    resp = client.post(
        "/admin/api/fanty/upload-audio",
        data={"file": (io.BytesIO(b"fake-mp3-bytes"), "clip.mp3")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    music_filename = resp.get_json()["filename"]

    resp = client.post(
        "/admin/api/fanty/dares",
        json={
            "text": "Уникальный тестовый фант с таймером и музыкой",
            "kind": "solo",
            "categories": ["basic"],
            "locations": ["apartment"],
            "hasTimer": True,
            "timerSeconds": 45,
            "musicFilename": music_filename,
        },
    )
    assert resp.status_code == 200
    dare_id = resp.get_json()["id"]

    client.post("/admin/api/logout")
    return dare_id, music_filename


def test_timer_and_music_dare_exposed_in_state_and_gated_start_performance(client, raw_db):
    dare_id, music_filename = _add_dare_with_timer_and_music(client)

    resp = create_fanty_room(client, game_mode="solo", location="apartment", categories=["basic"])
    body = resp.get_json()
    code, host_id, host_token = body["code"], body["playerId"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    tokens_by_id = {host_id: host_token, bob["playerId"]: bob["token"]}

    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    spinner_token = tokens_by_id[state["fanty"]["nextSpinnerId"]]
    resp = client.post(f"/api/fanty/rooms/{code}/spin", json={"token": spinner_token})
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    picked_id = state["fanty"]["pickedPlayerId"]

    # Force the current round onto our deterministic dare instead of whatever
    # the random spin actually landed on — otherwise this test would be flaky.
    room_row = raw_db.execute("SELECT id FROM rooms WHERE code = ?", (code,)).fetchone()
    raw_db.execute(
        "UPDATE fanty_state SET current_dare_id = ?, current_content_type = 'dare' WHERE room_id = ?",
        (dare_id, room_row["id"]),
    )
    raw_db.commit()

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["hasTimer"] is True
    assert state["fanty"]["timerSeconds"] == 45
    assert state["fanty"]["musicUrl"] == f"/uploads/{music_filename}"
    assert state["fanty"]["performanceStartedAt"] is None

    other_token = next(t for pid, t in tokens_by_id.items() if pid != picked_id)
    resp = client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": other_token})
    assert resp.status_code == 400

    picked_token = tokens_by_id[picked_id]
    resp = client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": picked_token})
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["performanceStartedAt"] is not None

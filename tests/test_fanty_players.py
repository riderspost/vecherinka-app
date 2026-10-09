from tests.test_fanty_game import create_fanty_room, join_fanty


def test_host_can_remove_player_in_lobby(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    join_fanty(client, code, "Carol", "🦊")

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{bob['playerId']}?token={host_token}")
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert all(p["id"] != bob["playerId"] for p in state["players"])

    resp = client.get(f"/api/fanty/rooms/{code}/state?token={bob['token']}")
    assert resp.status_code == 403
    assert "удалили" in resp.get_json()["error"]


def test_remove_blocked_below_min_players(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{bob['playerId']}?token={host_token}")
    assert resp.status_code == 400
    assert "мало игроков" in resp.get_json()["error"]

    # Still fully in the game — not half-removed.
    resp = client.get(f"/api/fanty/rooms/{code}/state?token={bob['token']}")
    assert resp.status_code == 200


def test_remove_blocked_if_it_breaks_gender_parity(client):
    resp = create_fanty_room(client, game_mode="team", pair_mode="mixed", gender="m")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶", gender="f").get_json()
    join_fanty(client, code, "Carol", "🦊", gender="m")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    # Removing Bob (the only "f") would leave two "m" players — blocked even
    # though the headcount (2) still clears the minimum.
    resp = client.delete(f"/api/fanty/rooms/{code}/players/{bob['playerId']}?token={host_token}")
    assert resp.status_code == 400
    assert "обоих полов" in resp.get_json()["error"]


def test_host_cannot_remove_self_or_be_removed(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_id, host_token = body["code"], body["playerId"], body["token"]
    join_fanty(client, code, "Bob", "🐶")

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{host_id}?token={host_token}")
    assert resp.status_code == 400


def test_non_host_cannot_remove_player(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code = body["code"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    carol = join_fanty(client, code, "Carol", "🦊").get_json()

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{carol['playerId']}?token={bob['token']}")
    assert resp.status_code == 403


def test_manage_players_blocked_mid_round(client):
    resp = create_fanty_room(client, game_mode="solo", device_mode="local")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob_resp = client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Bob", "avatarType": "emoji", "avatarValue": "🐶"},
    )
    bob = {"playerId": bob_resp.get_json()["playerId"]}
    client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Carol", "avatarType": "emoji", "avatarValue": "🦊"},
    )
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] != "ready_to_spin"

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{bob['playerId']}?token={host_token}")
    assert resp.status_code == 400
    assert "между раундами" in resp.get_json()["error"]

    resp = client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Dave", "avatarType": "emoji", "avatarValue": "🤖"},
    )
    assert resp.status_code == 400
    assert "между раундами" in resp.get_json()["error"]


def test_removing_next_spinner_reassigns_it(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    carol = join_fanty(client, code, "Carol", "🦊").get_json()
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    room_row = raw_db.execute("SELECT id FROM rooms WHERE code = ?", (code,)).fetchone()
    raw_db.execute(
        "UPDATE fanty_state SET next_spinner_id = ? WHERE room_id = ?", (bob["playerId"], room_row["id"])
    )
    raw_db.commit()

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] == "ready_to_spin"
    assert state["fanty"]["nextSpinnerId"] == bob["playerId"]

    resp = client.delete(f"/api/fanty/rooms/{code}/players/{bob['playerId']}?token={host_token}")
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    remaining_ids = {p["id"] for p in state["players"]}
    assert state["fanty"]["nextSpinnerId"] in remaining_ids
    assert bob["playerId"] not in remaining_ids


def test_add_local_player_allowed_mid_game(client):
    resp = create_fanty_room(client, game_mode="solo", device_mode="local")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Bob", "avatarType": "emoji", "avatarValue": "🐶"},
    )
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Carol", "avatarType": "emoji", "avatarValue": "🦊"},
    )
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert any(p["name"] == "Carol" for p in state["players"])


def test_remote_join_allowed_mid_game_for_fanty(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = join_fanty(client, code, "Carol", "🦊")
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert any(p["name"] == "Carol" for p in state["players"])

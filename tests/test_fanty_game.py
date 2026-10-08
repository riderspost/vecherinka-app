def create_fanty_room(
    client,
    game_mode="solo",
    location="apartment",
    categories=None,
    pick_mode="fair",
    pair_mode="any",
    gender=None,
    device_mode="remote",
    name="Host",
    avatar_value="🙂",
):
    payload = {
        "name": name,
        "avatarType": "emoji",
        "avatarValue": avatar_value,
        "gameMode": game_mode,
        "location": location,
        "categories": categories or ["basic"],
        "pickMode": pick_mode,
        "pairMode": pair_mode,
        "deviceMode": device_mode,
    }
    if gender:
        payload["gender"] = gender
    return client.post("/api/fanty/rooms", json=payload)


def join_fanty(client, code, name, avatar_value, gender=None):
    payload = {"name": name, "avatarType": "emoji", "avatarValue": avatar_value}
    if gender:
        payload["gender"] = gender
    return client.post(f"/api/rooms/{code}/join", json=payload)


def test_create_room_rejects_invalid_game_mode(client):
    resp = create_fanty_room(client, game_mode="bogus")
    assert resp.status_code == 400


def test_create_room_rejects_invalid_category(client):
    resp = create_fanty_room(client, categories=["nonexistent"])
    assert resp.status_code == 400


def test_create_room_rejects_settings_with_no_matching_dares(client):
    # Team + alcohol dares only exist for apartment/bar/country_house, not street.
    resp = create_fanty_room(client, game_mode="team", location="street", categories=["alcohol"])
    assert resp.status_code == 400


def test_solo_start_requires_min_players(client):
    resp = create_fanty_room(client, game_mode="solo")
    assert resp.status_code == 200
    body = resp.get_json()
    code, host_token = body["code"], body["token"]

    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 400

    join_fanty(client, code, "Bob", "🐶")
    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200


def test_solo_spin_and_resolve_cycle(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] == "awaiting_action"
    assert state["fanty"]["contentType"] == "dare"
    assert state["fanty"]["contentText"]

    resp = client.post(
        f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True}
    )
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] == "ready_to_spin"


def test_truth_or_dare_choose_flow(client):
    resp = create_fanty_room(client, game_mode="truth_or_dare")
    body = resp.get_json()
    code, host_id, host_token = body["code"], body["playerId"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    tokens_by_id = {host_id: host_token, bob["playerId"]: bob["token"]}
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] == "awaiting_choice"
    picked_token = tokens_by_id[state["fanty"]["pickedPlayerId"]]

    resp = client.post(
        f"/api/fanty/rooms/{code}/choose", json={"token": picked_token, "choice": "truth"}
    )
    assert resp.status_code == 200

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    assert state["fanty"]["phase"] == "awaiting_action"
    assert state["fanty"]["contentType"] == "truth"
    assert state["fanty"]["contentText"]


def test_choose_rejected_for_non_picked_player(client):
    resp = create_fanty_room(client, game_mode="truth_or_dare")
    body = resp.get_json()
    code, host_id, host_token = body["code"], body["playerId"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    tokens_by_id = {host_id: host_token, bob["playerId"]: bob["token"]}
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    picked_id = state["fanty"]["pickedPlayerId"]
    other_token = next(t for pid, t in tokens_by_id.items() if pid != picked_id)

    resp = client.post(
        f"/api/fanty/rooms/{code}/choose", json={"token": other_token, "choice": "truth"}
    )
    assert resp.status_code == 400


def test_pick_mode_fair_cycles_through_all_players_before_repeating(client):
    resp = create_fanty_room(client, game_mode="solo", pick_mode="fair")
    body = resp.get_json()
    code, host_id, host_token = body["code"], body["playerId"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    tokens_by_id = {host_id: host_token, bob["playerId"]: bob["token"]}
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    picked_ids = []
    for _ in range(2):
        state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
        spinner_token = tokens_by_id[state["fanty"]["nextSpinnerId"]]
        resp = client.post(f"/api/fanty/rooms/{code}/spin", json={"token": spinner_token})
        assert resp.status_code == 200

        state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
        picked_ids.append(state["fanty"]["pickedPlayerId"])

        resp = client.post(
            f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True}
        )
        assert resp.status_code == 200

    assert set(picked_ids) == {host_id, bob["playerId"]}


def test_local_mode_blocks_remote_join(client):
    resp = create_fanty_room(client, game_mode="solo", device_mode="local")
    body = resp.get_json()
    code = body["code"]

    resp = join_fanty(client, code, "Bob", "🐶")
    assert resp.status_code == 400


def test_team_mode_starts_with_two_players(client):
    resp = create_fanty_room(client, game_mode="team")
    assert resp.status_code == 200
    body = resp.get_json()
    code, host_token = body["code"], body["token"]

    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 400  # only the host so far

    join_fanty(client, code, "Bob", "🐶")
    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200


def test_local_mode_host_adds_local_players(client):
    resp = create_fanty_room(client, game_mode="solo", device_mode="local")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]

    resp = client.post(
        f"/api/fanty/rooms/{code}/local-players",
        json={"token": host_token, "name": "Bob", "avatarType": "emoji", "avatarValue": "🐶"},
    )
    assert resp.status_code == 200

    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200


def test_discard_requires_finished_status(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    resp = client.post(f"/api/fanty/rooms/{code}/discard", json={"token": host_token})
    assert resp.status_code == 400

    client.post(f"/api/fanty/rooms/{code}/end", json={"token": host_token})
    resp = client.post(f"/api/fanty/rooms/{code}/discard", json={"token": host_token})
    assert resp.status_code == 200


def test_discard_requires_host(client):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/end", json={"token": host_token})

    resp = client.post(f"/api/fanty/rooms/{code}/discard", json={"token": bob["token"]})
    assert resp.status_code == 400


def test_discard_deletes_room_and_photo_files(client, raw_db):
    import io
    import os

    from PIL import Image

    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})

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
    assert os.path.isfile(thumb_path)

    client.post(
        f"/api/fanty/rooms/{code}/resolve",
        json={"token": host_token, "counted": True, "photoFilenames": [filename]},
    )
    client.post(f"/api/fanty/rooms/{code}/end", json={"token": host_token})

    resp = client.post(f"/api/fanty/rooms/{code}/discard", json={"token": host_token})
    assert resp.status_code == 200

    assert not os.path.isfile(full_path)
    assert not os.path.isfile(thumb_path)
    assert raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None

    # Discarding an already-gone room is a harmless no-op, not an error.
    resp = client.post(f"/api/fanty/rooms/{code}/discard", json={"token": host_token})
    assert resp.status_code == 200


def _reset_dare_likes(raw_db, dare_id):
    # fanty_dares is seed content, not wiped between tests (see conftest.py)
    # — its `likes` column would otherwise carry over counts left by
    # whichever other like/unlike test ran first in this session.
    raw_db.execute("UPDATE fanty_dares SET likes = 0 WHERE id = ?", (dare_id,))
    raw_db.commit()


def test_like_dare_increments_count(client, raw_db):
    dare_id = raw_db.execute("SELECT id FROM fanty_dares LIMIT 1").fetchone()[0]
    _reset_dare_likes(raw_db, dare_id)

    resp = client.post(f"/api/fanty/dares/{dare_id}/like")
    assert resp.status_code == 200
    assert resp.get_json()["likes"] == 1
    resp = client.post(f"/api/fanty/dares/{dare_id}/like")
    assert resp.get_json()["likes"] == 2


def test_unlike_dare_decrements_count_and_floors_at_zero(client, raw_db):
    dare_id = raw_db.execute("SELECT id FROM fanty_dares LIMIT 1").fetchone()[0]
    _reset_dare_likes(raw_db, dare_id)

    client.post(f"/api/fanty/dares/{dare_id}/like")
    resp = client.post(f"/api/fanty/dares/{dare_id}/unlike")
    assert resp.status_code == 200
    assert resp.get_json()["likes"] == 0

    # Doesn't go negative if unliked again with nothing left to remove.
    resp = client.post(f"/api/fanty/dares/{dare_id}/unlike")
    assert resp.get_json()["likes"] == 0


def test_like_dare_unknown_id_404(client):
    resp = client.post("/api/fanty/dares/999999/like")
    assert resp.status_code == 404


def test_unlike_dare_unknown_id_404(client):
    resp = client.post("/api/fanty/dares/999999/unlike")
    assert resp.status_code == 404

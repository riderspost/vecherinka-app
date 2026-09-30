from server.fanty_game import format_team_text

from tests.test_fanty_game import create_fanty_room, join_fanty


def test_format_team_text_substitutes_gender_placeholders():
    text = "{m} says hi to {f}, and {p1} waves at {p2}."
    male = {"name": "Ivan", "gender": "m"}
    female = {"name": "Olga", "gender": "f"}

    assert format_team_text(text, male, female) == "Ivan says hi to Olga, and Ivan waves at Olga."
    assert format_team_text(text, female, male) == "Ivan says hi to Olga, and Olga waves at Ivan."


def test_mixed_team_requires_host_gender(client):
    resp = create_fanty_room(
        client, game_mode="team", pair_mode="mixed", categories=["basic", "flirt"], location="apartment"
    )
    assert resp.status_code == 400


def test_mixed_team_requires_gender_on_join_and_both_genders_to_start(client):
    resp = create_fanty_room(
        client,
        game_mode="team",
        pair_mode="mixed",
        categories=["basic", "flirt"],
        location="apartment",
        gender="m",
    )
    assert resp.status_code == 200
    body = resp.get_json()
    code, host_token = body["code"], body["token"]

    resp = join_fanty(client, code, "Bob", "🐶")
    assert resp.status_code == 400

    join_fanty(client, code, "Bob", "🐶", gender="m")
    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 400

    join_fanty(client, code, "Carol", "🐱", gender="f")
    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200


def test_mixed_pairing_always_opposite_gender(client):
    resp = create_fanty_room(
        client,
        game_mode="team",
        pair_mode="mixed",
        categories=["basic", "flirt"],
        location="apartment",
        gender="m",
    )
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶", gender="m").get_json()
    carol = join_fanty(client, code, "Carol", "🐱", gender="f").get_json()
    dana = join_fanty(client, code, "Dana", "🦊", gender="f").get_json()

    tokens_by_id = {
        body["playerId"]: host_token,
        bob["playerId"]: bob["token"],
        carol["playerId"]: carol["token"],
        dana["playerId"]: dana["token"],
    }

    resp = client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200

    for _ in range(6):
        state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
        assert state["fanty"]["phase"] == "ready_to_spin"
        spinner_token = tokens_by_id[state["fanty"]["nextSpinnerId"]]

        resp = client.post(f"/api/fanty/rooms/{code}/spin", json={"token": spinner_token})
        assert resp.status_code == 200

        state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
        assert state["fanty"]["phase"] == "awaiting_partner_spin"
        picked_id = state["fanty"]["pickedPlayerId"]
        picked_token = tokens_by_id[picked_id]

        resp = client.post(f"/api/fanty/rooms/{code}/spin-partner", json={"token": picked_token})
        assert resp.status_code == 200

        state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
        assert state["fanty"]["phase"] == "awaiting_action"
        partner_id = state["fanty"]["partnerPlayerId"]
        genders = {p["id"]: p["gender"] for p in state["players"]}
        assert genders[picked_id] != genders[partner_id]

        resp = client.post(
            f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True}
        )
        assert resp.status_code == 200

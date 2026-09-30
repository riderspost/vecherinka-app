def create_host(client, name="Host", avatar_value="🙂"):
    resp = client.post(
        "/api/rooms", json={"name": name, "avatarType": "emoji", "avatarValue": avatar_value}
    )
    assert resp.status_code == 200
    return resp.get_json()


def join(client, code, name, avatar_value):
    return client.post(
        f"/api/rooms/{code}/join",
        json={"name": name, "avatarType": "emoji", "avatarValue": avatar_value},
    )


def make_room_with_players(client, n=4):
    room = create_host(client)
    code = room["code"]
    tokens = [(room["playerId"], room["token"])]
    emojis = ["🐶", "🐱", "🦊", "🐸", "🐵", "🦁"]
    for i in range(n - 1):
        resp = join(client, code, f"Player{i}", emojis[i])
        assert resp.status_code == 200
        body = resp.get_json()
        tokens.append((body["playerId"], body["token"]))
    return code, tokens


def test_create_room_and_taken_emojis_shape(client):
    room = create_host(client)
    code = room["code"]

    resp = client.get(f"/api/rooms/{code}/taken-emojis")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["gameType"] == "sentence"
    assert body["status"] == "lobby"
    assert body["deviceMode"] == "remote"
    assert "🙂" in body["taken"]


def test_taken_emojis_unknown_room_404(client):
    resp = client.get("/api/rooms/ZZZZZ/taken-emojis")
    assert resp.status_code == 404


def test_join_duplicate_emoji_rejected(client):
    room = create_host(client)
    resp = join(client, room["code"], "Bob", "🙂")
    assert resp.status_code == 400


def test_join_unknown_room_404(client):
    resp = join(client, "ZZZZZ", "Bob", "🐶")
    assert resp.status_code == 404


def test_start_requires_min_players(client):
    code, tokens = make_room_with_players(client, n=2)
    resp = client.post(f"/api/rooms/{code}/start", json={"token": tokens[0][1]})
    assert resp.status_code == 400


def test_only_host_can_start(client):
    code, tokens = make_room_with_players(client, n=4)
    non_host_token = tokens[1][1]
    resp = client.post(f"/api/rooms/{code}/start", json={"token": non_host_token})
    assert resp.status_code == 400


def test_join_after_start_blocked(client):
    code, tokens = make_room_with_players(client, n=4)
    resp = client.post(f"/api/rooms/{code}/start", json={"token": tokens[0][1]})
    assert resp.status_code == 200

    resp = join(client, code, "Latecomer", "🦉")
    assert resp.status_code == 400


def test_full_round_cycle_reaches_round_results(client):
    code, tokens = make_room_with_players(client, n=4)
    host_token = tokens[0][1]
    resp = client.post(f"/api/rooms/{code}/start", json={"token": host_token})
    assert resp.status_code == 200

    # Answer every prompt assigned to every active player in round 1.
    for _player_id, token in tokens:
        while True:
            state = client.get(f"/api/rooms/{code}/state?token={token}").get_json()
            if state["room"]["status"] != "answering":
                break
            current = state["answering"]["currentPrompt"]
            if current is None:
                break
            resp = client.post(
                f"/api/rooms/{code}/submit",
                json={"token": token, "roundPromptId": current["id"], "answerText": "Тестовый ответ"},
            )
            assert resp.status_code == 200

    state = client.get(f"/api/rooms/{code}/state?token={host_token}").get_json()
    assert state["room"]["status"] == "voting"

    # Vote on every round-prompt until the round-results screen appears.
    for _ in range(50):
        state = client.get(f"/api/rooms/{code}/state?token={host_token}").get_json()
        status = state["room"]["status"]
        if status == "voting":
            submission_id = state["voting"]["submissions"][0]["id"]
            for _player_id, token in tokens:
                pstate = client.get(f"/api/rooms/{code}/state?token={token}").get_json()
                voting = pstate.get("voting")
                if voting and voting["iCanVote"] and not voting["alreadyVoted"]:
                    resp = client.post(
                        f"/api/rooms/{code}/vote",
                        json={"token": token, "submissionId": submission_id},
                    )
                    assert resp.status_code == 200
        elif status == "voting_results":
            resp = client.post(f"/api/rooms/{code}/next", json={"token": host_token})
            assert resp.status_code == 200
        elif status == "round_results":
            break
        else:
            raise AssertionError(f"Unexpected room status while voting: {status}")

    state = client.get(f"/api/rooms/{code}/state?token={host_token}").get_json()
    assert state["room"]["status"] == "round_results"
    assert state["roundResults"]["roundNumber"] == 1
    assert len(state["roundResults"]["roundScores"]) == 4

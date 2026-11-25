"""Removing a player who is gone, and taking a lost seat back with the host's OK."""

import pytest

from tests.test_reverse_game import make_wav, speech_take

EMOJIS = ["🐸", "🦊", "🐼", "🐵", "🐶", "🦁"]


def make_room(client, kind="sentence", players=5, start=True):
    path = "/api/rooms" if kind == "sentence" else "/api/reverse/rooms"
    host = client.post(path, json={"name": "Хост", "avatarType": "emoji", "avatarValue": EMOJIS[0]}).get_json()
    code = host["code"]
    people = [host]
    for i in range(1, players):
        resp = client.post(
            f"/api/rooms/{code}/join", json={"name": f"И{i}", "avatarType": "emoji", "avatarValue": EMOJIS[i]}
        )
        assert resp.status_code == 200, resp.get_json()
        people.append(resp.get_json())
    if start:
        base = "/api/rooms" if kind == "sentence" else "/api/reverse/rooms"
        assert client.post(f"{base}/{code}/start", json={"token": host["token"]}).status_code == 200
    return code, people


def state(client, code, token, kind="sentence"):
    base = "/api/rooms" if kind == "sentence" else "/api/reverse/rooms"
    resp = client.get(f"{base}/{code}/state?token={token}")
    assert resp.status_code == 200
    return resp.get_json()


def kick(client, code, host_token, player_id):
    return client.post(f"/api/rooms/{code}/kick", json={"token": host_token, "playerId": player_id})


def answer_everything(client, code, people):
    for p in people:
        while True:
            s = state(client, code, p["token"])
            a = s.get("answering")
            if s["room"]["status"] != "answering" or not a or a.get("waiting"):
                break
            r = client.post(
                f"/api/rooms/{code}/submit",
                json={"token": p["token"], "roundPromptId": a["currentPrompt"]["id"], "answerText": "ответ"},
            )
            assert r.status_code == 200


# ---- kicking: rules ----


def test_only_the_host_can_kick_and_not_the_host(client):
    code, people = make_room(client, players=5)
    assert kick(client, code, people[1]["token"], people[2]["playerId"]).status_code == 403
    assert kick(client, code, people[0]["token"], people[0]["playerId"]).status_code == 400
    assert kick(client, code, people[0]["token"], "nobody").status_code == 404


def test_cannot_kick_below_the_minimum_once_the_game_runs(client):
    code, people = make_room(client, players=4)  # the sentence game needs 4
    resp = kick(client, code, people[0]["token"], people[1]["playerId"])
    assert resp.status_code == 400
    assert "4" in resp.get_json()["error"]
    assert len(state(client, code, people[0]["token"])["players"]) == 4


def test_can_kick_while_enough_players_remain(client):
    code, people = make_room(client, players=5)
    assert kick(client, code, people[0]["token"], people[4]["playerId"]).status_code == 200
    s = state(client, code, people[0]["token"])
    assert [p["name"] for p in s["players"]] == ["Хост", "И1", "И2", "И3"]
    # the removed player's old session no longer works
    assert client.get(f"/api/rooms/{code}/state?token={people[4]['token']}").status_code == 404
    # and now nobody else can go
    assert kick(client, code, people[0]["token"], people[3]["playerId"]).status_code == 400


def test_in_the_lobby_anyone_can_be_removed(client):
    code, people = make_room(client, players=3, start=False)
    assert kick(client, code, people[0]["token"], people[2]["playerId"]).status_code == 200
    assert kick(client, code, people[0]["token"], people[1]["playerId"]).status_code == 200


# ---- kicking: the game stops waiting ----


def test_sentence_game_moves_on_when_the_missing_player_is_removed(client):
    code, people = make_room(client, players=5)
    answer_everything(client, code, people[:4])  # the fifth never answers
    assert state(client, code, people[0]["token"])["room"]["status"] == "answering"
    assert kick(client, code, people[0]["token"], people[4]["playerId"]).status_code == 200
    assert state(client, code, people[0]["token"])["room"]["status"] == "voting"


def test_sentence_game_voting_does_not_wait_for_a_removed_voter(client):
    code, people = make_room(client, players=5)
    answer_everything(client, code, people)
    host = people[0]
    # everybody who can vote does, except the last of them
    s = state(client, code, host["token"])
    voters = [p for p in people if state(client, code, p["token"])["voting"]["iCanVote"]]
    assert len(voters) >= 2
    for p in voters[:-1]:
        v = state(client, code, p["token"])["voting"]
        client.post(f"/api/rooms/{code}/vote", json={"token": p["token"], "submissionId": v["submissions"][0]["id"]})
    assert state(client, code, host["token"])["room"]["status"] == "voting"
    last = voters[-1]
    if last["token"] == host["token"]:
        pytest.skip("host is the last voter in this shuffle")
    assert kick(client, code, host["token"], last["playerId"]).status_code == 200
    assert state(client, code, host["token"])["room"]["status"] == "voting_results"


# ---- reverse ----


def reverse_roles(client, code, people):
    s = state(client, code, people[0]["token"], "reverse")["reverse"]
    return s["speakerId"], s["imitatorId"], s["roundNumber"]


def test_reverse_round_is_skipped_when_its_imitator_is_removed(client):
    code, people = make_room(client, "reverse", players=4)
    speaker, imitator, number = reverse_roles(client, code, people)
    by_id = {p["playerId"]: p for p in people}
    if imitator == people[0]["playerId"]:
        pytest.skip("host is the imitator in this shuffle")
    assert kick(client, code, people[0]["token"], imitator).status_code == 200
    speaker2, imitator2, number2 = reverse_roles(client, code, people)
    assert number2 > number
    assert imitator not in (speaker2, imitator2)


def test_reverse_cannot_drop_below_two_players(client):
    code, people = make_room(client, "reverse", players=2)
    assert kick(client, code, people[0]["token"], people[1]["playerId"]).status_code == 400


def test_reverse_reveals_when_the_only_missing_guesser_is_removed(client, raw_db):
    code, people = make_room(client, "reverse", players=4)
    speaker, imitator, _ = reverse_roles(client, code, people)
    by_id = {p["playerId"]: p for p in people}
    assert client.post(
        f"/api/reverse/rooms/{code}/original", data={"token": by_id[speaker]["token"], "file": (__import__("io").BytesIO(make_wav(speech_take())), "r.wav")},
        content_type="multipart/form-data",
    ).status_code == 200
    for i in range(2):
        assert client.post(
            f"/api/reverse/rooms/{code}/imitation",
            data={"token": by_id[imitator]["token"], "index": str(i), "file": (__import__("io").BytesIO(make_wav(seconds=1)), "r.wav")},
            content_type="multipart/form-data",
        ).status_code == 200
    guessers = [p for p in people if p["playerId"] != speaker]
    victim = next(p for p in guessers if p["playerId"] != people[0]["playerId"])
    for g in guessers:
        if g is victim:
            continue
        client.post(f"/api/reverse/rooms/{code}/answer", json={"token": g["token"], "optionIndex": 0})
    assert state(client, code, people[0]["token"], "reverse")["reverse"]["phase"] == "guessing"
    assert kick(client, code, people[0]["token"], victim["playerId"]).status_code == 200
    assert state(client, code, people[0]["token"], "reverse")["reverse"]["phase"] == "reveal"


# ---- taking a seat back ----


def claim(client, code, player_id, device="dev-new"):
    return client.post(f"/api/rooms/{code}/claims", json={"playerId": player_id, "deviceId": device})


def test_seats_list_shows_who_is_in_the_room(client):
    code, people = make_room(client, players=4)
    body = client.get(f"/api/rooms/{code}/seats").get_json()
    assert body["status"] != "lobby"
    assert [s["name"] for s in body["seats"]] == ["Хост", "И1", "И2", "И3"]
    assert "token" not in str(body)


def test_a_player_who_is_online_cannot_be_claimed(client):
    code, people = make_room(client, players=5)
    state(client, code, people[2]["token"])  # connected right now
    resp = claim(client, code, people[2]["playerId"])
    assert resp.status_code == 400
    assert "в сети" in resp.get_json()["error"]
    seats = {s["name"]: s for s in client.get(f"/api/rooms/{code}/seats").get_json()["seats"]}
    assert seats["И2"]["online"] is True and seats["И3"]["online"] is False
    # an offline seat is fine
    assert claim(client, code, people[3]["playerId"]).status_code == 200


def test_the_host_seat_cannot_be_claimed(client):
    code, people = make_room(client, players=5)
    assert claim(client, code, people[0]["playerId"]).status_code == 400
    seats = client.get(f"/api/rooms/{code}/seats").get_json()["seats"]
    assert next(s for s in seats if s["isHost"])["name"] == "Хост"


def test_claim_is_refused_in_the_lobby(client):
    code, people = make_room(client, players=3, start=False)
    assert claim(client, code, people[1]["playerId"]).status_code == 400


def test_claim_approved_by_host_hands_over_a_new_token_once(client):
    code, people = make_room(client, players=5)
    lost = people[2]
    body = claim(client, code, lost["playerId"]).get_json()

    # nothing yet, and the host sees the request
    got = client.get(f"/api/rooms/{code}/claims/{body['claimId']}?secret={body['secret']}").get_json()
    assert got == {"status": "pending"}
    pending = state(client, code, people[0]["token"])["pendingClaims"]
    assert [c["playerId"] for c in pending] == [lost["playerId"]]
    assert "pendingClaims" not in state(client, code, people[1]["token"])

    resolve = client.post(
        f"/api/rooms/{code}/claims/{body['claimId']}/resolve", json={"token": people[0]["token"], "approve": True}
    )
    assert resolve.status_code == 200
    got = client.get(f"/api/rooms/{code}/claims/{body['claimId']}?secret={body['secret']}").get_json()
    assert got["status"] == "approved" and got["playerId"] == lost["playerId"]
    new_token = got["token"]
    assert new_token != lost["token"]
    # handed over only once
    assert client.get(f"/api/rooms/{code}/claims/{body['claimId']}?secret={body['secret']}").get_json() == {
        "status": "delivered"
    }
    # the new token is the player; the old one is no longer
    assert state(client, code, new_token)["me"]["id"] == lost["playerId"]
    assert client.get(f"/api/rooms/{code}/state?token={lost['token']}").status_code == 404
    assert state(client, code, people[0]["token"])["pendingClaims"] == []


def test_claim_needs_the_secret_and_the_host_can_deny(client):
    code, people = make_room(client, players=5)
    body = claim(client, code, people[2]["playerId"]).get_json()
    assert client.get(f"/api/rooms/{code}/claims/{body['claimId']}?secret=wrong").status_code == 404
    # only the host may answer
    assert client.post(
        f"/api/rooms/{code}/claims/{body['claimId']}/resolve", json={"token": people[1]["token"], "approve": True}
    ).status_code == 403
    assert client.post(
        f"/api/rooms/{code}/claims/{body['claimId']}/resolve", json={"token": people[0]["token"], "approve": False}
    ).status_code == 200
    got = client.get(f"/api/rooms/{code}/claims/{body['claimId']}?secret={body['secret']}").get_json()
    assert got == {"status": "denied"}
    # the old token still works: nothing was taken
    assert state(client, code, people[2]["token"])["me"]["id"] == people[2]["playerId"]


def test_a_newer_claim_for_the_same_seat_replaces_the_older(client):
    code, people = make_room(client, players=5)
    first = claim(client, code, people[2]["playerId"]).get_json()
    second = claim(client, code, people[2]["playerId"]).get_json()
    assert client.get(f"/api/rooms/{code}/claims/{first['claimId']}?secret={first['secret']}").get_json() == {
        "status": "denied"
    }
    assert len(state(client, code, people[0]["token"])["pendingClaims"]) == 1
    assert second["claimId"] != first["claimId"]


def test_presence_marks_recently_seen_players_online(client):
    code, people = make_room(client, players=5)
    state(client, code, people[1]["token"])  # polling counts as being seen
    s = state(client, code, people[0]["token"])
    online = {p["name"]: p["online"] for p in s["players"]}
    assert online["Хост"] is True and online["И1"] is True
    assert online["И2"] is False  # never polled

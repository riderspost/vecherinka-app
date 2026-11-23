import pytest

from server.reverse_seed import seed_reverse_phrases
from tests.test_admin import admin_login
from tests.test_reverse_game import setup_game, play_to_guessing, get_state

DECOYS = ["Тише ходишь — дольше будешь", "Ближе едешь — тише будешь", "Тише едешь — ближе будешь"]


@pytest.fixture(autouse=True)
def _restore_seed_phrases(raw_db):
    # The test database is shared across the whole run, and these tests add,
    # rename and delete phrases — put the seed set back so later game tests
    # see exactly what a fresh install has.
    yield
    raw_db.execute("DELETE FROM rooms")
    raw_db.execute("DELETE FROM reverse_phrases")
    raw_db.commit()
    seed_reverse_phrases(raw_db)


def add_phrase(client, text="Новая тестовая фраза", decoys=None):
    return client.post(
        "/admin/api/reverse/phrases",
        json={"text": text, "decoys": DECOYS if decoys is None else decoys},
    )


def test_reverse_endpoints_require_admin_login(client):
    assert client.get("/admin/api/reverse/phrases").status_code == 401
    assert add_phrase(client).status_code == 401
    assert client.put("/admin/api/reverse/phrases/1", json={}).status_code == 401
    assert client.delete("/admin/api/reverse/phrases/1").status_code == 401


def test_list_includes_seeded_phrases_with_decoys(client):
    admin_login(client)
    phrases = client.get("/admin/api/reverse/phrases").get_json()
    assert len(phrases) >= 20
    assert all(len(p["decoys"]) >= 3 for p in phrases)
    assert all("uses" in p for p in phrases)


def test_add_edit_delete_phrase(client):
    admin_login(client)
    resp = add_phrase(client, "  Фраза для админки  ")
    assert resp.status_code == 200
    created = resp.get_json()
    assert created["text"] == "Фраза для админки"
    assert created["decoys"] == DECOYS
    phrase_id = created["id"]

    resp = client.put(
        f"/admin/api/reverse/phrases/{phrase_id}",
        json={"text": "Фраза для админки 2", "decoys": DECOYS + ["Четвёртый вариант"]},
    )
    assert resp.status_code == 200
    assert resp.get_json()["decoys"][-1] == "Четвёртый вариант"
    listed = {p["id"]: p for p in client.get("/admin/api/reverse/phrases").get_json()}
    assert listed[phrase_id]["text"] == "Фраза для админки 2"

    assert client.delete(f"/admin/api/reverse/phrases/{phrase_id}").status_code == 200
    assert client.delete(f"/admin/api/reverse/phrases/{phrase_id}").status_code == 404
    assert client.put(f"/admin/api/reverse/phrases/{phrase_id}", json={"text": "x", "decoys": DECOYS}).status_code == 404


def test_decoys_accepted_as_newline_separated_text(client):
    admin_login(client)
    resp = client.post(
        "/admin/api/reverse/phrases",
        json={"text": "Фраза со строками", "decoys": "один\n\n  два  \nтри\nтри"},
    )
    assert resp.status_code == 200
    assert resp.get_json()["decoys"] == ["один", "два", "три"]


def test_validation(client):
    admin_login(client)
    assert add_phrase(client, text="   ").status_code == 400
    assert add_phrase(client, text="а" * 151).status_code == 400
    assert add_phrase(client, decoys=DECOYS[:2]).status_code == 400  # too few
    assert add_phrase(client, decoys=[f"вариант {i}" for i in range(9)]).status_code == 400  # too many
    assert add_phrase(client, text="Фраза", decoys=["Фраза", "б", "в"]).status_code == 400  # decoy == answer
    assert add_phrase(client, decoys=["б", "б", "б"]).status_code == 400  # duplicates collapse below the minimum
    assert add_phrase(client, decoys=["б" * 151, "в", "г"]).status_code == 400


def test_duplicate_text_rejected(client):
    admin_login(client)
    assert add_phrase(client, "Уникальная фраза").status_code == 200
    assert add_phrase(client, "Уникальная фраза").status_code == 400
    other = add_phrase(client, "Другая фраза").get_json()
    resp = client.put(
        f"/admin/api/reverse/phrases/{other['id']}", json={"text": "Уникальная фраза", "decoys": DECOYS}
    )
    assert resp.status_code == 400


def test_phrase_in_unfinished_game_cannot_be_edited_or_deleted(client, raw_db):
    code, tokens, host_token = setup_game(client, players=3)
    play_to_guessing(client, code, tokens)
    phrase_id = raw_db.execute("SELECT phrase_id FROM reverse_rounds").fetchone()["phrase_id"]
    admin_login(client)

    resp = client.put(
        f"/admin/api/reverse/phrases/{phrase_id}", json={"text": "Переписанная фраза", "decoys": DECOYS}
    )
    assert resp.status_code == 400
    assert client.delete(f"/admin/api/reverse/phrases/{phrase_id}").status_code == 400

    uses = {p["id"]: p["uses"] for p in client.get("/admin/api/reverse/phrases").get_json()}
    assert uses[phrase_id] == 1

    # Once the room is gone the phrase is free again.
    client.post(f"/api/rooms/{code}/discard", json={"token": host_token})
    resp = client.put(
        f"/admin/api/reverse/phrases/{phrase_id}", json={"text": "Переписанная фраза", "decoys": DECOYS}
    )
    assert resp.status_code == 200


def test_new_phrase_can_be_picked_by_a_game(client, raw_db):
    admin_login(client)
    raw_db.execute("UPDATE reverse_phrases SET status = 'disabled'")
    raw_db.commit()
    try:
        created = add_phrase(client, "Единственная активная фраза").get_json()
        code, tokens, _ = setup_game(client, players=2)
        any_token = next(iter(tokens.values()))
        rv = get_state(client, code, any_token)["reverse"]
        speaker_token = next(t for pid, t in tokens.items() if pid == rv["speakerId"])
        assert get_state(client, code, speaker_token)["reverse"]["phrase"] == created["text"]
    finally:
        raw_db.execute("UPDATE reverse_phrases SET status = 'active'")
        raw_db.commit()


def test_admin_room_list_counts_reverse_rounds(client):
    code, tokens, _ = setup_game(client, players=3)
    admin_login(client)
    rooms = {r["code"]: r for r in client.get("/admin/api/rooms").get_json()}
    assert rooms[code]["gameType"] == "reverse"
    assert rooms[code]["roundsPlayed"] == 1

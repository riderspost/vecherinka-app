import pytest

from server.reverse_seed import seed_reverse_blocks
from tests.test_admin import admin_login
from tests.test_reverse_game import setup_game, play_to_guessing, get_state

BLOCK = ["Тест раз", "Тест два", "Тест три", "Тест четыре"]


@pytest.fixture(autouse=True)
def _restore_seed(raw_db):
    # The test database is shared across the whole run, and these tests add,
    # edit and delete blocks — put the seed set back so later game tests see
    # exactly what a fresh install has.
    yield
    raw_db.execute("DELETE FROM rooms")
    raw_db.execute("DELETE FROM reverse_phrases")
    raw_db.execute("DELETE FROM reverse_blocks")
    raw_db.commit()
    seed_reverse_blocks(raw_db)


def add_block(client, phrases=None):
    return client.post("/admin/api/reverse/blocks", json={"phrases": BLOCK if phrases is None else phrases})


def test_reverse_endpoints_require_admin_login(client):
    assert client.get("/admin/api/reverse/blocks").status_code == 401
    assert add_block(client).status_code == 401
    assert client.put("/admin/api/reverse/blocks/1", json={}).status_code == 401
    assert client.delete("/admin/api/reverse/blocks/1").status_code == 401


def test_list_includes_seeded_blocks(client):
    admin_login(client)
    blocks = client.get("/admin/api/reverse/blocks").get_json()
    assert len(blocks) >= 20
    assert all(len(b["phrases"]) >= 4 for b in blocks)
    assert all("uses" in b for b in blocks)


def test_add_edit_delete_block(client):
    admin_login(client)
    resp = add_block(client, ["  Тест раз  ", "Тест два", "Тест три", "Тест четыре"])
    assert resp.status_code == 200
    created = resp.get_json()
    assert created["phrases"] == BLOCK
    block_id = created["id"]

    resp = client.put(
        f"/admin/api/reverse/blocks/{block_id}",
        json={"phrases": ["Тест раз", "Тест два", "Тест три", "Тест пять", "Тест шесть"]},
    )
    assert resp.status_code == 200
    assert sorted(resp.get_json()["phrases"]) == sorted(["Тест раз", "Тест два", "Тест три", "Тест пять", "Тест шесть"])
    listed = {b["id"]: b for b in client.get("/admin/api/reverse/blocks").get_json()}
    assert "Тест четыре" not in listed[block_id]["phrases"]

    assert client.delete(f"/admin/api/reverse/blocks/{block_id}").status_code == 200
    assert client.delete(f"/admin/api/reverse/blocks/{block_id}").status_code == 404
    assert client.put(f"/admin/api/reverse/blocks/{block_id}", json={"phrases": BLOCK}).status_code == 404
    all_texts = {t for b in client.get("/admin/api/reverse/blocks").get_json() for t in b["phrases"]}
    assert not all_texts & set(BLOCK + ["Тест пять", "Тест шесть"])


def test_phrases_accepted_as_newline_separated_text(client):
    admin_login(client)
    resp = client.post(
        "/admin/api/reverse/blocks", json={"phrases": "один\n\n  два  \nтри\nчетыре\nчетыре"}
    )
    assert resp.status_code == 200
    assert resp.get_json()["phrases"] == ["один", "два", "три", "четыре"]


def test_validation(client):
    admin_login(client)
    assert add_block(client, []).status_code == 400
    assert add_block(client, BLOCK[:3]).status_code == 400  # fewer than the 4 options a round shows
    assert add_block(client, ["а", "а", "а", "а"]).status_code == 400  # duplicates collapse to one
    assert add_block(client, [f"фраза {i}" for i in range(9)]).status_code == 400  # too many
    assert add_block(client, ["б" * 151, "в", "г", "д"]).status_code == 400


def test_a_phrase_cannot_live_in_two_blocks(client):
    admin_login(client)
    assert add_block(client).status_code == 200
    resp = add_block(client, ["Тест раз", "Другая два", "Другая три", "Другая четыре"])
    assert resp.status_code == 400
    assert "Тест раз" in resp.get_json()["error"]

    other = add_block(client, ["Другая раз", "Другая два", "Другая три", "Другая четыре"]).get_json()
    resp = client.put(
        f"/admin/api/reverse/blocks/{other['id']}",
        json={"phrases": ["Тест раз", "Другая два", "Другая три", "Другая четыре"]},
    )
    assert resp.status_code == 400


def test_block_in_unfinished_game_cannot_be_edited_or_deleted(client, raw_db):
    code, tokens, host_token = setup_game(client, players=3)
    play_to_guessing(client, code, tokens)
    block_id = raw_db.execute(
        "SELECT p.block_id FROM reverse_rounds rr JOIN reverse_phrases p ON p.id = rr.phrase_id"
    ).fetchone()["block_id"]
    admin_login(client)
    current = [r["text"] for r in raw_db.execute("SELECT text FROM reverse_phrases WHERE block_id = ?", (block_id,))]

    resp = client.put(f"/admin/api/reverse/blocks/{block_id}", json={"phrases": current[:4] + ["Новая фраза"]})
    assert resp.status_code == 400
    assert client.delete(f"/admin/api/reverse/blocks/{block_id}").status_code == 400
    uses = {b["id"]: b["uses"] for b in client.get("/admin/api/reverse/blocks").get_json()}
    assert uses[block_id] == 1

    # Once the room is gone the block is free again.
    client.post(f"/api/rooms/{code}/discard", json={"token": host_token})
    resp = client.put(f"/admin/api/reverse/blocks/{block_id}", json={"phrases": current[:4] + ["Новая фраза"]})
    assert resp.status_code == 200


def test_a_phrase_that_was_played_cannot_be_dropped_from_its_block(client, raw_db):
    code, tokens, host_token = setup_game(client, players=2)
    play_to_guessing(client, code, tokens)
    for _ in range(2):  # finish the game so the block is no longer "in an unfinished game"
        client.post(f"/api/reverse/rooms/{code}/skip", json={"token": host_token})
    assert get_state(client, code, host_token)["room"]["status"] == "finished"
    row = raw_db.execute(
        "SELECT p.block_id, p.text FROM reverse_rounds rr JOIN reverse_phrases p ON p.id = rr.phrase_id LIMIT 1"
    ).fetchone()
    admin_login(client)
    others = [
        r["text"]
        for r in raw_db.execute("SELECT text FROM reverse_phrases WHERE block_id = ? AND text != ?", (row["block_id"], row["text"]))
    ]
    resp = client.put(f"/admin/api/reverse/blocks/{row['block_id']}", json={"phrases": others[:3] + ["Новая А", "Новая Б"]})
    assert resp.status_code == 400
    assert row["text"] in resp.get_json()["error"]
    # Nothing was half-applied.
    current = [r["text"] for r in raw_db.execute("SELECT text FROM reverse_phrases WHERE block_id = ?", (row["block_id"],))]
    assert row["text"] in current and "Новая А" not in current


def test_new_block_can_be_played(client, raw_db):
    admin_login(client)
    raw_db.execute("UPDATE reverse_blocks SET status = 'disabled'")
    raw_db.commit()
    created = add_block(client).get_json()
    code, tokens, _ = setup_game(client, players=2)
    any_token = next(iter(tokens.values()))
    speaker_id = get_state(client, code, any_token)["reverse"]["speakerId"]
    rv = get_state(client, code, tokens[speaker_id])["reverse"]
    assert rv["phrase"] in created["phrases"]


def test_admin_room_list_counts_reverse_rounds(client):
    code, tokens, _ = setup_game(client, players=3)
    admin_login(client)
    rooms = {r["code"]: r for r in client.get("/admin/api/rooms").get_json()}
    assert rooms[code]["gameType"] == "reverse"
    assert rooms[code]["roundsPlayed"] == 1

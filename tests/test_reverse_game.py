import array
import io
import json
import os
import wave

from server.reverse_game import MIN_PLAYERS, split_chunks, total_rounds_for, roles_for_round
from server.reverse_seed import PHRASES
from server.rooms_common import UPLOAD_DIR

EMOJIS = ["🐸", "🦊", "🐼", "🐵", "🐶"]


def make_wav(samples=None, rate=16000, channels=1, seconds=1.0):
    if samples is None:
        samples = [(i * 37) % 2000 - 1000 for i in range(int(rate * seconds))]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(array.array("h", samples * channels if channels > 1 else samples).tobytes())
    return buf.getvalue()


def read_samples(filename):
    with wave.open(os.path.join(UPLOAD_DIR, filename), "rb") as w:
        arr = array.array("h")
        arr.frombytes(w.readframes(w.getnframes()))
    return list(arr)


def create_room(client, name="Host", avatar="🙂"):
    resp = client.post("/api/reverse/rooms", json={"name": name, "avatarType": "emoji", "avatarValue": avatar})
    assert resp.status_code == 200
    return resp.get_json()


def join(client, code, name, avatar, device_id=None):
    payload = {"name": name, "avatarType": "emoji", "avatarValue": avatar}
    if device_id:
        payload["deviceId"] = device_id
    return client.post(f"/api/rooms/{code}/join", json=payload)


def get_state(client, code, token):
    resp = client.get(f"/api/reverse/rooms/{code}/state?token={token}")
    assert resp.status_code == 200
    return resp.get_json()


def upload(client, code, token, kind, data, index=None):
    form = {"token": token, "file": (io.BytesIO(data), "rec.wav")}
    if index is not None:
        form["index"] = str(index)
    return client.post(f"/api/reverse/rooms/{code}/{kind}", data=form, content_type="multipart/form-data")


def setup_game(client, players=3):
    """Creates a room with `players` players, starts it; returns (code, tokens_by_id, host_token)."""
    host = create_room(client)
    code = host["code"]
    tokens = {host["playerId"]: host["token"]}
    for i in range(players - 1):
        resp = join(client, code, f"P{i}", EMOJIS[i])
        assert resp.status_code == 200
        tokens[resp.get_json()["playerId"]] = resp.get_json()["token"]
    resp = client.post(f"/api/reverse/rooms/{code}/start", json={"token": host["token"]})
    assert resp.status_code == 200
    return code, tokens, host["token"]


def round_roles(client, code, tokens):
    any_token = next(iter(tokens.values()))
    rv = get_state(client, code, any_token)["reverse"]
    return rv["speakerId"], rv["imitatorId"], rv


def distinct_chunk(n, seed):
    """A chunk whose samples are unique to (seed), so merges can be checked sample by sample."""
    return [((seed * 7919 + i * 31) % 30000) - 15000 for i in range(n)]


def upload_all(client, code, token, kind, count, seed_base=1):
    """Uploads `count` chunks in order; returns the sample lists that were sent."""
    sent = []
    for i in range(count):
        samples = distinct_chunk(4000 + 100 * i, seed_base + i)
        resp = upload(client, code, token, kind, make_wav(samples), index=i)
        assert resp.status_code == 200, resp.get_json()
        sent.append(samples)
    return sent


def play_to_guessing(client, code, tokens):
    speaker, imitator, rv = round_roles(client, code, tokens)
    count = rv["chunkCount"]
    upload_all(client, code, tokens[speaker], "original", count)
    upload_all(client, code, tokens[imitator], "imitation", count)
    return speaker, imitator


def test_seed_has_twenty_phrases_loaded(raw_db):
    count = raw_db.execute("SELECT COUNT(*) AS c FROM reverse_phrases WHERE status = 'active'").fetchone()["c"]
    assert count >= len(PHRASES) >= 20


def test_seed_phrases_have_lookalike_decoys():
    texts = [entry["text"] for entry in PHRASES]
    assert len(set(texts)) == len(texts)
    for entry in PHRASES:
        decoys = entry["decoys"]
        assert len(decoys) >= 3
        assert entry["text"] not in decoys
        assert len(set(decoys)) == len(decoys)
        # Lookalikes: about the same number of words as the answer, so the
        # length of the recording alone doesn't give the right one away.
        assert all(abs(len(d.split()) - len(entry["text"].split())) <= 1 for d in decoys)
        # And not just the same phrase with a different last letter or two:
        # each decoy must still share most of its words with the answer.
        answer_words = set(entry["text"].lower().split())
        assert all(len(answer_words & set(d.lower().split())) >= len(answer_words) // 2 for d in decoys)


def test_join_reports_game_type(client):
    room = create_room(client)
    resp = client.get(f"/api/rooms/{room['code']}/taken-emojis")
    assert resp.get_json()["gameType"] == "reverse"


def test_start_needs_host_and_enough_players(client):
    room = create_room(client)
    code = room["code"]
    resp = client.post(f"/api/reverse/rooms/{code}/start", json={"token": room["token"]})
    assert resp.status_code == 400  # alone in the room
    guest = join(client, code, "Guest", "🐸").get_json()
    resp = client.post(f"/api/reverse/rooms/{code}/start", json={"token": guest["token"]})
    assert resp.status_code == 400  # only the host can start
    resp = client.post(f"/api/reverse/rooms/{code}/start", json={"token": room["token"]})
    assert resp.status_code == 200
    assert MIN_PLAYERS == 2


def test_two_player_game_works_end_to_end(client):
    code, tokens, host_token = setup_game(client, players=2)
    for round_number in (1, 2):
        speaker, imitator, rv = round_roles(client, code, tokens)
        assert rv["roundNumber"] == round_number
        assert speaker != imitator
        play_to_guessing(client, code, tokens)
        rv = get_state(client, code, tokens[imitator])["reverse"]
        assert rv["guesserCount"] == 1  # only the imitator can guess
        assert len(rv["options"]) == 4
        client.post(f"/api/reverse/rooms/{code}/answer", json={"token": tokens[imitator], "optionIndex": 0})
        assert get_state(client, code, tokens[imitator])["reverse"]["phase"] == "reveal"
        assert client.post(f"/api/reverse/rooms/{code}/next", json={"token": host_token}).status_code == 200
    state = get_state(client, code, host_token)
    assert state["room"]["status"] == "finished"
    assert len(state["summary"]) == 2


def test_same_device_cannot_join_twice(client):
    room = create_room(client)
    assert join(client, room["code"], "A", "🐸", device_id="dev-1").status_code == 200
    assert join(client, room["code"], "B", "🦊", device_id="dev-1").status_code == 400
    assert join(client, room["code"], "C", "🐼", device_id="dev-2").status_code == 200


def test_phrase_only_visible_to_speaker(client):
    code, tokens, _ = setup_game(client)
    speaker, _imitator, _ = round_roles(client, code, tokens)
    for pid, token in tokens.items():
        rv = get_state(client, code, token)["reverse"]
        assert rv["phase"] == "recording_original"
        if pid == speaker:
            assert rv["phrase"]
        else:
            assert "phrase" not in rv
            assert "options" not in rv


def test_split_chunks_makes_pieces_of_two_words():
    assert split_chunks("Тёща купила зелёный чемодан") == ["Тёща купила", "зелёный чемодан"]
    assert split_chunks("Дядя Миша ловит синих лягушек") == ["Дядя Миша", "ловит синих", "лягушек"]
    assert split_chunks("Поезд опоздал из-за пингвина") == ["Поезд опоздал", "из-за пингвина"]
    assert split_chunks("Один") == ["Один"]
    # A dash standing alone sticks to the word before it instead of being a "word".
    assert split_chunks("Тише едешь — дальше будешь") == ["Тише едешь —", "дальше будешь"]


def test_round_has_chunks_and_only_speaker_sees_the_text(client):
    code, tokens, _ = setup_game(client)
    speaker, _imitator, _ = round_roles(client, code, tokens)
    for pid, token in tokens.items():
        rv = get_state(client, code, token)["reverse"]
        assert rv["chunkCount"] >= 2
        assert rv["originalDone"] == 0
        if pid == speaker:
            assert len(rv["chunks"]) == rv["chunkCount"]
            assert " ".join(rv["chunks"]) == rv["phrase"]
        else:
            assert "chunks" not in rv


def test_original_chunk_upload_rules(client):
    code, tokens, _ = setup_game(client)
    speaker, imitator, rv = round_roles(client, code, tokens)
    good = make_wav(distinct_chunk(4000, 1))
    assert upload(client, code, tokens[imitator], "original", good, index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", b"not a wav", index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", make_wav(channels=2), index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", make_wav(seconds=0.05), index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", make_wav(seconds=9), index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", make_wav(rate=4000), index=0).status_code == 400
    assert upload(client, code, tokens[speaker], "original", good, index=1).status_code == 400  # out of order
    assert get_state(client, code, tokens[speaker])["reverse"]["originalDone"] == 0

    assert upload(client, code, tokens[speaker], "original", good, index=0).status_code == 200
    state = get_state(client, code, tokens[speaker])["reverse"]
    assert state["originalDone"] == 1
    assert state["phase"] == "recording_original"  # more pieces still to come
    assert upload(client, code, tokens[speaker], "original", good, index=0).status_code == 400  # already recorded

    for i in range(1, rv["chunkCount"]):
        assert upload(client, code, tokens[speaker], "original", good, index=i).status_code == 200
    assert get_state(client, code, tokens[speaker])["reverse"]["phase"] == "recording_imitation"
    assert upload(client, code, tokens[speaker], "original", good).status_code == 400  # phase moved on


def test_chunks_with_a_different_sample_rate_are_rejected(client):
    code, tokens, _ = setup_game(client)
    speaker, _imitator, _ = round_roles(client, code, tokens)
    assert upload(client, code, tokens[speaker], "original", make_wav(rate=16000), index=0).status_code == 200
    resp = upload(client, code, tokens[speaker], "original", make_wav(rate=22050), index=1)
    assert resp.status_code == 400
    assert get_state(client, code, tokens[speaker])["reverse"]["originalDone"] == 1


def test_whole_recording_is_the_pieces_glued_and_reversed(client, raw_db):
    code, tokens, _ = setup_game(client)
    speaker, _imitator, rv = round_roles(client, code, tokens)
    sent = upload_all(client, code, tokens[speaker], "original", rv["chunkCount"])
    row = raw_db.execute("SELECT original_file, reversed_file FROM reverse_rounds").fetchone()
    glued = [x for chunk in sent for x in chunk]
    assert read_samples(row["original_file"]) == glued
    assert read_samples(row["reversed_file"]) == glued[::-1]


def test_imitator_gets_whole_reversed_clip_then_pieces_last_words_first(client, raw_db):
    code, tokens, _ = setup_game(client)
    speaker, imitator, rv = round_roles(client, code, tokens)
    sent = upload_all(client, code, tokens[speaker], "original", rv["chunkCount"])

    for pid, token in tokens.items():
        view = get_state(client, code, token)["reverse"]
        assert view["phase"] == "recording_imitation"
        assert "originalUrl" not in view
        if pid != imitator:
            assert "reversedUrl" not in view and "portions" not in view
    view = get_state(client, code, tokens[imitator])["reverse"]
    assert view["reversedUrl"].endswith("_rev.wav")
    assert len(view["portions"]) == rv["chunkCount"]
    # Portion j is the j-th piece from the end of the phrase, itself reversed.
    for j, url in enumerate(view["portions"]):
        assert url.endswith("_rev.wav")
        assert read_samples(url.rsplit("/", 1)[1]) == sent[rv["chunkCount"] - 1 - j][::-1]


def test_imitation_chunk_upload_rules(client):
    code, tokens, _ = setup_game(client)
    speaker, imitator, rv = round_roles(client, code, tokens)
    good = make_wav(distinct_chunk(4000, 1))
    assert upload(client, code, tokens[imitator], "imitation", good, index=0).status_code == 400  # too early
    upload_all(client, code, tokens[speaker], "original", rv["chunkCount"])
    assert upload(client, code, tokens[speaker], "imitation", good, index=0).status_code == 400
    assert upload(client, code, tokens[imitator], "imitation", good, index=1).status_code == 400
    assert upload(client, code, tokens[imitator], "imitation", good, index=0).status_code == 200
    state = get_state(client, code, tokens[imitator])["reverse"]
    assert state["imitationDone"] == 1 and state["phase"] == "recording_imitation"
    for i in range(1, rv["chunkCount"]):
        assert upload(client, code, tokens[imitator], "imitation", good, index=i).status_code == 200
    assert get_state(client, code, tokens[imitator])["reverse"]["phase"] == "guessing"


def test_guessers_hear_the_imitations_glued_in_order_and_reversed(client, raw_db):
    code, tokens, _ = setup_game(client)
    speaker, imitator, rv = round_roles(client, code, tokens)
    upload_all(client, code, tokens[speaker], "original", rv["chunkCount"])
    heard = upload_all(client, code, tokens[imitator], "imitation", rv["chunkCount"], seed_base=50)
    row = raw_db.execute("SELECT imitation_file, imitation_back_file FROM reverse_rounds").fetchone()
    glued = [x for chunk in heard for x in chunk]
    assert read_samples(row["imitation_file"]) == glued
    # Reversing the whole turns "last words first, each reversed" back into reading order.
    assert read_samples(row["imitation_back_file"]) == glued[::-1]


def test_perfect_imitation_reproduces_the_original(client, raw_db):
    """If the imitator repeats every portion exactly, the guessers hear the original phrase."""
    code, tokens, _ = setup_game(client)
    speaker, imitator, rv = round_roles(client, code, tokens)
    sent = upload_all(client, code, tokens[speaker], "original", rv["chunkCount"])
    view = get_state(client, code, tokens[imitator])["reverse"]
    for j, url in enumerate(view["portions"]):
        portion = read_samples(url.rsplit("/", 1)[1])
        assert upload(client, code, tokens[imitator], "imitation", make_wav(portion), index=j).status_code == 200
    row = raw_db.execute("SELECT imitation_back_file FROM reverse_rounds").fetchone()
    assert read_samples(row["imitation_back_file"]) == [x for chunk in sent for x in chunk]


def test_guessing_options_and_scoring(client, raw_db):
    code, tokens, host_token = setup_game(client)
    speaker, imitator = play_to_guessing(client, code, tokens)
    rv = get_state(client, code, tokens[imitator])["reverse"]
    assert rv["phase"] == "guessing"
    assert len(rv["options"]) == 4
    assert len(set(rv["options"])) == 4
    assert rv["guessUrl"].endswith("_rev.wav")
    assert "correctIndex" not in rv
    assert "phrase" not in rv
    assert rv["guesserCount"] == 2

    row = raw_db.execute("SELECT correct_index FROM reverse_rounds").fetchone()
    correct = row["correct_index"]
    wrong = (correct + 1) % 4
    guessers = [pid for pid in tokens if pid != speaker]

    def answer(pid, idx):
        return client.post(
            f"/api/reverse/rooms/{code}/answer", json={"token": tokens[pid], "optionIndex": idx}
        )

    assert answer(speaker, correct).status_code == 400
    assert answer(guessers[0], 9).status_code == 400
    assert answer(guessers[0], correct).status_code == 200
    assert answer(guessers[0], wrong).status_code == 400  # already answered
    mid = get_state(client, code, tokens[guessers[1]])["reverse"]
    assert mid["phase"] == "guessing"
    assert mid["answeredCount"] == 1

    assert answer(guessers[1], wrong).status_code == 200  # last guesser — auto reveal
    rv = get_state(client, code, tokens[guessers[1]])["reverse"]
    assert rv["phase"] == "reveal"
    assert rv["correctIndex"] == correct
    assert rv["phrase"] == rv["options"][correct]
    assert rv["originalUrl"] and rv["imitationUrl"]

    scores = {p["id"]: p["totalScore"] for p in get_state(client, code, host_token)["players"]}
    assert scores[guessers[0]] == 1
    assert scores[guessers[1]] == 0
    assert scores[speaker] == 1  # one correct guesser -> one point for the speaker


def test_speaker_earns_a_point_per_correct_guesser(client, raw_db):
    code, tokens, host_token = setup_game(client, players=4)
    speaker, _imitator = play_to_guessing(client, code, tokens)
    correct = raw_db.execute("SELECT correct_index FROM reverse_rounds").fetchone()["correct_index"]
    for pid, token in tokens.items():
        if pid != speaker:
            client.post(f"/api/reverse/rooms/{code}/answer", json={"token": token, "optionIndex": correct})
    scores = {p["id"]: p["totalScore"] for p in get_state(client, code, host_token)["players"]}
    assert scores[speaker] == 3
    assert sorted(scores.values()) == [1, 1, 1, 3]


def test_host_can_force_reveal(client):
    code, tokens, host_token = setup_game(client)
    speaker, imitator = play_to_guessing(client, code, tokens)
    non_host = next(t for t in tokens.values() if t != host_token)
    resp = client.post(f"/api/reverse/rooms/{code}/reveal", json={"token": non_host})
    assert resp.status_code == 400
    resp = client.post(f"/api/reverse/rooms/{code}/reveal", json={"token": host_token})
    assert resp.status_code == 200
    assert get_state(client, code, host_token)["reverse"]["phase"] == "reveal"
    resp = client.post(f"/api/reverse/rooms/{code}/reveal", json={"token": host_token})
    assert resp.status_code == 400


def finish_round(client, code, tokens, host_token):
    speaker, imitator = play_to_guessing(client, code, tokens)
    client.post(f"/api/reverse/rooms/{code}/reveal", json={"token": host_token})
    return speaker, imitator


def test_full_game_covers_every_pair_and_finishes(client):
    code, tokens, host_token = setup_game(client, players=3)
    pairs = []
    for round_number in range(1, 7):  # 3 players -> 3 * 2 rounds
        _, _, rv = round_roles(client, code, tokens)
        assert rv["roundNumber"] == round_number
        assert rv["totalRounds"] == 6
        speaker, imitator = finish_round(client, code, tokens, host_token)
        assert speaker != imitator
        pairs.append((speaker, imitator))
        resp = client.post(f"/api/reverse/rooms/{code}/next", json={"token": host_token})
        assert resp.status_code == 200
    # every ordered (speaker, imitator) pair exactly once
    assert len(set(pairs)) == 6
    assert set(pairs) == {(a, b) for a in tokens for b in tokens if a != b}
    state = get_state(client, code, host_token)
    assert state["room"]["status"] == "finished"
    assert len(state["summary"]) == 6
    assert all(item["phrase"] for item in state["summary"])


def test_phrases_do_not_repeat_within_a_game(client, raw_db):
    code, tokens, host_token = setup_game(client, players=3)
    for _ in range(3):
        finish_round(client, code, tokens, host_token)
        client.post(f"/api/reverse/rooms/{code}/next", json={"token": host_token})
    used = [r["phrase_id"] for r in raw_db.execute("SELECT phrase_id FROM reverse_rounds").fetchall()]
    assert len(used) >= 3
    assert len(set(used)) == len(used)


def test_next_only_from_reveal_and_only_host(client):
    code, tokens, host_token = setup_game(client)
    resp = client.post(f"/api/reverse/rooms/{code}/next", json={"token": host_token})
    assert resp.status_code == 400
    finish_round(client, code, tokens, host_token)
    non_host = next(t for t in tokens.values() if t != host_token)
    assert client.post(f"/api/reverse/rooms/{code}/next", json={"token": non_host}).status_code == 400
    assert client.post(f"/api/reverse/rooms/{code}/next", json={"token": host_token}).status_code == 200


def test_host_can_skip_a_stuck_round(client):
    code, tokens, host_token = setup_game(client)
    non_host = next(t for t in tokens.values() if t != host_token)
    assert client.post(f"/api/reverse/rooms/{code}/skip", json={"token": non_host}).status_code == 400
    assert client.post(f"/api/reverse/rooms/{code}/skip", json={"token": host_token}).status_code == 200
    assert get_state(client, code, host_token)["reverse"]["roundNumber"] == 2


def test_skipping_the_last_round_finishes_the_game(client):
    code, tokens, host_token = setup_game(client, players=3)
    for _ in range(6):
        client.post(f"/api/reverse/rooms/{code}/skip", json={"token": host_token})
    state = get_state(client, code, host_token)
    assert state["room"]["status"] == "finished"
    assert state["summary"] == []


def test_discard_removes_audio_files(client, raw_db):
    code, tokens, host_token = setup_game(client)
    play_to_guessing(client, code, tokens)
    row = raw_db.execute(
        "SELECT original_file, reversed_file, imitation_file, imitation_back_file FROM reverse_rounds"
    ).fetchone()
    files = list(row)
    chunk_rows = raw_db.execute("SELECT file, reversed_file FROM reverse_chunks").fetchall()
    for chunk in chunk_rows:
        files.extend(chunk)
    assert len(chunk_rows) >= 4  # 2+ pieces, recorded by both the speaker and the imitator
    assert len(files) == 4 + 2 * len(chunk_rows)
    assert all(os.path.exists(os.path.join(UPLOAD_DIR, f)) for f in files)
    resp = client.post(f"/api/rooms/{code}/discard", json={"token": host_token})
    assert resp.status_code == 200
    assert not any(os.path.exists(os.path.join(UPLOAD_DIR, f)) for f in files)
    assert client.get(f"/api/reverse/rooms/{code}/state?token={host_token}").status_code == 404


def test_other_game_rooms_are_not_reachable_through_reverse_api(client):
    resp = client.post("/api/rooms", json={"name": "Host", "avatarType": "emoji", "avatarValue": "🙂"})
    data = resp.get_json()
    resp = client.get(f"/api/reverse/rooms/{data['code']}/state?token={data['token']}")
    assert resp.status_code == 404


def test_round_count_is_players_times_players_minus_one():
    assert [total_rounds_for(n) for n in (2, 3, 4, 5, 8)] == [2, 6, 12, 20, 56]


def test_every_pair_meets_once_and_each_lap_is_fair():
    for n in (2, 3, 4, 5, 7):
        order = [f"p{i}" for i in range(n)]
        rounds = [roles_for_round(order, r) for r in range(1, total_rounds_for(n) + 1)]
        assert len(set(rounds)) == len(rounds) == n * (n - 1)
        assert all(speaker != imitator for speaker, imitator in rounds)
        # After every full lap of n rounds everybody has spoken the same number of times,
        # so ending the game early never favours anyone.
        for lap_end in range(n, len(rounds) + 1, n):
            spoke = [speaker for speaker, _ in rounds[:lap_end]]
            assert all(spoke.count(p) == lap_end // n for p in order)
        # ...and the same goes for repeating.
        for lap_end in range(n, len(rounds) + 1, n):
            repeated = [imitator for _, imitator in rounds[:lap_end]]
            assert all(repeated.count(p) == lap_end // n for p in order)
        # Nobody speaks two rounds in a row (when there is anyone else to ask).
        if n > 2:
            assert all(rounds[i][0] != rounds[i + 1][0] for i in range(len(rounds) - 1))


def test_four_player_game_plays_all_twelve_rounds(client, raw_db):
    code, tokens, host_token = setup_game(client, players=4)
    assert get_state(client, code, host_token)["reverse"]["totalRounds"] == 12
    for _ in range(12):
        assert client.post(f"/api/reverse/rooms/{code}/skip", json={"token": host_token}).status_code == 200
    assert get_state(client, code, host_token)["room"]["status"] == "finished"
    pairs = {(r["speaker_id"], r["imitator_id"]) for r in raw_db.execute("SELECT * FROM reverse_rounds").fetchall()}
    assert len(pairs) == 12


def test_host_can_end_the_game_early(client):
    code, tokens, host_token = setup_game(client, players=4)
    non_host = next(t for t in tokens.values() if t != host_token)
    assert client.post(f"/api/reverse/rooms/{code}/end", json={"token": non_host}).status_code == 400
    finish_round(client, code, tokens, host_token)
    assert client.post(f"/api/reverse/rooms/{code}/end", json={"token": host_token}).status_code == 200
    state = get_state(client, code, host_token)
    assert state["room"]["status"] == "finished"
    assert len(state["summary"]) == 1  # only the round that was actually played
    assert client.post(f"/api/reverse/rooms/{code}/end", json={"token": host_token}).status_code == 400

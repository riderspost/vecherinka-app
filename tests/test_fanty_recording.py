import io
import os

from tests.test_fanty_game import create_fanty_room, join_fanty


def _start_timed_round(client, raw_db, has_recording=True, has_timer=True):
    """Solo room on one phone-less setup: host + Bob, host spins, and the
    round's dare is swapped for one with a timer (and recording)."""
    body = create_fanty_room(client, game_mode="solo").get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    cur = raw_db.execute(
        "INSERT INTO fanty_dares (text, kind, status, has_timer, timer_seconds, has_recording) "
        "VALUES (?, 'solo', 'active', ?, 30, ?)",
        (f"Зачитай реп {os.urandom(4).hex()}", int(has_timer), int(has_recording)),
    )
    dare_id = cur.lastrowid
    raw_db.execute(
        "UPDATE fanty_state SET current_dare_id = ?, current_content_type = 'dare', current_truth_id = NULL "
        "WHERE room_id = (SELECT id FROM rooms WHERE code = ?)",
        (dare_id, code),
    )
    raw_db.commit()
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    performer = state["fanty"]["pickedPlayerId"]
    tokens = {"host": host_token, "bob": bob["token"]}
    performer_token = tokens["host"] if performer == state["me"]["id"] else tokens["bob"]
    return code, host_token, performer_token, tokens


def _upload(client, code, token, name="recording.wav"):
    return client.post(
        f"/api/fanty/rooms/{code}/upload-recording",
        data={"token": token, "file": (io.BytesIO(b"RIFF....WAVEfmt "), name)},
        content_type="multipart/form-data",
    )


def test_dare_without_recording_flag_has_no_recording(client, raw_db):
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db, has_recording=False)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    fanty = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert fanty["hasRecording"] is False
    assert _upload(client, code, performer_token).status_code == 400


def test_recording_is_only_for_timed_dares(client, raw_db):
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db, has_timer=False)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    fanty = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert fanty["hasRecording"] is False


def test_recording_must_wait_for_the_performance_to_start(client, raw_db):
    code, _host, performer_token, _ = _start_timed_round(client, raw_db)
    assert _upload(client, code, performer_token).status_code == 400


def test_only_the_performer_can_upload(client, raw_db):
    code, host_token, performer_token, tokens = _start_timed_round(client, raw_db)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    other = tokens["bob"] if performer_token == tokens["host"] else tokens["host"]
    assert _upload(client, code, other).status_code == 400
    assert _upload(client, code, performer_token).status_code == 200


def test_rejects_non_audio_files(client, raw_db):
    code, _host, performer_token, _ = _start_timed_round(client, raw_db)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    assert _upload(client, code, performer_token, name="virus.exe").status_code == 400


def test_recording_shows_in_state_then_moves_to_the_round_summary(client, raw_db):
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    fanty = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert fanty["hasRecording"] is True
    assert fanty["recordingUrl"] is None

    url = None
    resp = _upload(client, code, performer_token)
    assert resp.status_code == 200
    url = "/uploads/" + resp.get_json()["filename"]
    fanty = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert fanty["recordingUrl"] == url

    client.post(f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True})
    client.post(f"/api/fanty/rooms/{code}/end", json={"token": host_token})
    summary = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["summary"]
    assert summary[0]["recording"] == url


def test_failed_flag_is_visible_to_everyone(client, raw_db):
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    resp = client.post(
        f"/api/fanty/rooms/{code}/upload-recording",
        data={"token": performer_token, "failed": "1"},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    fanty = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert fanty["recordingFailed"] is True


def test_recording_file_is_deleted_with_the_room(client, raw_db):
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db)
    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    first = _upload(client, code, performer_token).get_json()["filename"]
    # a second take replaces the first, which must not be left behind
    second = _upload(client, code, performer_token).get_json()["filename"]
    upload_dir = os.environ["UPLOAD_DIR"]
    assert not os.path.isfile(os.path.join(upload_dir, first))
    assert os.path.isfile(os.path.join(upload_dir, second))

    client.post(f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True})
    # a recording of a later round, still waiting for its verdict
    client.post(f"/api/fanty/rooms/{code}/discard", json={"token": host_token})
    assert not os.path.isfile(os.path.join(upload_dir, second))


def test_admin_recording_flag_needs_a_timer(client, raw_db):
    from tests.test_admin import admin_login

    admin_login(client)
    payload = {
        "text": "Зачитай рэп про соседа",
        "kind": "solo",
        "locations": ["apartment"],
        "categories": ["basic"],
        "hasTimer": False,
        "hasRecording": True,
    }
    resp = client.post("/admin/api/fanty/dares", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["hasRecording"] is False

    payload.update(text="Зачитай рэп про кота", hasTimer=True, timerSeconds=45)
    resp = client.post("/admin/api/fanty/dares", json=payload)
    assert resp.get_json()["hasRecording"] is True


# --- temporary testing aid: the host picks the dare -------------------------


def _solo_dare_id(raw_db):
    return raw_db.execute("SELECT id FROM fanty_dares WHERE kind = 'solo' AND status = 'active' LIMIT 1").fetchone()[0]


def _login_tester(client):
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert resp.status_code == 200


def test_host_can_force_the_next_dare(client, raw_db):
    _login_tester(client)
    body = create_fanty_room(client, game_mode="solo").get_json()
    code, host_token = body["code"], body["token"]
    bob = join_fanty(client, code, "Bob", "🐶").get_json()
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    dare_id = raw_db.execute(
        "INSERT INTO fanty_dares (text, kind, status) VALUES ('Выбранный вручную фант', 'solo', 'active')"
    ).lastrowid
    raw_db.commit()

    assert client.get(f"/api/fanty/rooms/{code}/all-dares?token={host_token}").status_code == 200
    assert client.get(f"/api/fanty/rooms/{code}/all-dares?token={bob['token']}").status_code == 403
    assert client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": bob["token"], "dareId": dare_id}).status_code == 403

    resp = client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": host_token, "dareId": dare_id})
    assert resp.status_code == 200
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert state["forcedDareText"] == "Выбранный вручную фант"

    # whoever may spin does; the forced dare comes up
    for token in (host_token, bob["token"]):
        client.post(f"/api/fanty/rooms/{code}/spin", json={"token": token})
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert state["contentId"] == dare_id
    assert "forcedDareText" not in state


def test_forcing_a_dare_replaces_the_one_on_screen_until_it_is_started(client, raw_db):
    _login_tester(client)
    code, host_token, performer_token, _ = _start_timed_round(client, raw_db)
    other = _solo_dare_id(raw_db)
    resp = client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": host_token, "dareId": other})
    assert resp.status_code == 200
    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()["fanty"]
    assert state["contentId"] == other

    client.post(f"/api/fanty/rooms/{code}/start-performance", json={"token": performer_token})
    resp = client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": host_token, "dareId": other})
    assert resp.status_code == 400


def test_forcing_a_dare_is_not_for_team_games(client, raw_db):
    _login_tester(client)
    body = create_fanty_room(client, game_mode="team").get_json()
    code, host_token = body["code"], body["token"]
    dare_id = _solo_dare_id(raw_db)
    resp = client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": host_token, "dareId": dare_id})
    assert resp.status_code == 400


def test_forcing_a_dare_is_only_for_the_testing_account(client, raw_db):
    code, host_token, _performer, _ = _start_timed_round(client, raw_db)  # anonymous host
    dare_id = _solo_dare_id(raw_db)
    assert client.get(f"/api/fanty/rooms/{code}/all-dares?token={host_token}").status_code == 403
    resp = client.post(f"/api/fanty/rooms/{code}/force-dare", json={"token": host_token, "dareId": dare_id})
    assert resp.status_code == 403

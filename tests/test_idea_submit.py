import io
import os

from tests.test_my_rooms import login


def _dare(**extra):
    payload = {
        "type": "dare",
        "text": "Зачитай реп про соседа " + os.urandom(3).hex(),
        "kind": "solo",
        "locations": ["apartment"],
        "categories": ["basic"],
    }
    payload.update(extra)
    return payload


def _upload_audio(client, name="beat.mp3", data=b"ID3fakeaudio"):
    return client.post(
        "/api/fanty/upload-idea-audio",
        data={"file": (io.BytesIO(data), name)},
        content_type="multipart/form-data",
    )


def test_audio_upload_needs_an_account(client):
    assert _upload_audio(client).status_code == 401


def test_audio_upload_rejects_other_files(client, raw_db):
    login(client, raw_db)
    assert _upload_audio(client, name="photo.jpg").status_code == 400


def test_dare_idea_keeps_timer_recording_and_music(client, raw_db):
    login(client, raw_db)
    up = _upload_audio(client).get_json()
    assert up["filename"].startswith("idea_")
    payload = _dare(
        hasTimer=True,
        timerSeconds=45,
        hasRecording=True,
        musicFilename=up["filename"],
        musicOriginalName=up["originalName"],
    )
    assert client.post("/api/fanty/submit", json=payload).status_code == 200
    row = raw_db.execute("SELECT * FROM fanty_dares WHERE text = ?", (payload["text"],)).fetchone()
    assert row["status"] == "pending"
    assert (row["has_timer"], row["timer_seconds"], row["has_recording"]) == (1, 45, 1)
    assert row["music_filename"] == up["filename"] and row["music_original_name"] == "beat.mp3"

    item = client.get("/api/fanty/my-submissions").get_json()["items"][0]
    assert item["hasTimer"] and item["timerSeconds"] == 45 and item["hasRecording"] and item["hasMusic"]


def test_recording_and_music_need_a_timer(client, raw_db):
    login(client, raw_db)
    up = _upload_audio(client).get_json()
    payload = _dare(hasTimer=False, hasRecording=True, musicFilename=up["filename"])
    assert client.post("/api/fanty/submit", json=payload).status_code == 200
    row = raw_db.execute("SELECT * FROM fanty_dares WHERE text = ?", (payload["text"],)).fetchone()
    assert (row["has_timer"], row["has_recording"], row["music_filename"]) == (0, 0, None)


def test_timer_length_is_kept_in_bounds(client, raw_db):
    login(client, raw_db)
    low = _dare(hasTimer=True, timerSeconds=1)
    high = _dare(hasTimer=True, timerSeconds=99999)
    client.post("/api/fanty/submit", json=low)
    client.post("/api/fanty/submit", json=high)
    seconds = lambda p: raw_db.execute("SELECT timer_seconds FROM fanty_dares WHERE text = ?", (p["text"],)).fetchone()[0]
    assert seconds(low) == 10 and seconds(high) == 300


def test_music_must_come_from_the_idea_upload(client, raw_db):
    login(client, raw_db)
    # somebody else's file (e.g. a photo or recording) cannot be attached
    payload = _dare(hasTimer=True, musicFilename="abcdef.wav")
    assert client.post("/api/fanty/submit", json=payload).status_code == 400
    payload = _dare(hasTimer=True, musicFilename="idea_" + "0" * 32 + ".mp3")  # never uploaded
    assert client.post("/api/fanty/submit", json=payload).status_code == 400


def test_withdrawing_an_idea_removes_its_music_file(client, raw_db):
    login(client, raw_db)
    up = _upload_audio(client).get_json()
    payload = _dare(hasTimer=True, musicFilename=up["filename"])
    client.post("/api/fanty/submit", json=payload)
    path = os.path.join(os.environ["UPLOAD_DIR"], up["filename"])
    assert os.path.isfile(path)
    dare_id = raw_db.execute("SELECT id FROM fanty_dares WHERE text = ?", (payload["text"],)).fetchone()[0]
    assert client.delete(f"/api/fanty/my-submissions/dare/{dare_id}").status_code == 200
    assert not os.path.isfile(path)

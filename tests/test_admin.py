import io
import os

from tests.test_auth import register, get_code
from tests.test_fanty_game import create_fanty_room, join_fanty

ADMIN_USERNAME = os.environ["ADMIN_USERNAME"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]


def admin_login(client):
    resp = client.post(
        "/admin/api/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD}
    )
    assert resp.status_code == 200


def test_admin_endpoints_require_login(client):
    resp = client.get("/admin/api/fanty/dares")
    assert resp.status_code == 401

    resp = client.post(
        "/admin/api/fanty/dares",
        json={"text": "x", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 401


def test_admin_login_rejects_wrong_credentials(client):
    resp = client.post("/admin/api/login", json={"username": "nope", "password": "nope"})
    assert resp.status_code == 401

    resp = client.get("/admin/api/session")
    assert resp.get_json()["authenticated"] is False


def test_admin_add_edit_delete_dare(client):
    admin_login(client)

    resp = client.post(
        "/admin/api/fanty/dares",
        json={"text": "Тестовый фант для админки", "kind": "solo", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 200
    dare = resp.get_json()
    dare_id = dare["id"]
    assert dare["status"] == "active"
    assert dare["mixedPair"] is False

    # Duplicate text is rejected.
    resp = client.post(
        "/admin/api/fanty/dares",
        json={"text": "Тестовый фант для админки", "kind": "solo", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 400

    resp = client.put(
        f"/admin/api/fanty/dares/{dare_id}",
        json={
            "text": "Отредактированный тестовый фант",
            "kind": "team",
            "mixedPair": True,
            "categories": ["flirt"],
            "locations": ["bar"],
        },
    )
    assert resp.status_code == 200
    updated = resp.get_json()
    assert updated["text"] == "Отредактированный тестовый фант"
    assert updated["kind"] == "team"
    assert updated["mixedPair"] is True
    assert updated["locations"] == ["bar"]
    assert updated["status"] == "active"

    resp = client.put(
        "/admin/api/fanty/dares/999999",
        json={"text": "Не существует", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 404

    resp = client.delete(f"/admin/api/fanty/dares/{dare_id}")
    assert resp.status_code == 200

    resp = client.get("/admin/api/fanty/dares")
    ids = [d["id"] for d in resp.get_json()]
    assert dare_id not in ids


def test_admin_edit_rejects_duplicate_text_against_another_dare(client):
    admin_login(client)

    first = client.post(
        "/admin/api/fanty/dares",
        json={"text": "Первый уникальный фант", "categories": ["basic"], "locations": ["apartment"]},
    ).get_json()
    second = client.post(
        "/admin/api/fanty/dares",
        json={"text": "Второй уникальный фант", "categories": ["basic"], "locations": ["apartment"]},
    ).get_json()

    resp = client.put(
        f"/admin/api/fanty/dares/{second['id']}",
        json={"text": "Первый уникальный фант", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 400


def test_admin_upload_audio_and_attach_to_dare(client):
    admin_login(client)

    resp = client.post(
        "/admin/api/fanty/upload-audio",
        data={"file": (io.BytesIO(b"fake-audio-bytes"), "clip.mp3")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    filename = resp.get_json()["filename"]
    assert filename.endswith(".mp3")

    resp = client.post(
        "/admin/api/fanty/dares",
        json={
            "text": "Фант с музыкой",
            "categories": ["basic"],
            "locations": ["apartment"],
            "hasTimer": True,
            "timerSeconds": 30,
            "musicFilename": filename,
        },
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["musicUrl"] == f"/uploads/{filename}"
    assert body["timerSeconds"] == 30


def test_admin_upload_audio_rejects_bad_extension(client):
    admin_login(client)
    resp = client.post(
        "/admin/api/fanty/upload-audio",
        data={"file": (io.BytesIO(b"not-audio"), "clip.exe")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400


def test_admin_bulk_activate_prompts(client, raw_db):
    admin_login(client)
    raw_db.execute("INSERT INTO prompts (text, status) VALUES (?, 'pending')", ("Ожидающий вопрос А",))
    raw_db.execute("INSERT INTO prompts (text, status) VALUES (?, 'pending')", ("Ожидающий вопрос Б",))
    raw_db.commit()
    ids = [
        r["id"]
        for r in raw_db.execute("SELECT id FROM prompts WHERE status = 'pending'").fetchall()
    ]
    assert len(ids) == 2

    resp = client.post("/admin/api/prompts/bulk-activate", json={"ids": ids})
    assert resp.status_code == 200
    assert resp.get_json()["activated"] == 2

    for prompt_id in ids:
        row = raw_db.execute("SELECT status FROM prompts WHERE id = ?", (prompt_id,)).fetchone()
        assert row["status"] == "active"


def test_admin_edit_prompt(client):
    admin_login(client)
    created = client.post("/admin/api/prompts", json={"text": "Исходный текст вопроса"}).get_json()

    resp = client.put(f"/admin/api/prompts/{created['id']}", json={"text": "Отредактированный текст"})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["text"] == "Отредактированный текст"
    assert body["status"] == "active"

    resp = client.put("/admin/api/prompts/999999", json={"text": "Не найдено"})
    assert resp.status_code == 404


def test_admin_edit_prompt_rejects_duplicate_text(client):
    admin_login(client)
    first = client.post("/admin/api/prompts", json={"text": "Первый уникальный вопрос"}).get_json()
    second = client.post("/admin/api/prompts", json={"text": "Второй уникальный вопрос"}).get_json()

    resp = client.put(f"/admin/api/prompts/{second['id']}", json={"text": "Первый уникальный вопрос"})
    assert resp.status_code == 400


def test_admin_edit_truth(client):
    admin_login(client)
    created = client.post(
        "/admin/api/fanty/truths", json={"text": "Исходный вопрос правды", "categories": ["basic"]}
    ).get_json()

    resp = client.put(
        f"/admin/api/fanty/truths/{created['id']}",
        json={"text": "Отредактированный вопрос правды", "categories": ["flirt"]},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["text"] == "Отредактированный вопрос правды"
    assert body["categories"] == ["flirt"]

    resp = client.put("/admin/api/fanty/truths/999999", json={"text": "x", "categories": ["basic"]})
    assert resp.status_code == 404


def test_admin_dares_and_truths_list_show_submitter_email(client, raw_db):
    raw_db.execute(
        "INSERT INTO users (id, email, password_hash) VALUES ('u1', 'submitter@example.com', 'x')"
    )
    raw_db.execute(
        "INSERT INTO fanty_dares (text, kind, status, created_by_user_id) VALUES (?, 'solo', 'pending', 'u1')",
        ("Фант от пользователя",),
    )
    raw_db.execute(
        "INSERT INTO fanty_truths (text, status, created_by_user_id) VALUES (?, 'pending', 'u1')",
        ("Вопрос от пользователя",),
    )
    raw_db.commit()

    admin_login(client)
    dares = client.get("/admin/api/fanty/dares").get_json()
    truths = client.get("/admin/api/fanty/truths").get_json()

    dare = next(d for d in dares if d["text"] == "Фант от пользователя")
    truth = next(t for t in truths if t["text"] == "Вопрос от пользователя")
    assert dare["createdBy"] == "submitter@example.com"
    assert truth["createdBy"] == "submitter@example.com"

    # Admin-added items (no submitter) should come back labeled "admin".
    admin_dare = next(d for d in dares if d["text"] != "Фант от пользователя")
    assert admin_dare["createdBy"] == "admin"


def test_admin_cannot_edit_or_delete_dare_currently_live_in_a_game(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    live_dare_id = state["fanty"]["contentId"]

    admin_login(client)
    resp = client.put(
        f"/admin/api/fanty/dares/{live_dare_id}",
        json={"text": "Изменённый во время игры", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 400

    resp = client.delete(f"/admin/api/fanty/dares/{live_dare_id}")
    assert resp.status_code == 400

    # A dare that isn't the one currently in play is unaffected.
    other_dare_id = raw_db.execute(
        "SELECT id FROM fanty_dares WHERE id != ?", (live_dare_id,)
    ).fetchone()[0]
    resp = client.put(
        f"/admin/api/fanty/dares/{other_dare_id}",
        json={"text": f"Не задействован в игре {other_dare_id}", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 200

    # Once the round moves on, the dare is no longer "live" but the game
    # is still going — editing it stays blocked, now because it was played
    # earlier in a game that hasn't finished yet (not because it's current).
    client.post(f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True})
    resp = client.put(
        f"/admin/api/fanty/dares/{live_dare_id}",
        json={"text": "Изменено после раунда", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 400

    # Once the game actually finishes, editing is allowed again — nothing
    # left that could show a mismatched "Итоги игры" summary.
    client.post(f"/api/fanty/rooms/{code}/end", json={"token": host_token})
    resp = client.put(
        f"/admin/api/fanty/dares/{live_dare_id}",
        json={"text": "Изменено после окончания игры", "categories": ["basic"], "locations": ["apartment"]},
    )
    assert resp.status_code == 200


def test_admin_cannot_edit_or_delete_truth_currently_live_in_a_game(client, raw_db):
    resp = create_fanty_room(client, game_mode="truth_or_dare")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})

    # Which specific truth ends up "live" depends on random pool selection
    # that choose() would do — set it directly instead, since this test only
    # cares that a room mid-game with a given truth as current_truth_id
    # blocks admin edits to that truth, not the selection logic itself.
    room_id = raw_db.execute("SELECT id FROM rooms WHERE code = ?", (code,)).fetchone()[0]
    live_truth_id = raw_db.execute("SELECT id FROM fanty_truths LIMIT 1").fetchone()[0]
    raw_db.execute(
        "UPDATE fanty_state SET current_truth_id = ?, current_content_type = 'truth' WHERE room_id = ?",
        (live_truth_id, room_id),
    )
    raw_db.commit()

    admin_login(client)
    resp = client.put(
        f"/admin/api/fanty/truths/{live_truth_id}",
        json={"text": "Изменённый вопрос во время игры", "categories": ["basic"]},
    )
    assert resp.status_code == 400

    resp = client.delete(f"/admin/api/fanty/truths/{live_truth_id}")
    assert resp.status_code == 400


def test_admin_bulk_delete_excludes_currently_live_dare(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})

    state = client.get(f"/api/fanty/rooms/{code}/state?token={host_token}").get_json()
    live_dare_id = state["fanty"]["contentId"]

    admin_login(client)
    resp = client.post("/admin/api/fanty/dares/bulk-delete", json={"ids": [live_dare_id]})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["deleted"] == 0
    assert body["blocked"] == 1
    assert raw_db.execute("SELECT 1 FROM fanty_dares WHERE id = ?", (live_dare_id,)).fetchone() is not None


def test_admin_users_requires_login(client):
    resp = client.get("/admin/api/users")
    assert resp.status_code == 401


def test_admin_list_users_shows_games_created_count(client, raw_db):
    register(client, email="gamer@example.com", password="supersecret1")
    code = get_code(raw_db, "gamer@example.com")
    client.post("/api/auth/verify-email", json={"email": "gamer@example.com", "code": code})

    client.post("/api/rooms", json={"name": "Хост", "avatarType": "emoji", "avatarValue": "🙂"})
    create_fanty_room(client, game_mode="solo", name="Хост2", avatar_value="😎")

    admin_login(client)
    users = client.get("/admin/api/users").get_json()
    user = next(u for u in users if u["email"] == "gamer@example.com")
    assert user["gamesCreated"] == 2
    assert user["emailVerified"] is True


def test_admin_list_rooms_and_force_delete(client, raw_db):
    resp = create_fanty_room(client, game_mode="solo")
    body = resp.get_json()
    code, host_token = body["code"], body["token"]
    join_fanty(client, code, "Bob", "🐶")
    client.post(f"/api/fanty/rooms/{code}/start", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/spin", json={"token": host_token})
    client.post(f"/api/fanty/rooms/{code}/resolve", json={"token": host_token, "counted": True})

    admin_login(client)
    rooms = client.get("/admin/api/rooms").get_json()
    room = next(r for r in rooms if r["code"] == code)
    assert room["gameType"] == "fanty"
    assert room["status"] == "playing"
    assert room["hostName"] == "Host"
    assert room["playerCount"] == 2
    assert room["roundsPlayed"] == 1
    assert room["idleMinutes"] == 0

    # Force-delete bypasses the host-only/finished-only rules /discard enforces.
    resp = client.delete(f"/admin/api/rooms/{code}")
    assert resp.status_code == 200
    assert raw_db.execute("SELECT 1 FROM rooms WHERE code = ?", (code,)).fetchone() is None

    resp = client.delete(f"/admin/api/rooms/{code}")
    assert resp.status_code == 404

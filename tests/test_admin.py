import io
import os

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
    assert dare["createdByEmail"] == "submitter@example.com"
    assert truth["createdByEmail"] == "submitter@example.com"

    # Admin-added items (no submitter) should come back with no email.
    admin_dare = next(d for d in dares if d["text"] != "Фант от пользователя")
    assert admin_dare["createdByEmail"] is None

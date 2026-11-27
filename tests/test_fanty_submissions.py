import os

ADMIN_USERNAME = os.environ["ADMIN_USERNAME"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]


def register_and_verify(client, raw_db, email="submitter@example.com", password="supersecret1"):
    client.post("/api/auth/register", json={"email": email, "password": password})
    row = raw_db.execute("SELECT verification_code FROM users WHERE email = ?", (email,)).fetchone()
    client.post("/api/auth/verify-email", json={"email": email, "code": row["verification_code"]})


def test_my_submissions_requires_login(client):
    resp = client.get("/api/fanty/my-submissions")
    assert resp.status_code == 401


def test_submit_without_login_rejected(client):
    resp = client.post(
        "/api/fanty/submit",
        json={"type": "dare", "text": "x", "categories": ["basic"], "locations": ["apartment"], "kind": "solo"},
    )
    assert resp.status_code == 401


def test_my_submissions_lists_own_items_and_counts_approved(client, raw_db):
    register_and_verify(client, raw_db)

    resp = client.post(
        "/api/fanty/submit",
        json={
            "type": "dare",
            "text": "Уникальный тестовый фант от пользователя",
            "categories": ["basic"],
            "locations": ["apartment"],
            "kind": "solo",
        },
    )
    assert resp.status_code == 200

    resp = client.post(
        "/api/fanty/submit",
        json={"type": "truth", "text": "Уникальный тестовый вопрос от пользователя", "categories": ["basic"]},
    )
    assert resp.status_code == 200

    resp = client.get("/api/fanty/my-submissions")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["approvedCount"] == 0
    assert len(body["items"]) == 2
    statuses = {item["status"] for item in body["items"]}
    assert statuses == {"pending"}

    # Approve the dare via the admin panel, like a real moderator would.
    client.post("/admin/api/logout")
    client.post("/admin/api/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    dare_id = next(item["id"] for item in body["items"] if item["type"] == "dare")
    resp = client.post(f"/admin/api/fanty/dares/{dare_id}/activate")
    assert resp.status_code == 200
    client.post("/admin/api/logout")

    resp = client.get("/api/fanty/my-submissions")
    body = resp.get_json()
    assert body["approvedCount"] == 1


def test_my_submissions_only_shows_own_items(client, raw_db):
    register_and_verify(client, raw_db, email="first@example.com")
    client.post(
        "/api/fanty/submit",
        json={
            "type": "dare",
            "text": "Фант первого пользователя",
            "categories": ["basic"],
            "locations": ["apartment"],
            "kind": "solo",
        },
    )
    client.post("/api/auth/logout")

    register_and_verify(client, raw_db, email="second@example.com")
    resp = client.get("/api/fanty/my-submissions")
    body = resp.get_json()
    assert body["items"] == []
    assert body["approvedCount"] == 0


# ---- statuses and history ----


def submit(client, text, kind="dare"):
    body = {"type": kind, "text": text, "categories": ["basic"]}
    if kind == "dare":
        body.update({"locations": ["apartment"], "kind": "solo"})
    return client.post("/api/fanty/submit", json=body)


def admin_session(client):
    resp = client.post("/admin/api/login", json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200


def test_history_shows_pending_approved_and_rejected_with_dates_and_reason(client, raw_db):
    register_and_verify(client, raw_db, email="hist@example.com")
    assert submit(client, "История: фант на проверке").status_code == 200
    assert submit(client, "История: покажи балет лебедей").status_code == 200
    assert submit(client, "История: вопрос отклонят", kind="truth").status_code == 200
    ids = {
        r["text"]: r["id"]
        for r in raw_db.execute("SELECT id, text FROM fanty_dares WHERE text LIKE 'История:%'").fetchall()
    }
    truth_id = raw_db.execute("SELECT id FROM fanty_truths WHERE text LIKE 'История:%'").fetchone()["id"]

    admin = client.application.test_client()
    admin_session(admin)
    assert admin.post(f"/admin/api/fanty/dares/{ids['История: покажи балет лебедей']}/activate").status_code == 200
    assert admin.post(f"/admin/api/fanty/truths/{truth_id}/reject", json={"reason": "Слишком личный"}).status_code == 200

    body = client.get("/api/fanty/my-submissions").get_json()
    assert body["counts"] == {"pending": 1, "approved": 1, "rejected": 1}
    by_text = {i["text"]: i for i in body["items"]}
    pending = by_text["История: фант на проверке"]
    approved = by_text["История: покажи балет лебедей"]
    rejected = by_text["История: вопрос отклонят"]
    assert pending["status"] == "pending" and pending["reviewedAt"] is None
    assert approved["status"] == "approved" and approved["reviewedAt"] and approved["plays"] == 0 and approved["likes"] == 0
    assert rejected["status"] == "rejected" and rejected["rejectReason"] == "Слишком личный" and rejected["reviewedAt"]
    assert "plays" not in rejected

    # a rejected suggestion never reaches the game or the admin's working lists
    assert raw_db.execute("SELECT status FROM fanty_truths WHERE id = ?", (truth_id,)).fetchone()["status"] == "rejected"
    listed = [t["text"] for t in admin.get("/admin/api/fanty/truths").get_json()]
    assert "История: вопрос отклонят" not in listed


def test_only_pending_suggestions_can_be_rejected(client, raw_db):
    register_and_verify(client, raw_db, email="rej@example.com")
    submit(client, "Отклонение: уже одобренный")
    dare_id = raw_db.execute("SELECT id FROM fanty_dares WHERE text LIKE 'Отклонение:%'").fetchone()["id"]
    admin = client.application.test_client()
    admin_session(admin)
    admin.post(f"/admin/api/fanty/dares/{dare_id}/activate")
    resp = admin.post(f"/admin/api/fanty/dares/{dare_id}/reject", json={"reason": "поздно"})
    assert resp.get_json()["rejected"] == 0
    assert raw_db.execute("SELECT status FROM fanty_dares WHERE id = ?", (dare_id,)).fetchone()["status"] == "active"


def test_author_can_withdraw_only_a_pending_suggestion(client, raw_db):
    register_and_verify(client, raw_db, email="wd@example.com")
    submit(client, "Отзыв: ждёт проверки")
    submit(client, "Отзыв: одобрен")
    ids = {r["text"]: r["id"] for r in raw_db.execute("SELECT id, text FROM fanty_dares WHERE text LIKE 'Отзыв:%'").fetchall()}
    admin = client.application.test_client()
    admin_session(admin)
    admin.post(f"/admin/api/fanty/dares/{ids['Отзыв: одобрен']}/activate")

    assert client.delete(f"/api/fanty/my-submissions/dare/{ids['Отзыв: одобрен']}").status_code == 400
    assert client.delete(f"/api/fanty/my-submissions/dare/{ids['Отзыв: ждёт проверки']}").status_code == 200
    assert raw_db.execute("SELECT 1 FROM fanty_dares WHERE id = ?", (ids["Отзыв: ждёт проверки"],)).fetchone() is None
    assert client.delete("/api/fanty/my-submissions/dare/999999").status_code == 404
    assert client.delete("/api/fanty/my-submissions/bogus/1").status_code == 400

    other = client.application.test_client()
    register_and_verify(other, raw_db, email="other@example.com")
    assert other.delete(f"/api/fanty/my-submissions/dare/{ids['Отзыв: одобрен']}").status_code in (400, 404)


def test_duplicate_messages_tell_what_happened_to_the_original(client, raw_db):
    register_and_verify(client, raw_db, email="dup@example.com")
    assert submit(client, "Дубль: тот же текст").status_code == 200
    again = submit(client, "Дубль: тот же текст")
    assert again.status_code == 400 and "ждёт проверки" in again.get_json()["error"]
    dare_id = raw_db.execute("SELECT id FROM fanty_dares WHERE text LIKE 'Дубль:%'").fetchone()["id"]
    admin = client.application.test_client()
    admin_session(admin)
    admin.post(f"/admin/api/fanty/dares/{dare_id}/reject", json={})
    again = submit(client, "Дубль: тот же текст")
    assert again.status_code == 400 and "отклонили" in again.get_json()["error"]

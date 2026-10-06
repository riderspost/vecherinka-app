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

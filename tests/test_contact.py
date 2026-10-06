def test_contact_rejects_invalid_email(client):
    resp = client.post("/api/contact", json={"email": "not-an-email", "message": "hi"})
    assert resp.status_code == 400


def test_contact_rejects_empty_message(client):
    resp = client.post("/api/contact", json={"email": "a@example.com", "message": "   "})
    assert resp.status_code == 400


def test_contact_rejects_too_long_message(client):
    resp = client.post("/api/contact", json={"email": "a@example.com", "message": "x" * 5001})
    assert resp.status_code == 400


def test_contact_without_resend_key_reports_send_failure(client):
    # conftest strips RESEND_API_KEY, so mailer.send_email always returns
    # False here — the route should surface that as a clean error instead
    # of silently reporting success.
    resp = client.post("/api/contact", json={"email": "a@example.com", "message": "Привет, нашёл баг"})
    assert resp.status_code == 502

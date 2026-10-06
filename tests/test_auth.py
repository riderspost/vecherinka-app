def register(client, email="alice@example.com", password="supersecret1"):
    return client.post("/api/auth/register", json={"email": email, "password": password})


def get_code(raw_db, email):
    row = raw_db.execute("SELECT verification_code FROM users WHERE email = ?", (email,)).fetchone()
    return row["verification_code"] if row else None


def test_register_then_verify_logs_in(client, raw_db):
    resp = register(client)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["needsVerification"] is True

    code = get_code(raw_db, "alice@example.com")
    assert code and len(code) == 6

    resp = client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": code})
    assert resp.status_code == 200

    resp = client.get("/api/auth/session")
    assert resp.get_json()["authenticated"] is True


def test_register_rejects_short_password(client):
    resp = register(client, password="short")
    assert resp.status_code == 400


def test_register_rejects_invalid_email(client):
    resp = register(client, email="not-an-email")
    assert resp.status_code == 400


def test_verify_email_wrong_code_rejected(client):
    register(client)
    resp = client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": "000000"})
    assert resp.status_code == 400


def test_register_duplicate_verified_email_rejected(client, raw_db):
    register(client)
    code = get_code(raw_db, "alice@example.com")
    client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": code})

    resp = register(client)
    assert resp.status_code == 400


def test_register_duplicate_unverified_email_resends_code(client, raw_db):
    register(client)
    first_code = get_code(raw_db, "alice@example.com")

    resp = register(client, password="anotherpassword1")
    assert resp.status_code == 200

    second_code = get_code(raw_db, "alice@example.com")
    assert second_code is not None
    # Password should have been updated to the second attempt's.
    resp = client.post(
        "/api/auth/verify-email", json={"email": "alice@example.com", "code": second_code}
    )
    assert resp.status_code == 200
    client.post("/api/auth/logout")
    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "anotherpassword1"}
    )
    assert resp.status_code == 200


def test_login_unverified_blocks_and_resends_code(client, raw_db):
    register(client)
    first_code = get_code(raw_db, "alice@example.com")

    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "supersecret1"}
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert body["needsVerification"] is True

    second_code = get_code(raw_db, "alice@example.com")
    assert second_code is not None


def test_login_wrong_password_rejected(client, raw_db):
    register(client)
    code = get_code(raw_db, "alice@example.com")
    client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": code})
    client.post("/api/auth/logout")

    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "wrongpassword"}
    )
    assert resp.status_code == 400


def test_login_after_verification_succeeds(client, raw_db):
    register(client)
    code = get_code(raw_db, "alice@example.com")
    client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": code})
    client.post("/api/auth/logout")

    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "supersecret1"}
    )
    assert resp.status_code == 200
    assert client.get("/api/auth/session").get_json()["authenticated"] is True


def test_forgot_and_reset_password_flow(client, raw_db):
    register(client)
    code = get_code(raw_db, "alice@example.com")
    client.post("/api/auth/verify-email", json={"email": "alice@example.com", "code": code})
    client.post("/api/auth/logout")

    resp = client.post("/api/auth/forgot-password", json={"email": "alice@example.com"})
    assert resp.status_code == 200

    row = raw_db.execute(
        "SELECT reset_token FROM users WHERE email = ?", ("alice@example.com",)
    ).fetchone()
    token = row["reset_token"]
    assert token

    resp = client.post(
        "/api/auth/reset-password", json={"token": token, "password": "newpassword1"}
    )
    assert resp.status_code == 200

    client.post("/api/auth/logout")
    resp = client.post(
        "/api/auth/login", json={"email": "alice@example.com", "password": "newpassword1"}
    )
    assert resp.status_code == 200

    # The token can't be reused once consumed.
    resp = client.post(
        "/api/auth/reset-password", json={"token": token, "password": "yetanotherpass"}
    )
    assert resp.status_code == 400


def test_forgot_password_unknown_email_rejected(client):
    resp = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert resp.status_code == 400


def _register_and_verify(client, raw_db, email="profile@example.com", password="supersecret1"):
    register(client, email, password)
    code = get_code(raw_db, email)
    client.post("/api/auth/verify-email", json={"email": email, "code": code})


def test_session_reports_incomplete_profile_for_new_user(client, raw_db):
    _register_and_verify(client, raw_db)
    resp = client.get("/api/auth/session")
    body = resp.get_json()
    assert body["authenticated"] is True
    assert body["profileComplete"] is False
    assert body["name"] is None


def test_update_profile_requires_login(client):
    resp = client.post("/api/auth/profile", json={"name": "Аня", "avatarType": "emoji", "avatarValue": "🙂"})
    assert resp.status_code == 401


def test_update_profile_requires_name(client, raw_db):
    _register_and_verify(client, raw_db)
    resp = client.post("/api/auth/profile", json={"name": "  ", "avatarType": "emoji", "avatarValue": "🙂"})
    assert resp.status_code == 400


def test_update_profile_succeeds_and_marks_complete(client, raw_db):
    _register_and_verify(client, raw_db)
    resp = client.post(
        "/api/auth/profile", json={"name": "Аня", "avatarType": "emoji", "avatarValue": "🥳"}
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["name"] == "Аня"
    assert body["avatarValue"] == "🥳"

    resp = client.get("/api/auth/session")
    body = resp.get_json()
    assert body["profileComplete"] is True
    assert body["name"] == "Аня"
    assert body["avatarType"] == "emoji"
    assert body["avatarValue"] == "🥳"


def test_update_profile_rejects_photo_without_uploaded_file(client, raw_db):
    _register_and_verify(client, raw_db)
    # avatarValue points at a file that was never actually uploaded —
    # validate_avatar should fall back to the default emoji rather than
    # accepting an arbitrary path.
    resp = client.post(
        "/api/auth/profile", json={"name": "Аня", "avatarType": "photo", "avatarValue": "nonexistent.jpg"}
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["avatarType"] == "emoji"

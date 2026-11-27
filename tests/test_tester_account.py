from tests.test_auth import register
from tests.test_sentence_room import create_host


def test_tester_account_exists_and_can_sign_in(client):
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert resp.status_code == 200
    session = client.get("/api/auth/session").get_json()
    assert session["authenticated"] is True
    assert session["isTester"] is True
    assert session["profileComplete"] is True


def test_wrong_password_for_the_tester_account_is_refused(client):
    resp = client.post("/api/auth/login", json={"email": "admin", "password": "nope"})
    assert resp.status_code == 400


def test_nobody_can_register_the_tester_login(client):
    assert register(client, email="admin", password="supersecret1").status_code == 400


def test_ordinary_users_are_not_testers(client, raw_db):
    from tests.test_my_rooms import login

    login(client, raw_db)
    assert client.get("/api/auth/session").get_json()["isTester"] is False


def _join_from_test_tab(client, code):
    return client.post(
        f"/api/rooms/{code}/join",
        json={"name": "Тест 1", "avatarType": "emoji", "avatarValue": "🦊", "deviceId": "test-123"},
    )


def test_test_tabs_only_join_rooms_of_the_testing_account(client):
    room = create_host(client)  # anonymous host
    assert _join_from_test_tab(client.application.test_client(), room["code"]).status_code == 403


def test_test_tab_joins_a_room_made_by_the_testing_account(client):
    client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    room = create_host(client)
    assert _join_from_test_tab(client.application.test_client(), room["code"]).status_code == 200


def test_admin_panel_can_make_a_user_a_tester_and_change_the_system_password(client, raw_db):
    from tests.test_admin import admin_login
    from tests.test_my_rooms import login

    login(client, raw_db, email="someone@example.com")
    admin = client.application.test_client()
    admin_login(admin)

    users = admin.get("/admin/api/users").get_json()
    someone = next(u for u in users if u["email"] == "someone@example.com")
    system = next(u for u in users if u["email"] == "admin")
    assert someone["isTester"] is False and system["isTester"] is True and system["isSystem"] is True

    assert admin.put(f"/admin/api/users/{someone['id']}/tester", json={"isTester": True}).status_code == 200
    assert client.get("/api/auth/session").get_json()["isTester"] is True
    assert admin.put(f"/admin/api/users/{system['id']}/tester", json={"isTester": False}).status_code == 400

    assert admin.put(f"/admin/api/users/{system['id']}/password", json={"password": "short"}).status_code == 400
    assert admin.put(f"/admin/api/users/{someone['id']}/password", json={"password": "longenough1"}).status_code == 400
    assert admin.put(f"/admin/api/users/{system['id']}/password", json={"password": "newpassword1"}).status_code == 200
    fresh = client.application.test_client()
    assert fresh.post("/api/auth/login", json={"email": "admin", "password": "admin"}).status_code == 400
    assert fresh.post("/api/auth/login", json={"email": "admin", "password": "newpassword1"}).status_code == 200


# --- paid accounts and "Флирт+" -------------------------------------------


def _create_fanty(client, categories):
    return client.post(
        "/api/fanty/rooms",
        json={
            "name": "Хост",
            "avatarType": "emoji",
            "avatarValue": "🙂",
            "gameMode": "truth_or_dare",
            "location": "apartment",
            "categories": categories,
            "deviceMode": "local",
        },
    )


def test_guests_cannot_create_flirt_plus_games(client):
    resp = _create_fanty(client, ["flirt_plus"])
    assert resp.status_code == 403
    assert resp.get_json()["needsPaid"] is True
    # the free types are still open to everybody
    assert _create_fanty(client, ["basic"]).status_code == 200


def test_unpaid_account_cannot_create_flirt_plus_games(client, raw_db):
    from tests.test_my_rooms import login

    login(client, raw_db, email="free@example.com")
    assert client.get("/api/auth/session").get_json()["isPaid"] is False
    assert _create_fanty(client, ["basic", "flirt_plus"]).status_code == 403


def test_paid_account_can_create_flirt_plus_games(client, raw_db):
    from tests.test_my_rooms import login

    login(client, raw_db, email="paid@example.com")
    raw_db.execute("UPDATE users SET is_paid = 1 WHERE email = 'paid@example.com'")
    raw_db.commit()
    assert client.get("/api/auth/session").get_json()["isPaid"] is True
    assert _create_fanty(client, ["flirt_plus"]).status_code == 200


def test_admin_account_is_always_paid(client, raw_db):
    client.post("/api/auth/login", json={"email": "admin", "password": "admin"})
    assert client.get("/api/auth/session").get_json()["isPaid"] is True
    assert _create_fanty(client, ["flirt_plus"]).status_code == 200
    # even if its flag were cleared by hand
    raw_db.execute("UPDATE users SET is_paid = 0 WHERE email = 'admin'")
    raw_db.commit()
    assert client.get("/api/auth/session").get_json()["isPaid"] is True


def test_admin_panel_sets_the_paid_flag(client, raw_db):
    from tests.test_admin import admin_login
    from tests.test_my_rooms import login

    login(client, raw_db, email="buyer@example.com")
    admin = client.application.test_client()
    admin_login(admin)
    users = admin.get("/admin/api/users").get_json()
    buyer = next(u for u in users if u["email"] == "buyer@example.com")
    system = next(u for u in users if u["email"] == "admin")
    assert buyer["isPaid"] is False and system["isPaid"] is True

    assert admin.put(f"/admin/api/users/{buyer['id']}/paid", json={"isPaid": True}).status_code == 200
    assert _create_fanty(client, ["flirt_plus"]).status_code == 200
    assert admin.put(f"/admin/api/users/{buyer['id']}/paid", json={"isPaid": False}).status_code == 200
    assert _create_fanty(client, ["flirt_plus"]).status_code == 403
    assert admin.put(f"/admin/api/users/{system['id']}/paid", json={"isPaid": False}).status_code == 400

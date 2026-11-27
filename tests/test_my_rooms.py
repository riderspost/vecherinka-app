from tests.test_auth import get_code, register


def login(client, raw_db, email="host@example.com"):
    register(client, email=email)
    client.post("/api/auth/verify-email", json={"email": email, "code": get_code(raw_db, email)})


def test_my_rooms_is_empty_for_guests(client):
    assert client.get("/api/my-rooms").get_json() == []


def test_my_rooms_tells_host_and_player_count(client, raw_db):
    login(client, raw_db)
    created = client.post(
        "/api/reverse/rooms", json={"name": "Хост", "avatarType": "emoji", "avatarValue": "🦊"}
    ).get_json()

    # a second, anonymous player joins from another browser
    other = client.application.test_client()
    resp = other.post(
        f"/api/rooms/{created['code']}/join", json={"name": "Гость", "avatarType": "emoji", "avatarValue": "🐸"}
    )
    assert resp.status_code == 200

    rooms = client.get("/api/my-rooms").get_json()
    assert len(rooms) == 1
    room = rooms[0]
    assert room["code"] == created["code"]
    assert room["gameType"] == "reverse"
    assert room["isHost"] is True
    assert room["playerCount"] == 2


def test_room_with_two_players_of_one_account_is_listed_once_as_host(client, raw_db):
    login(client, raw_db)
    created = client.post(
        "/api/reverse/rooms", json={"name": "Хост", "avatarType": "emoji", "avatarValue": "🦊"}
    ).get_json()
    # the same account also joins its own room as a second player
    resp = client.post(
        f"/api/rooms/{created['code']}/join", json={"name": "Я же", "avatarType": "emoji", "avatarValue": "🐸"}
    )
    assert resp.status_code == 200

    rooms = client.get("/api/my-rooms").get_json()
    assert len(rooms) == 1
    assert rooms[0]["isHost"] is True

    resumed = client.post(f"/api/rooms/{created['code']}/resume").get_json()
    assert resumed["token"] == created["token"]


def test_avatar_colour_is_kept_only_from_the_palette(client):
    from server.rooms_common import validate_avatar

    assert validate_avatar("emoji", "🦊|#ff9a3c") == ("emoji", "🦊|#ff9a3c")
    assert validate_avatar("emoji", "🦊|#FF9A3C") == ("emoji", "🦊|#ff9a3c")
    assert validate_avatar("emoji", "🦊|red") == ("emoji", "🦊")
    assert validate_avatar("emoji", "🦊|<script>") == ("emoji", "🦊")
    assert validate_avatar("emoji", "🦊") == ("emoji", "🦊")
    assert validate_avatar("emoji", "") == ("emoji", "🙂")


def test_a_coloured_emoji_counts_as_taken_whatever_its_colour(client):
    host = client.post(
        "/api/rooms", json={"name": "Хост", "avatarType": "emoji", "avatarValue": "🦊|#ff9a3c"}
    ).get_json()
    code = host["code"]
    assert client.get(f"/api/rooms/{code}/taken-emojis").get_json()["taken"] == ["🦊"]
    clash = client.post(
        f"/api/rooms/{code}/join", json={"name": "Гость", "avatarType": "emoji", "avatarValue": "🦊|#36d1dc"}
    )
    assert clash.status_code == 400
    fine = client.post(
        f"/api/rooms/{code}/join", json={"name": "Гость", "avatarType": "emoji", "avatarValue": "🐸|#36d1dc"}
    )
    assert fine.status_code == 200

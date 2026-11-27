import os

from server import similarity
from tests.test_admin import admin_login
from tests.test_my_rooms import login


def test_same_text_in_other_clothes_scores_as_duplicate():
    assert similarity.score("Спой куплет любимой песни", "спой куплет любимой песни!") >= similarity.DUPLICATE
    assert similarity.score("{p1} обнимает {p2}", "{p2} обнимает {p1}") >= similarity.DUPLICATE


def test_a_bit_changed_text_scores_as_similar_not_duplicate():
    s = similarity.score("Спой куплет любимой песни", "Спой любимую песню вслух")
    assert similarity.SIMILAR <= s < similarity.DUPLICATE


def test_different_ideas_score_low():
    assert similarity.score("Спой куплет любимой песни", "Изобрази походку кота") < similarity.SIMILAR


def _add_dare(raw_db, text, status="active", user_id=None):
    raw_db.execute(
        "INSERT INTO fanty_dares (text, kind, status, created_by_user_id) VALUES (?, 'solo', ?, ?)",
        (text, status, user_id),
    )
    raw_db.commit()


def _add_truth(raw_db, text, status="active"):
    raw_db.execute("INSERT INTO fanty_truths (text, status) VALUES (?, ?)", (text, status))
    raw_db.commit()


def _idea(text, kind="dare", **extra):
    payload = {"type": kind, "text": text, "categories": ["basic"]}
    if kind == "dare":
        payload.update(kind="solo", locations=["apartment"])
    payload.update(extra)
    return payload


def _check(client, text, kind="dare"):
    return client.post("/api/fanty/check-similar", json={"type": kind, "text": text})


def test_check_needs_an_account(client):
    assert _check(client, "что-нибудь").status_code == 401


def test_check_says_none_when_nothing_is_alike(client, raw_db):
    login(client, raw_db)
    body = _check(client, "Изобрази походку кота, который увидел огурец").get_json()
    assert body["level"] == "none" and body["items"] == []


def test_check_finds_similar_and_marks_shared_words(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Прыгни на одной ноге вокруг стола трижды")
    body = _check(client, "Прыгни на одной ноге вокруг стула").get_json()
    assert body["level"] == "similar"
    item = body["items"][0]
    assert item["source"] == "game" and item["score"] >= 60
    assert any(part["match"] and "Прыгни" in part["text"] for part in item["parts"])


def test_check_calls_a_near_copy_a_duplicate_with_a_message(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Нарисуй портрет соседа левой рукой")
    body = _check(client, "нарисуй портрет соседа левой рукой!").get_json()
    assert body["level"] == "duplicate"
    assert body["message"] == "Такой фант уже есть"


def test_dares_and_questions_are_not_compared_with_each_other(client, raw_db):
    login(client, raw_db)
    _add_truth(raw_db, "Что ты прячешь от родителей до сих пор")
    assert _check(client, "Что ты прячешь от родителей до сих пор", kind="dare").get_json()["level"] == "none"
    assert _check(client, "Что ты прячешь от родителей до сих пор", kind="truth").get_json()["level"] == "duplicate"


def test_submit_blocks_a_duplicate_and_returns_what_it_is_like(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Построй башню из пяти разных предметов")
    resp = client.post("/api/fanty/submit", json=_idea("построй башню из пяти разных предметов!!"))
    assert resp.status_code == 409
    body = resp.get_json()
    assert body["level"] == "duplicate" and body["similar"] and body["error"] == "Такой фант уже есть"


def test_submit_wants_a_confirmation_for_a_similar_idea(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Расскажи анекдот про программиста серьёзным лицом")
    idea = _idea("Расскажи анекдот про бухгалтера серьёзным лицом")
    first = client.post("/api/fanty/submit", json=idea)
    assert first.status_code == 409 and first.get_json()["level"] == "similar"
    again = client.post("/api/fanty/submit", json={**idea, "confirmedSimilar": True})
    assert again.status_code == 200


def test_confirmation_does_not_get_a_duplicate_through(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Сделай десять приседаний с закрытыми глазами")
    resp = client.post(
        "/api/fanty/submit", json=_idea("Сделай десять приседаний с закрытыми глазами.", confirmedSimilar=True)
    )
    assert resp.status_code == 409 and resp.get_json()["level"] == "duplicate"


def test_own_pending_idea_is_called_yours(client, raw_db):
    login(client, raw_db)
    text = "Придумай рифму к слову холодильник за десять секунд"
    assert client.post("/api/fanty/submit", json=_idea(text)).status_code == 200
    # the exact same text has its own older message; a reworded one is caught by the likeness check
    body = client.post("/api/fanty/submit", json=_idea("Придумай рифму к слову холодильник за десять секунд!!")).get_json()
    assert body["level"] == "duplicate" and body["error"] == "Вы уже предлагали это"


def test_another_players_pending_idea_is_reported_as_waiting(client, raw_db):
    login(client, raw_db, email="first@example.com")
    text = "Изобрази пингвина который проспал работу"
    assert client.post("/api/fanty/submit", json=_idea(text)).status_code == 200

    other = client.application.test_client()
    login(other, raw_db, email="second@example.com")
    body = other.post("/api/fanty/submit", json=_idea("изобрази пингвина который проспал работу.")).get_json()
    assert body["level"] == "duplicate"
    assert body["error"] == "Такую идею уже предложили, она ждёт проверки"


def test_a_turned_down_idea_blocks_only_when_it_is_practically_the_same(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Поцелуй воздух в сторону окна с чувством", status="rejected")
    same = _check(client, "поцелуй воздух в сторону окна с чувством").get_json()
    assert same["level"] == "duplicate"
    changed = _check(client, "Поцелуй воздух в сторону холодильника с чувством").get_json()
    assert changed["level"] == "none"


def test_admin_list_shows_similar_ideas_for_pending_ones(client, raw_db):
    login(client, raw_db)
    _add_dare(raw_db, "Покажи пантомимой любимый фильм без звука")
    _add_dare(raw_db, "Покажи пантомимой любимый мультфильм без звука", status="pending")
    admin = client.application.test_client()
    admin_login(admin)
    items = admin.get("/admin/api/fanty/dares").get_json()
    pending = next(i for i in items if i["text"].startswith("Покажи пантомимой любимый мульт"))
    assert pending["similar"] and pending["similar"][0]["status"] == "active"
    active = next(i for i in items if i["text"] == "Покажи пантомимой любимый фильм без звука")
    assert "similar" not in active

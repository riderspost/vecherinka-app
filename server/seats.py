"""Getting a lost seat back, and removing a player who is gone.

Both are for the sentence and reverse games, where every player is one real
device and the game waits for each of them. (Fanty has its own player
handling.)

* A player whose browser lost the room session picks their name from the list
  and asks for the seat; the host says yes, and the seat gets a fresh token.
* The host can remove a player so the game stops waiting for them — as long as
  enough players stay to carry on.
"""

import uuid

from flask import Blueprint, jsonify, request

from . import game
from . import reverse_game as rg
from .db import get_db
from .rooms_common import get_player_or_404, get_room_or_404, players_with_presence

seats_bp = Blueprint("seats", __name__, url_prefix="/api/rooms")

SEAT_GAMES = ("sentence", "reverse")
MAX_PENDING_CLAIMS = 20


def error(message, status=400):
    return jsonify({"error": message}), status


def players_word(n):
    last, tens = n % 10, n % 100
    if 11 <= tens <= 14:
        return f"{n} игроков"
    if last == 1:
        return f"{n} игрок"
    if 2 <= last <= 4:
        return f"{n} игрока"
    return f"{n} игроков"


def min_players(game_type):
    return game.MIN_PLAYERS if game_type == "sentence" else rg.MIN_PLAYERS


def _room(db, code):
    room = get_room_or_404(db, code)
    if not room or room["game_type"] not in SEAT_GAMES:
        return None
    return room


def _seats(db, room_id):
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND is_display = 0 AND left_at IS NULL ORDER BY joined_at",
        (room_id,),
    ).fetchall()


@seats_bp.route("/<code>/seats", methods=["GET"])
def list_seats(code):
    """Who is in the room — for someone who lost their session to pick themselves from."""
    db = get_db()
    room = _room(db, code)
    if not room:
        return error("Комната не найдена", 404)
    return jsonify(
        {
            "status": room["status"],
            "gameType": room["game_type"],
            # who can be taken back: someone still connected can't be, and neither can the host
            # (the host is the one who says yes)
            "seats": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "avatarType": p["avatar_type"],
                    "avatarValue": p["avatar_value"],
                    "online": item["online"],
                    "isHost": item["isHost"],
                }
                for p, item in zip(_seats(db, room["id"]), players_with_presence(_seats(db, room["id"])))
            ],
        }
    )


@seats_bp.route("/<code>/claims", methods=["POST"])
def create_claim(code):
    db = get_db()
    room = _room(db, code)
    if not room:
        return error("Комната не найдена", 404)
    if room["status"] == "lobby":
        return error("Игра ещё не началась — просто присоединитесь к комнате")
    if room["status"] in ("finished", "final_results"):
        return error("Игра уже завершена")
    data = request.get_json(silent=True) or {}
    seat = next((p for p in _seats(db, room["id"]) if p["id"] == data.get("playerId")), None)
    if not seat:
        return error("Этого игрока в комнате нет", 404)
    if seat["is_host"]:
        return error("Место хоста вернуть нельзя: подтверждает хост")
    if players_with_presence([seat])[0]["online"]:
        return error("Этот игрок сейчас в сети. Если это вы, подождите минуту и попробуйте снова")
    if db.execute(
        "SELECT COUNT(*) AS c FROM seat_claims WHERE room_id = ? AND status = 'pending'", (room["id"],)
    ).fetchone()["c"] >= MAX_PENDING_CLAIMS:
        return error("Слишком много запросов — попросите хоста подтвердить предыдущие")

    # one open request per seat: a newer one replaces the older
    db.execute(
        "UPDATE seat_claims SET status = 'denied' WHERE player_id = ? AND status = 'pending'", (seat["id"],)
    )
    claim_id = str(uuid.uuid4())
    secret = uuid.uuid4().hex
    db.execute(
        "INSERT INTO seat_claims (id, room_id, player_id, secret, device_id) VALUES (?, ?, ?, ?, ?)",
        (claim_id, room["id"], seat["id"], secret, data.get("deviceId")),
    )
    db.commit()
    return jsonify({"claimId": claim_id, "secret": secret})


@seats_bp.route("/<code>/claims/<claim_id>", methods=["GET"])
def get_claim(code, claim_id):
    """The requester polls this. An approved claim hands over the new token once."""
    db = get_db()
    room = _room(db, code)
    if not room:
        return error("Комната не найдена", 404)
    claim = db.execute(
        "SELECT * FROM seat_claims WHERE id = ? AND room_id = ? AND secret = ?",
        (claim_id, room["id"], request.args.get("secret") or ""),
    ).fetchone()
    if not claim:
        return error("Запрос не найден", 404)
    if claim["status"] == "approved" and claim["new_token"]:
        token = claim["new_token"]
        db.execute("UPDATE seat_claims SET new_token = NULL WHERE id = ?", (claim["id"],))
        db.commit()
        return jsonify({"status": "approved", "token": token, "playerId": claim["player_id"]})
    if claim["status"] == "approved":
        return jsonify({"status": "delivered"})
    return jsonify({"status": claim["status"]})


@seats_bp.route("/<code>/claims/<claim_id>/resolve", methods=["POST"])
def resolve_claim(code, claim_id):
    db = get_db()
    room = _room(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    host = get_player_or_404(db, room["id"], data.get("token"))
    if not host or not host["is_host"]:
        return error("Только хост может ответить на запрос", 403)
    claim = db.execute(
        "SELECT * FROM seat_claims WHERE id = ? AND room_id = ? AND status = 'pending'", (claim_id, room["id"])
    ).fetchone()
    if not claim:
        return error("Запрос уже обработан", 404)
    if data.get("approve"):
        seat = db.execute(
            "SELECT * FROM players WHERE id = ? AND left_at IS NULL", (claim["player_id"],)
        ).fetchone()
        if not seat:
            db.execute("UPDATE seat_claims SET status = 'denied' WHERE id = ?", (claim["id"],))
            db.commit()
            return error("Этого игрока уже нет в комнате", 404)
        new_token = uuid.uuid4().hex
        # the old token stops working: whoever held it is out, the seat has one owner
        db.execute(
            "UPDATE players SET token = ?, device_id = ? WHERE id = ?", (new_token, claim["device_id"], seat["id"])
        )
        db.execute("UPDATE seat_claims SET status = 'approved', new_token = ? WHERE id = ?", (new_token, claim["id"]))
    else:
        db.execute("UPDATE seat_claims SET status = 'denied' WHERE id = ?", (claim["id"],))
    db.commit()
    return jsonify({"ok": True})


@seats_bp.route("/<code>/kick", methods=["POST"])
def kick_player(code):
    db = get_db()
    room = _room(db, code)
    if not room:
        return error("Комната не найдена", 404)
    data = request.get_json(silent=True) or {}
    host = get_player_or_404(db, room["id"], data.get("token"))
    if not host or not host["is_host"]:
        return error("Только хост может исключать игроков", 403)
    if room["status"] in ("finished", "final_results"):
        return error("Игра уже завершена")
    target = next((p for p in _seats(db, room["id"]) if p["id"] == data.get("playerId")), None)
    if not target:
        return error("Этого игрока в комнате нет", 404)
    if target["is_host"]:
        return error("Хоста исключить нельзя")

    # In the lobby anyone can be removed; once the game runs it has to keep its minimum.
    need = min_players(room["game_type"])
    if room["status"] != "lobby" and len(_seats(db, room["id"])) - 1 < need:
        return error(f"Нельзя исключить: для игры нужно минимум {players_word(need)}")

    db.execute("UPDATE players SET left_at = datetime('now') WHERE id = ?", (target["id"],))
    db.execute("UPDATE seat_claims SET status = 'denied' WHERE player_id = ? AND status = 'pending'", (target["id"],))
    db.commit()

    # the game must stop waiting for them
    room = get_room_or_404(db, code)
    if room["game_type"] == "sentence":
        game.tick(db, room)
    elif room["status"] == "playing":
        rnd = rg.get_current_round(db, room["id"])
        if rnd:
            # A round can't go on without the person whose recording is still to come.
            blocked = (
                rnd["phase"] == rg.PHASE_RECORDING_ORIGINAL and target["id"] in (rnd["speaker_id"], rnd["imitator_id"])
            ) or (rnd["phase"] == rg.PHASE_RECORDING_IMITATION and target["id"] == rnd["imitator_id"])
            if blocked:
                rg.start_next_round(db, room)
            else:
                rg.reveal_if_everyone_answered(db, rnd)
    return jsonify({"ok": True})

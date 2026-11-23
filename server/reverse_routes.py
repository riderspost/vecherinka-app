import json
import os
import uuid

from flask import Blueprint, request, jsonify, session

from . import reverse_game as rg
from .db import get_db
from .rooms_common import (
    RoomError,
    UPLOAD_DIR,
    get_room_or_404,
    get_player_or_404,
    player_public,
    create_room_and_host,
    gen_id,
)

reverse_bp = Blueprint("reverse", __name__, url_prefix="/api/reverse")


def error(message, status=400):
    return jsonify({"error": message}), status


def _room_or_404(db, code):
    room = get_room_or_404(db, code)
    if not room or room["game_type"] != "reverse":
        return None
    return room


def _auth(db, code, token):
    """Returns (room, player, error_response) — exactly one of the last two is set."""
    room = _room_or_404(db, code)
    if not room:
        return None, None, error("Комната не найдена", 404)
    player = get_player_or_404(db, room["id"], token)
    if not player:
        return room, None, error("Игрок не найден", 404)
    return room, player, None


@reverse_bp.route("/rooms", methods=["POST"])
def create_room():
    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        _room_id, code, token, player_id = create_room_and_host(
            db,
            "reverse",
            data.get("name"),
            data.get("avatarType"),
            data.get("avatarValue"),
            created_by_user_id=session.get("user_id"),
            device_id=data.get("deviceId"),
        )
    except RoomError as e:
        return error(e.message, e.status)
    db.commit()
    return jsonify({"code": code, "token": token, "playerId": player_id})


@reverse_bp.route("/rooms/<code>/start", methods=["POST"])
def start_game(code):
    db = get_db()
    data = request.get_json(silent=True) or {}
    room, player, err = _auth(db, code, data.get("token"))
    if err:
        return err
    if not player["is_host"]:
        return error("Только хост может начать игру")
    if room["status"] != "lobby":
        return error("Игра уже началась")
    if len(rg.get_active_players(db, room["id"])) < rg.MIN_PLAYERS:
        return error(f"Нужно минимум {rg.MIN_PLAYERS} игрока(ов)")
    rg.start_game(db, room)
    return jsonify({"ok": True})


def _read_upload():
    file = request.files.get("file")
    if not file:
        return None, error("Файл не передан")
    return file.read(rg.MAX_AUDIO_BYTES + 1), None


def _store_audio(data):
    """Saves a validated recording and its reversed twin; returns (forward, reversed) filenames."""
    base = uuid.uuid4().hex
    forward = f"{base}.wav"
    reverse = f"{base}_rev.wav"
    try:
        rg.save_wav_and_reversed(data, os.path.join(UPLOAD_DIR, forward), os.path.join(UPLOAD_DIR, reverse))
    except rg.AudioError as e:
        return None, None, error(str(e))
    return forward, reverse, None


@reverse_bp.route("/rooms/<code>/original", methods=["POST"])
def upload_original(code):
    db = get_db()
    room, player, err = _auth(db, code, request.form.get("token"))
    if err:
        return err
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd or rnd["phase"] != rg.PHASE_RECORDING_ORIGINAL:
        return error("Сейчас запись фразы не нужна")
    if rnd["speaker_id"] != player["id"]:
        return error("Фразу сейчас записывает другой игрок")
    data, err = _read_upload()
    if err:
        return err
    forward, reverse, err = _store_audio(data)
    if err:
        return err
    db.execute(
        "UPDATE reverse_rounds SET original_file = ?, reversed_file = ?, phase = ? WHERE id = ?",
        (forward, reverse, rg.PHASE_RECORDING_IMITATION, rnd["id"]),
    )
    db.commit()
    return jsonify({"ok": True})


@reverse_bp.route("/rooms/<code>/imitation", methods=["POST"])
def upload_imitation(code):
    db = get_db()
    room, player, err = _auth(db, code, request.form.get("token"))
    if err:
        return err
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd or rnd["phase"] != rg.PHASE_RECORDING_IMITATION:
        return error("Сейчас повторять запись не нужно")
    if rnd["imitator_id"] != player["id"]:
        return error("Запись сейчас повторяет другой игрок")
    data, err = _read_upload()
    if err:
        return err
    # What the imitator said is itself reversed speech; flipping it back is
    # what makes it sound like the original phrase again.
    imitation, imitation_back, err = _store_audio(data)
    if err:
        return err
    db.execute(
        "UPDATE reverse_rounds SET imitation_file = ?, imitation_back_file = ?, phase = ? WHERE id = ?",
        (imitation, imitation_back, rg.PHASE_GUESSING, rnd["id"]),
    )
    db.commit()
    return jsonify({"ok": True})


@reverse_bp.route("/rooms/<code>/answer", methods=["POST"])
def submit_answer(code):
    db = get_db()
    data = request.get_json(silent=True) or {}
    room, player, err = _auth(db, code, data.get("token"))
    if err:
        return err
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd or rnd["phase"] != rg.PHASE_GUESSING:
        return error("Сейчас не время отвечать")
    if rnd["speaker_id"] == player["id"]:
        return error("Загадавший не отвечает")
    options = json.loads(rnd["options_json"])
    index = data.get("optionIndex")
    if not isinstance(index, int) or isinstance(index, bool) or not (0 <= index < len(options)):
        return error("Выберите вариант ответа")
    already = db.execute(
        "SELECT 1 FROM reverse_answers WHERE round_id = ? AND player_id = ?", (rnd["id"], player["id"])
    ).fetchone()
    if already:
        return error("Вы уже ответили")
    db.execute(
        "INSERT INTO reverse_answers (id, round_id, player_id, option_index) VALUES (?, ?, ?, ?)",
        (gen_id(), rnd["id"], player["id"], index),
    )
    db.commit()

    guessers = rg.guessers_for_round(db, rnd)
    answered = db.execute("SELECT COUNT(*) AS c FROM reverse_answers WHERE round_id = ?", (rnd["id"],)).fetchone()["c"]
    if answered >= len(guessers):
        rg.score_and_reveal(db, rnd)
    return jsonify({"ok": True})


@reverse_bp.route("/rooms/<code>/reveal", methods=["POST"])
def force_reveal(code):
    """Host shortcut: stop waiting for stragglers and show the answer."""
    db = get_db()
    data = request.get_json(silent=True) or {}
    room, player, err = _auth(db, code, data.get("token"))
    if err:
        return err
    if not player["is_host"]:
        return error("Только хост может показать ответ")
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd or rnd["phase"] != rg.PHASE_GUESSING:
        return error("Сейчас нечего показывать")
    rg.score_and_reveal(db, rnd)
    return jsonify({"ok": True})


@reverse_bp.route("/rooms/<code>/next", methods=["POST"])
def next_round(code):
    db = get_db()
    data = request.get_json(silent=True) or {}
    room, player, err = _auth(db, code, data.get("token"))
    if err:
        return err
    if not player["is_host"]:
        return error("Только хост может продолжить игру")
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd or rnd["phase"] != rg.PHASE_REVEAL:
        return error("Сейчас нет действия «далее»")
    rg.start_next_round(db, room)
    return jsonify({"ok": True})


@reverse_bp.route("/rooms/<code>/skip", methods=["POST"])
def skip_round(code):
    """Host escape hatch: a player wandered off mid-round, move on without points."""
    db = get_db()
    data = request.get_json(silent=True) or {}
    room, player, err = _auth(db, code, data.get("token"))
    if err:
        return err
    if not player["is_host"]:
        return error("Только хост может пропустить раунд")
    rnd = rg.get_current_round(db, room["id"]) if room["status"] == "playing" else None
    if not rnd:
        return error("Сейчас нечего пропускать")
    rg.start_next_round(db, room)
    return jsonify({"ok": True})


def _upload_url(filename):
    return f"/uploads/{filename}" if filename else None


def _build_summary(db, room):
    players = {p["id"]: p for p in db.execute("SELECT * FROM players WHERE room_id = ?", (room["id"],)).fetchall()}
    rounds = db.execute(
        "SELECT r.*, ph.text AS phrase_text FROM reverse_rounds r JOIN reverse_phrases ph ON ph.id = r.phrase_id "
        "WHERE r.room_id = ? AND r.phase = ? ORDER BY r.round_number",
        (room["id"], rg.PHASE_REVEAL),
    ).fetchall()
    result = []
    for r in rounds:
        right = db.execute(
            "SELECT player_id FROM reverse_answers WHERE round_id = ? AND option_index = ?",
            (r["id"], r["correct_index"]),
        ).fetchall()
        result.append(
            {
                "roundNumber": r["round_number"],
                "phrase": r["phrase_text"],
                "speakerName": players[r["speaker_id"]]["name"] if r["speaker_id"] in players else "?",
                "correctNames": [players[a["player_id"]]["name"] for a in right if a["player_id"] in players],
            }
        )
    return result


def _build_round_state(db, room, player, rnd):
    phrase = db.execute("SELECT text FROM reverse_phrases WHERE id = ?", (rnd["phrase_id"],)).fetchone()
    options = json.loads(rnd["options_json"])
    phase = rnd["phase"]
    is_speaker = rnd["speaker_id"] == player["id"]
    is_imitator = rnd["imitator_id"] == player["id"]

    st = rg.get_state(db, room["id"])
    reverse = {
        "phase": phase,
        "roundNumber": rnd["round_number"],
        "totalRounds": st["total_rounds"],
        "speakerId": rnd["speaker_id"],
        "imitatorId": rnd["imitator_id"],
        "isSpeaker": is_speaker,
        "isImitator": is_imitator,
    }

    # The phrase is only ever shown to the person who has to say it —
    # everyone else gets it at the reveal, never before.
    if is_speaker or phase == rg.PHASE_REVEAL:
        reverse["phrase"] = phrase["text"] if phrase else None

    if phase == rg.PHASE_RECORDING_IMITATION and is_imitator:
        reverse["reversedUrl"] = _upload_url(rnd["reversed_file"])

    if phase in (rg.PHASE_GUESSING, rg.PHASE_REVEAL):
        guessers = rg.guessers_for_round(db, rnd)
        answers = db.execute("SELECT * FROM reverse_answers WHERE round_id = ?", (rnd["id"],)).fetchall()
        mine = next((a for a in answers if a["player_id"] == player["id"]), None)
        reverse["options"] = options
        reverse["guessUrl"] = _upload_url(rnd["imitation_back_file"])
        reverse["answeredCount"] = len(answers)
        reverse["guesserCount"] = len(guessers)
        reverse["myAnswer"] = mine["option_index"] if mine else None

    if phase == rg.PHASE_REVEAL:
        reverse["correctIndex"] = rnd["correct_index"]
        reverse["originalUrl"] = _upload_url(rnd["original_file"])
        reverse["imitationUrl"] = _upload_url(rnd["imitation_file"])
        reverse["answers"] = [
            {"playerId": a["player_id"], "optionIndex": a["option_index"], "correct": a["option_index"] == rnd["correct_index"]}
            for a in answers
        ]
    return reverse


def _build_state(db, room, player):
    players = db.execute(
        "SELECT * FROM players WHERE room_id = ? AND left_at IS NULL ORDER BY joined_at", (room["id"],)
    ).fetchall()
    active = [p for p in players if not p["is_display"]]
    state = {
        "room": {"code": room["code"], "status": room["status"], "deviceMode": room["device_mode"]},
        "players": [player_public(p) for p in players],
        "me": player_public(player),
        "canStart": room["status"] == "lobby" and len(active) >= rg.MIN_PLAYERS,
        "minPlayers": rg.MIN_PLAYERS,
    }
    if room["status"] == "finished":
        state["summary"] = _build_summary(db, room)
    elif room["status"] == "playing":
        rnd = rg.get_current_round(db, room["id"])
        if rnd:
            state["reverse"] = _build_round_state(db, room, player, rnd)
    return state


@reverse_bp.route("/rooms/<code>/state", methods=["GET"])
def state(code):
    db = get_db()
    room, player, err = _auth(db, code, request.args.get("token"))
    if err:
        return err
    return jsonify(_build_state(db, room, player))

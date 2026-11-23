import array
import io
import json
import random
import sys
import wave

from .rooms_common import gen_id

MIN_PLAYERS = 2
OPTIONS_COUNT = 4

# Записи — короткие фразы. Всё, что длиннее/тяжелее, почти наверняка не
# речь, а мусор или попытка забить диск.
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MIN_AUDIO_SECONDS = 0.3
MAX_AUDIO_SECONDS = 15.0
MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 48000

PHASE_RECORDING_ORIGINAL = "recording_original"
PHASE_RECORDING_IMITATION = "recording_imitation"
PHASE_GUESSING = "guessing"
PHASE_REVEAL = "reveal"


class AudioError(Exception):
    pass


def read_wav(data):
    """Parses a mono 16-bit PCM WAV; returns (params, samples as array('h'))."""
    if len(data) > MAX_AUDIO_BYTES:
        raise AudioError("Запись слишком большая")
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            frames = w.getnframes()
            raw = w.readframes(frames)
    except (wave.Error, EOFError):
        raise AudioError("Не удалось прочитать запись")
    if channels != 1 or width != 2:
        raise AudioError("Нужна моно-запись 16 бит")
    if not (MIN_SAMPLE_RATE <= rate <= MAX_SAMPLE_RATE):
        raise AudioError("Неподдерживаемая частота записи")
    duration = frames / float(rate)
    if duration < MIN_AUDIO_SECONDS:
        raise AudioError("Запись слишком короткая")
    if duration > MAX_AUDIO_SECONDS:
        raise AudioError("Запись слишком длинная")
    samples = array.array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        samples.byteswap()
    return rate, samples


def write_wav(path, rate, samples):
    out = array.array("h", samples)
    if sys.byteorder == "big":
        out.byteswap()
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(out.tobytes())


def save_wav_and_reversed(data, forward_path, reversed_path):
    """Validates an uploaded WAV, stores it as-is and stores a reversed copy.

    Reversing happens here rather than in the player's browser so the
    person who has to listen to the reversed clip is never handed a URL to
    the forward one.
    """
    rate, samples = read_wav(data)
    write_wav(forward_path, rate, samples)
    reversed_samples = array.array("h", samples)
    reversed_samples.reverse()
    write_wav(reversed_path, rate, reversed_samples)


# --- состояние игры ---


def get_state(db, room_id):
    return db.execute("SELECT * FROM reverse_state WHERE room_id = ?", (room_id,)).fetchone()


def get_active_players(db, room_id):
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND is_display = 0 AND left_at IS NULL ORDER BY joined_at",
        (room_id,),
    ).fetchall()


def get_current_round(db, room_id):
    return db.execute(
        "SELECT * FROM reverse_rounds WHERE room_id = ? ORDER BY round_number DESC LIMIT 1", (room_id,)
    ).fetchone()


def guessers_for_round(db, rnd):
    return [p for p in get_active_players(db, rnd["room_id"]) if p["id"] != rnd["speaker_id"]]


def _word_count(text):
    return len(text.split())


def _pick_options(db, phrase):
    """Correct phrase + (OPTIONS_COUNT - 1) lookalikes, shuffled."""
    decoys = [d for d in json.loads(phrase["decoys"] or "[]") if d != phrase["text"]]
    random.shuffle(decoys)
    chosen = decoys[: OPTIONS_COUNT - 1]
    if len(chosen) < OPTIONS_COUNT - 1:
        # У фразы мало своих «ловушек» — добираем чужими фразами, ближайшими по длине.
        others = db.execute(
            "SELECT text FROM reverse_phrases WHERE status = 'active' AND id != ?", (phrase["id"],)
        ).fetchall()
        target = _word_count(phrase["text"])
        pool = sorted((o["text"] for o in others if o["text"] not in chosen), key=lambda t: abs(_word_count(t) - target))
        chosen += pool[: OPTIONS_COUNT - 1 - len(chosen)]
    options = chosen + [phrase["text"]]
    random.shuffle(options)
    return options, options.index(phrase["text"])


def _pick_phrase(db, room_id):
    used = {
        row["phrase_id"]
        for row in db.execute("SELECT phrase_id FROM reverse_rounds WHERE room_id = ?", (room_id,)).fetchall()
    }
    rows = db.execute("SELECT * FROM reverse_phrases WHERE status = 'active'").fetchall()
    fresh = [r for r in rows if r["id"] not in used]
    pool = fresh or rows
    return random.choice(pool)


def start_game(db, room):
    players = get_active_players(db, room["id"])
    order = [p["id"] for p in players]
    random.shuffle(order)
    db.execute(
        "INSERT OR REPLACE INTO reverse_state (room_id, total_rounds, round_number, order_json) VALUES (?, ?, 0, ?)",
        (room["id"], len(order), json.dumps(order)),
    )
    db.execute("UPDATE rooms SET status = 'playing' WHERE id = ?", (room["id"],))
    start_next_round(db, room)


def start_next_round(db, room):
    """Starts the next round, or finishes the game if everyone has had a turn."""
    st = get_state(db, room["id"])
    order = json.loads(st["order_json"])
    number = st["round_number"] + 1
    if number > st["total_rounds"]:
        db.execute("UPDATE rooms SET status = 'finished' WHERE id = ?", (room["id"],))
        db.commit()
        return None
    speaker_id = order[(number - 1) % len(order)]
    imitator_id = order[number % len(order)]
    phrase = _pick_phrase(db, room["id"])
    options, correct_index = _pick_options(db, phrase)
    round_id = gen_id()
    db.execute(
        """INSERT INTO reverse_rounds
           (id, room_id, round_number, speaker_id, imitator_id, phrase_id, phase, options_json, correct_index)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            round_id,
            room["id"],
            number,
            speaker_id,
            imitator_id,
            phrase["id"],
            PHASE_RECORDING_ORIGINAL,
            json.dumps(options, ensure_ascii=False),
            correct_index,
        ),
    )
    db.execute("UPDATE reverse_state SET round_number = ? WHERE room_id = ?", (number, room["id"]))
    db.commit()
    return round_id


def score_and_reveal(db, rnd):
    """Moves a guessing round to reveal and hands out points, exactly once.

    Every correct guesser earns 1 point, and the speaker earns 1 point for
    each of them — a clear voice that gets understood is worth something too.
    """
    if rnd["phase"] != PHASE_GUESSING:
        return
    answers = db.execute("SELECT * FROM reverse_answers WHERE round_id = ?", (rnd["id"],)).fetchall()
    correct = [a for a in answers if a["option_index"] == rnd["correct_index"]]
    for a in correct:
        db.execute("UPDATE players SET total_score = total_score + 1 WHERE id = ?", (a["player_id"],))
    if correct:
        db.execute(
            "UPDATE players SET total_score = total_score + ? WHERE id = ?", (len(correct), rnd["speaker_id"])
        )
    db.execute("UPDATE reverse_rounds SET phase = ? WHERE id = ?", (PHASE_REVEAL, rnd["id"]))
    db.commit()


def round_files(row):
    return [
        row[key]
        for key in ("original_file", "reversed_file", "imitation_file", "imitation_back_file")
        if row[key]
    ]

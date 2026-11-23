import array
import io
import json
import os
import random
import sys
import uuid
import wave

from .rooms_common import gen_id, UPLOAD_DIR

MIN_PLAYERS = 2
OPTIONS_COUNT = 4
WORDS_PER_CHUNK = 2

# Фраза записывается кусками по два слова, так что каждая запись короткая.
# Всё, что длиннее/тяжелее, почти наверняка не речь, а мусор или попытка
# забить диск.
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MIN_AUDIO_SECONDS = 0.25
MAX_AUDIO_SECONDS = 8.0
MIN_SAMPLE_RATE = 8000
MAX_SAMPLE_RATE = 48000

PHASE_RECORDING_ORIGINAL = "recording_original"
PHASE_RECORDING_IMITATION = "recording_imitation"
PHASE_GUESSING = "guessing"
PHASE_REVEAL = "reveal"

KIND_ORIGINAL = "original"
KIND_IMITATION = "imitation"


class AudioError(Exception):
    pass


# --- аудио ---


def parse_wav(data):
    """Parses a mono 16-bit PCM WAV; returns (rate, samples as array('h'))."""
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            channels = w.getnchannels()
            width = w.getsampwidth()
            rate = w.getframerate()
            raw = w.readframes(w.getnframes())
    except (wave.Error, EOFError):
        raise AudioError("Не удалось прочитать запись")
    if channels != 1 or width != 2:
        raise AudioError("Нужна моно-запись 16 бит")
    samples = array.array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        samples.byteswap()
    return rate, samples


def read_wav(data):
    """Validates an uploaded chunk and returns (rate, samples)."""
    if len(data) > MAX_AUDIO_BYTES:
        raise AudioError("Запись слишком большая")
    rate, samples = parse_wav(data)
    if not (MIN_SAMPLE_RATE <= rate <= MAX_SAMPLE_RATE):
        raise AudioError("Неподдерживаемая частота записи")
    duration = len(samples) / float(rate)
    if duration < MIN_AUDIO_SECONDS:
        raise AudioError("Запись слишком короткая")
    if duration > MAX_AUDIO_SECONDS:
        raise AudioError("Запись слишком длинная")
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


def read_wav_file(filename):
    with open(os.path.join(UPLOAD_DIR, filename), "rb") as f:
        return parse_wav(f.read())


def _reversed(samples):
    out = array.array("h", samples)
    out.reverse()
    return out


def _new_names():
    base = uuid.uuid4().hex
    return f"{base}.wav", f"{base}_rev.wav"


def _save_pair(rate, samples):
    """Writes a clip and its reversed twin; returns (forward, reversed) filenames."""
    forward, reverse = _new_names()
    write_wav(os.path.join(UPLOAD_DIR, forward), rate, samples)
    write_wav(os.path.join(UPLOAD_DIR, reverse), rate, _reversed(samples))
    return forward, reverse


def _glue(clips):
    """clips: list of (rate, samples) in playing order -> (rate, samples)."""
    rate = clips[0][0]
    joined = array.array("h")
    for clip_rate, samples in clips:
        if clip_rate != rate:
            raise AudioError("Куски записаны в разном формате")
        joined.extend(samples)
    return rate, joined


# --- нарезка фразы ---


def split_chunks(text, size=WORDS_PER_CHUNK):
    """Cuts a phrase into pieces of `size` words (the last may be shorter).

    A dash or other punctuation standing alone belongs to the word before it
    instead of counting as a word of its own.
    """
    words = []
    for token in text.split():
        if words and not any(ch.isalnum() for ch in token):
            words[-1] += " " + token
        else:
            words.append(token)
    return [" ".join(words[i : i + size]) for i in range(0, len(words), size)] or [text]


def round_chunks(rnd, phrase_text=""):
    chunks = json.loads(rnd["chunks_json"] or "[]")
    return chunks or [phrase_text]


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
           (id, room_id, round_number, speaker_id, imitator_id, phrase_id, phase,
            options_json, correct_index, chunks_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
            json.dumps(split_chunks(phrase["text"]), ensure_ascii=False),
        ),
    )
    db.execute("UPDATE reverse_state SET round_number = ? WHERE room_id = ?", (number, room["id"]))
    db.commit()
    return round_id


# --- запись кусков ---


def store_chunk(db, rnd, kind, index, data, chunk_count):
    """Saves one recorded piece; once the last one is in, glues them and moves on.

    The speaker records the phrase piece by piece in reading order. The
    imitator then hears the pieces in the order of the *reversed* recording —
    last words first, each piece itself reversed — and records what they hear
    in that same order. Gluing the imitator's pieces in the order they were
    recorded and reversing the whole thing puts the pieces back in reading
    order, so the guessers hear something shaped like the original phrase.
    """
    counter = "original_done" if kind == KIND_ORIGINAL else "imitation_done"
    done = rnd[counter]
    if index is not None and index != done:
        raise AudioError("Эта часть уже записана или идёт не по порядку")

    rate, samples = read_wav(data)
    previous = db.execute(
        "SELECT file FROM reverse_chunks WHERE round_id = ? AND kind = ? LIMIT 1", (rnd["id"], kind)
    ).fetchone()
    if previous and read_wav_file(previous["file"])[0] != rate:
        raise AudioError("Куски записаны в разном формате")

    forward, reverse = _save_pair(rate, samples)
    db.execute(
        "INSERT INTO reverse_chunks (id, round_id, kind, idx, file, reversed_file) VALUES (?, ?, ?, ?, ?, ?)",
        (gen_id(), rnd["id"], kind, done, forward, reverse),
    )
    db.execute(f"UPDATE reverse_rounds SET {counter} = ? WHERE id = ?", (done + 1, rnd["id"]))
    if done + 1 >= chunk_count:
        _finish_kind(db, rnd, kind)
    db.commit()


def _finish_kind(db, rnd, kind):
    rows = db.execute(
        "SELECT file FROM reverse_chunks WHERE round_id = ? AND kind = ? ORDER BY idx", (rnd["id"], kind)
    ).fetchall()
    rate, joined = _glue([read_wav_file(r["file"]) for r in rows])
    whole, whole_reversed = _save_pair(rate, joined)
    if kind == KIND_ORIGINAL:
        db.execute(
            "UPDATE reverse_rounds SET original_file = ?, reversed_file = ?, phase = ? WHERE id = ?",
            (whole, whole_reversed, PHASE_RECORDING_IMITATION, rnd["id"]),
        )
    else:
        db.execute(
            "UPDATE reverse_rounds SET imitation_file = ?, imitation_back_file = ?, phase = ? WHERE id = ?",
            (whole, whole_reversed, PHASE_GUESSING, rnd["id"]),
        )


def portion_urls(db, rnd):
    """Reversed pieces in the order the imitator hears them (last words first)."""
    rows = db.execute(
        "SELECT reversed_file FROM reverse_chunks WHERE round_id = ? AND kind = ? ORDER BY idx DESC",
        (rnd["id"], KIND_ORIGINAL),
    ).fetchall()
    return [f"/uploads/{r['reversed_file']}" for r in rows]


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

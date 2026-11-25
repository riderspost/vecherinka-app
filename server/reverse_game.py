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
CHUNKS_PER_PHRASE = 2  # a phrase is recorded in two halves

# Лимиты на запись (меньше — для одной части повтора, больше — для всей фразы).
# Всё, что длиннее/тяжелее, почти наверняка не речь, а мусор или попытка
# забить диск.
MAX_AUDIO_BYTES = 2 * 1024 * 1024
MIN_AUDIO_SECONDS = 0.25
MAX_AUDIO_SECONDS = 8.0
MAX_ORIGINAL_SECONDS = 12.0  # the speaker records the whole phrase in one take
MIN_PIECE_SECONDS = 0.3
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


def read_wav(data, max_seconds=MAX_AUDIO_SECONDS):
    """Validates an uploaded clip and returns (rate, samples)."""
    if len(data) > MAX_AUDIO_BYTES:
        raise AudioError("Запись слишком большая")
    rate, samples = parse_wav(data)
    if not (MIN_SAMPLE_RATE <= rate <= MAX_SAMPLE_RATE):
        raise AudioError("Неподдерживаемая частота записи")
    duration = len(samples) / float(rate)
    if duration < MIN_AUDIO_SECONDS:
        raise AudioError("Запись слишком короткая")
    if duration > max_seconds:
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


def find_cut(samples, rate, fraction):
    """Where to cut a recording of a phrase into two pieces, as a sample index.

    `fraction` is how far into the phrase the cut falls by spoken length. The
    speaker is asked to pause there, so the quietest spot near that place is
    normally a real gap between words; without a pause it is simply the
    quietest point, which can fall inside a word but never leaves a piece
    shorter than MIN_PIECE_SECONDS.
    """
    n = len(samples)
    frame = max(1, rate // 100)  # 10 ms
    frames = n // frame
    min_piece = max(1, int(MIN_PIECE_SECONDS * 100))
    if frames < 2 * min_piece:
        return max(1, min(n - 1, int(n * fraction)))

    rms = []
    for f in range(frames):
        chunk = samples[f * frame : (f + 1) * frame]
        rms.append((sum(v * v for v in chunk) / len(chunk)) ** 0.5)
    # smooth over ~50 ms so a single quiet sample inside a word doesn't count as a gap
    env = []
    for f in range(frames):
        lo_f, hi_f = max(0, f - 2), min(frames, f + 3)
        env.append(sum(rms[lo_f:hi_f]) / (hi_f - lo_f))
    peak = max(env) or 1.0

    target = fraction * frames
    reach = 0.2 * frames
    first = max(min_piece, int(target - reach))
    last = min(frames - min_piece, int(target + reach))
    if last < first:
        first = last = max(min_piece, min(frames - min_piece, int(target)))

    def cost(f):
        return env[f] / peak + 0.15 * abs(f - target) / max(1.0, reach)

    best = min(range(first, last + 1), key=cost)
    # a pause is a stretch of quiet, not one frame: cut in the middle of it
    limit = env[best] * 1.5 + 0.02 * peak
    left = best
    while left - 1 >= first and env[left - 1] <= limit:
        left -= 1
    right = best
    while right + 1 <= last and env[right + 1] <= limit:
        right += 1
    return ((left + right) // 2) * frame + frame // 2


# --- нарезка фразы ---


_VOWELS = set("аеёиоуыэюяaeiouyАЕЁИОУЫЭЮЯAEIOUY")


# Little words that lean on the word after them: a piece shouldn't end on one
# ("уснул на | собственной презентации" reads and records badly).
_CLINGING = {
    "в", "во", "на", "от", "из", "к", "ко", "с", "со", "по", "за", "до", "у", "о", "об", "обо",
    "и", "а", "но", "не", "ни", "без", "для", "при", "про", "над", "под", "из-за", "из-под",
    "через", "между", "перед", "около", "если", "что", "как", "чтобы", "или", "то",
}
_CLING_PENALTY = 3


def _syllables(word):
    # Length of a spoken word is best judged by its vowels, not its letters.
    return max(1, sum(1 for ch in word if ch in _VOWELS))


def split_chunks(text, parts=CHUNKS_PER_PHRASE):
    """Cuts a phrase into `parts` pieces of about the same spoken length.

    Cuts only fall between words, never inside one; the place is chosen so the
    pieces hold a similar number of syllables and, where possible, a piece
    doesn't end on a preposition or conjunction. A dash or other punctuation
    standing alone belongs to the word before it instead of counting as a word.
    """
    words = []
    for token in text.split():
        if words and not any(ch.isalnum() for ch in token):
            words[-1] += " " + token
        else:
            words.append(token)
    if len(words) < 2 or parts < 2:
        return [" ".join(words)] if words else [text]

    parts = min(parts, len(words))
    weights = [_syllables(w) for w in words]
    total = sum(weights)
    cuts = []
    done = 0
    for k in range(1, parts):
        target = total * k / parts
        # leave at least one word for every piece still to come
        lo = (cuts[-1] if cuts else 0) + 1
        hi = len(words) - (parts - k)

        def cost(i):
            ends_on_little_word = words[i - 1].strip(".,!?…«»\"").lower() in _CLINGING
            return abs(sum(weights[:i]) - target) + (_CLING_PENALTY if ends_on_little_word else 0)

        best = min(range(lo, hi + 1), key=cost)
        cuts.append(best)
    bounds = [0] + cuts + [len(words)]
    return [" ".join(words[a:b]) for a, b in zip(bounds, bounds[1:])]


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


def _playable_blocks(db):
    """Active blocks holding enough active phrases to fill every answer option."""
    return db.execute(
        """SELECT b.id FROM reverse_blocks b
           WHERE b.status = 'active'
             AND (SELECT COUNT(*) FROM reverse_phrases p
                  WHERE p.block_id = b.id AND p.status = 'active') >= ?""",
        (OPTIONS_COUNT,),
    ).fetchall()


def has_playable_blocks(db):
    return bool(_playable_blocks(db))


def _pick_phrase_and_options(db, room_id):
    """Picks a block, then the phrase to speak and the options to show.

    The spoken phrase is a random member of the block and the other options
    are random *other* members of the same block — every phrase in a block
    is equally likely to be the answer, so nothing marks the right one out.
    A block isn't reused in the same game until all of them have been played.
    """
    used_blocks = {
        row["block_id"]
        for row in db.execute(
            """SELECT DISTINCT p.block_id FROM reverse_rounds rr
               JOIN reverse_phrases p ON p.id = rr.phrase_id WHERE rr.room_id = ?""",
            (room_id,),
        ).fetchall()
    }
    blocks = [row["id"] for row in _playable_blocks(db)]
    block_id = random.choice([b for b in blocks if b not in used_blocks] or blocks)

    members = db.execute(
        "SELECT * FROM reverse_phrases WHERE block_id = ? AND status = 'active'", (block_id,)
    ).fetchall()
    answer = random.choice(members)
    others = random.sample([m for m in members if m["id"] != answer["id"]], OPTIONS_COUNT - 1)
    options = [m["text"] for m in others] + [answer["text"]]
    random.shuffle(options)
    return answer, options, options.index(answer["text"])


def total_rounds_for(player_count):
    """Every player gets to speak to every other player exactly once."""
    return player_count * (player_count - 1)


def roles_for_round(order, number):
    """Who speaks and who repeats in round `number` (1-based), given the player circle.

    Rounds go in laps. In lap 1 each player speaks once and the next player
    around the circle repeats; in lap 2 the repeater is two seats along; and
    so on until every ordered pair has had its turn. Because a lap is a full
    pass over the circle, everyone has spoken the same number of times after
    each lap — so a game ended early is still fair.
    """
    n = len(order)
    lap, seat = divmod(number - 1, n)
    return order[seat], order[(seat + lap + 1) % n]


def start_game(db, room):
    players = get_active_players(db, room["id"])
    order = [p["id"] for p in players]
    random.shuffle(order)
    db.execute(
        "INSERT OR REPLACE INTO reverse_state (room_id, total_rounds, round_number, order_json) VALUES (?, ?, 0, ?)",
        (room["id"], total_rounds_for(len(order)), json.dumps(order)),
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
    # rounds that involve someone who was removed from the room are skipped
    gone = {
        row["id"]
        for row in db.execute(
            "SELECT id FROM players WHERE room_id = ? AND left_at IS NOT NULL", (room["id"],)
        ).fetchall()
    }
    while number <= st["total_rounds"] and any(pid in gone for pid in roles_for_round(order, number)):
        number += 1
    if number > st["total_rounds"]:
        db.execute("UPDATE reverse_state SET round_number = ? WHERE room_id = ?", (st["total_rounds"], room["id"]))
        db.execute("UPDATE rooms SET status = 'finished' WHERE id = ?", (room["id"],))
        db.commit()
        return None
    speaker_id, imitator_id = roles_for_round(order, number)
    phrase, options, correct_index = _pick_phrase_and_options(db, room["id"])
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


def store_original(db, rnd, data, chunks):
    """Saves the speaker's single take and cuts it into the pieces the imitator will hear.

    The phrase is recorded once; the cut falls near where the text's halves
    meet. Gluing the pieces back gives exactly the take that was uploaded.
    """
    if rnd["original_done"]:
        raise AudioError("Фраза уже записана")
    rate, samples = read_wav(data, MAX_ORIGINAL_SECONDS)
    if len(chunks) >= 2:
        weights = [sum(_syllables(w) for w in c.split()) for c in chunks]
        cut = find_cut(samples, rate, weights[0] / float(sum(weights)))
        pieces = [samples[:cut], samples[cut:]]
    else:
        pieces = [samples]
    for idx, piece in enumerate(pieces):
        forward, reverse = _save_pair(rate, piece)
        db.execute(
            "INSERT INTO reverse_chunks (id, round_id, kind, idx, file, reversed_file) VALUES (?, ?, ?, ?, ?, ?)",
            (gen_id(), rnd["id"], KIND_ORIGINAL, idx, forward, reverse),
        )
    db.execute("UPDATE reverse_rounds SET original_done = ? WHERE id = ?", (len(pieces), rnd["id"]))
    _finish_kind(db, rnd, KIND_ORIGINAL)
    db.commit()


def store_chunk(db, rnd, kind, index, data, chunk_count):
    """Saves one piece of the imitation; once the last one is in, glues them and moves on.

    The imitator hears the pieces in the order of the *reversed* recording —
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


def reveal_if_everyone_answered(db, rnd):
    """Moves a guessing round to reveal once every guesser still in the room has answered."""
    if rnd["phase"] != PHASE_GUESSING:
        return
    guessers = {p["id"] for p in guessers_for_round(db, rnd)}
    answered = {
        r["player_id"]
        for r in db.execute("SELECT player_id FROM reverse_answers WHERE round_id = ?", (rnd["id"],)).fetchall()
    }
    if guessers and guessers.issubset(answered):
        score_and_reveal(db, rnd)


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

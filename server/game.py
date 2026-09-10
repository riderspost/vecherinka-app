import random
import threading
import uuid
from datetime import datetime, timezone

TOTAL_ROUNDS = 5
PROMPTS_PER_GROUP = 3
MIN_PLAYERS = 4

_lock = threading.Lock()


def gen_id():
    return str(uuid.uuid4())


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def group_count_for(n):
    if n <= 8:
        return 2
    if n <= 15:
        return 3
    return max(1, n // 4)


def get_active_players(db, room_id):
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND is_display = 0 ORDER BY joined_at",
        (room_id,),
    ).fetchall()


def _partition(player_ids, group_count):
    shuffled = list(player_ids)
    random.shuffle(shuffled)
    n = len(shuffled)
    base = n // group_count
    remainder = n % group_count
    groups = []
    idx = 0
    for g in range(group_count):
        size = base + (1 if g < remainder else 0)
        groups.append(shuffled[idx:idx + size])
        idx += size
    return groups


def _pick_prompts(db, room_id, count):
    used_ids = {
        row["prompt_id"]
        for row in db.execute(
            "SELECT prompt_id FROM round_prompts WHERE room_id = ?", (room_id,)
        ).fetchall()
    }
    all_prompts = db.execute("SELECT id FROM prompts WHERE status = 'active'").fetchall()
    all_ids = [row["id"] for row in all_prompts]
    available = [pid for pid in all_ids if pid not in used_ids]
    random.shuffle(available)
    chosen = available[:count]
    if len(chosen) < count:
        pool = [pid for pid in all_ids if pid not in chosen]
        random.shuffle(pool)
        chosen += pool[: count - len(chosen)]
    return chosen


def start_round(db, room, round_number):
    room_id = room["id"]
    players = get_active_players(db, room_id)
    player_ids = [p["id"] for p in players]
    group_count = group_count_for(len(player_ids))
    partitions = _partition(player_ids, group_count)

    order_index = 0
    for group_index, member_ids in enumerate(partitions):
        group_id = gen_id()
        db.execute(
            "INSERT INTO round_groups (id, room_id, round_number, group_index) VALUES (?, ?, ?, ?)",
            (group_id, room_id, round_number, group_index),
        )
        db.executemany(
            "INSERT INTO round_group_members (group_id, player_id) VALUES (?, ?)",
            [(group_id, pid) for pid in member_ids],
        )
        prompt_ids = _pick_prompts(db, room_id, PROMPTS_PER_GROUP)
        for prompt_id in prompt_ids:
            db.execute(
                """INSERT INTO round_prompts
                   (id, room_id, round_number, group_id, prompt_id, order_index)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (gen_id(), room_id, round_number, group_id, prompt_id, order_index),
            )
            order_index += 1

    db.execute(
        """UPDATE rooms SET status = 'answering', current_round = ?, voting_index = 0,
           phase_started_at = ? WHERE id = ?""",
        (round_number, now_iso(), room_id),
    )
    db.commit()


def player_group_id(db, room_id, round_number, player_id):
    row = db.execute(
        """SELECT rg.id FROM round_groups rg
           JOIN round_group_members m ON m.group_id = rg.id
           WHERE rg.room_id = ? AND rg.round_number = ? AND m.player_id = ?""",
        (room_id, round_number, player_id),
    ).fetchone()
    return row["id"] if row else None


def player_round_prompts(db, room_id, round_number, player_id):
    group_id = player_group_id(db, room_id, round_number, player_id)
    if group_id is None:
        return []
    return db.execute(
        """SELECT rp.*, p.text AS prompt_text,
                  (SELECT COUNT(*) FROM submissions s WHERE s.round_prompt_id = rp.id AND s.player_id = ?) AS answered
           FROM round_prompts rp
           JOIN prompts p ON p.id = rp.prompt_id
           WHERE rp.group_id = ?
           ORDER BY rp.order_index""",
        (player_id, group_id),
    ).fetchall()


def _round_prompts_for_round(db, room_id, round_number):
    return db.execute(
        "SELECT * FROM round_prompts WHERE room_id = ? AND round_number = ? ORDER BY order_index",
        (room_id, round_number),
    ).fetchall()


def group_member_ids(db, group_id):
    rows = db.execute(
        "SELECT player_id FROM round_group_members WHERE group_id = ?", (group_id,)
    ).fetchall()
    return [r["player_id"] for r in rows]


def _answering_complete(db, room_id, round_number):
    round_prompts = _round_prompts_for_round(db, room_id, round_number)
    for rp in round_prompts:
        member_ids = group_member_ids(db, rp["group_id"])
        answered = db.execute(
            "SELECT COUNT(*) AS c FROM submissions WHERE round_prompt_id = ?", (rp["id"],)
        ).fetchone()["c"]
        if answered < len(member_ids):
            return False
    return True


def _advance_to_voting(db, room):
    db.execute(
        "UPDATE rooms SET status = 'voting', voting_index = 0, phase_started_at = ? WHERE id = ?",
        (now_iso(), room["id"]),
    )
    db.commit()


def current_voting_round_prompt(db, room):
    round_prompts = _round_prompts_for_round(db, room["id"], room["current_round"])
    idx = room["voting_index"]
    if idx >= len(round_prompts):
        return None, len(round_prompts)
    return round_prompts[idx], len(round_prompts)


def eligible_voter_ids(db, room_id, group_id):
    all_active = {p["id"] for p in get_active_players(db, room_id)}
    members = set(group_member_ids(db, group_id))
    return all_active - members


def _finalize_current_prompt(db, room):
    rp, total = current_voting_round_prompt(db, room)
    if rp is None:
        return
    votes = db.execute(
        "SELECT submission_id FROM votes WHERE round_prompt_id = ?", (rp["id"],)
    ).fetchall()
    num_voters = len(votes)
    if num_voters > 0:
        weight = 1.0 / num_voters
        tally = {}
        for v in votes:
            tally[v["submission_id"]] = tally.get(v["submission_id"], 0) + weight
        for submission_id, points in tally.items():
            db.execute(
                "UPDATE submissions SET points = points + ? WHERE id = ?",
                (points, submission_id),
            )
            sub = db.execute(
                "SELECT player_id FROM submissions WHERE id = ?", (submission_id,)
            ).fetchone()
            db.execute(
                "UPDATE players SET total_score = total_score + ? WHERE id = ?",
                (points, sub["player_id"]),
            )
    db.execute("UPDATE round_prompts SET voting_done = 1 WHERE id = ?", (rp["id"],))
    db.execute(
        "UPDATE rooms SET status = 'voting_results', phase_started_at = ? WHERE id = ?",
        (now_iso(), room["id"]),
    )
    db.commit()


def advance_after_voting_results(db, room):
    """Host-triggered: move from the per-prompt results reveal to the next prompt or round results."""
    _rp, total = current_voting_round_prompt(db, room)
    next_index = room["voting_index"] + 1
    if next_index >= total:
        db.execute(
            "UPDATE rooms SET status = 'round_results', phase_started_at = ? WHERE id = ?",
            (now_iso(), room["id"]),
        )
    else:
        db.execute(
            "UPDATE rooms SET status = 'voting', voting_index = ?, phase_started_at = ? WHERE id = ?",
            (next_index, now_iso(), room["id"]),
        )
    db.commit()


def _voting_prompt_complete(db, room):
    rp, _total = current_voting_round_prompt(db, room)
    if rp is None:
        return True
    eligible = eligible_voter_ids(db, room["id"], rp["group_id"])
    if not eligible:
        return True
    voted = db.execute(
        "SELECT voter_player_id FROM votes WHERE round_prompt_id = ?", (rp["id"],)
    ).fetchall()
    voted_ids = {v["voter_player_id"] for v in voted}
    return eligible.issubset(voted_ids)


def advance_after_round_results(db, room):
    """Host-triggered: move from the per-round score screen to the overall leaderboard screen."""
    db.execute(
        "UPDATE rooms SET status = 'overall_results', phase_started_at = ? WHERE id = ?",
        (now_iso(), room["id"]),
    )
    db.commit()


def advance_after_overall_results(db, room):
    """Host-triggered: move from the overall leaderboard screen to the next round or final results."""
    if room["current_round"] >= TOTAL_ROUNDS:
        db.execute(
            "UPDATE rooms SET status = 'final_results', phase_started_at = ? WHERE id = ?",
            (now_iso(), room["id"]),
        )
        db.commit()
    else:
        start_round(db, room, room["current_round"] + 1)


def tick(db, room):
    """Lazily advance room phase once every required action is actually done. No timers."""
    with _lock:
        room_id = room["id"]
        for _ in range(50):
            room = db.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()
            if room is None:
                return room
            status = room["status"]
            advanced = False

            if status == "answering":
                if _answering_complete(db, room_id, room["current_round"]):
                    _advance_to_voting(db, room)
                    advanced = True
            elif status == "voting":
                if _voting_prompt_complete(db, room):
                    _finalize_current_prompt(db, room)
                    advanced = True

            if not advanced:
                break

        return db.execute("SELECT * FROM rooms WHERE id = ?", (room_id,)).fetchone()

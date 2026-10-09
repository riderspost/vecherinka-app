import json
import random
import threading
from datetime import datetime

from .rooms_common import gen_id

MIN_PLAYERS_BY_MODE = {"truth_or_dare": 2, "solo": 2, "team": 2}
MAX_PHOTOS = 5
LOCATIONS = ("street", "apartment", "bar", "country_house")
MOOD_CATEGORIES = ("basic", "flirt", "flirt_plus")
ATTRIBUTES = ("alcohol", "food")
CATEGORIES = MOOD_CATEGORIES + ATTRIBUTES
GAME_MODES = ("truth_or_dare", "solo", "team")
PICK_MODES = ("random", "fair")
PAIR_MODES = ("any", "mixed")


def min_players_for(game_mode):
    return MIN_PLAYERS_BY_MODE.get(game_mode, 2)


def gender_required(settings):
    return settings["game_mode"] == "team" and settings["pair_mode"] == "mixed"


def has_both_genders(players):
    genders = {p["gender"] for p in players}
    return "m" in genders and "f" in genders

_lock = threading.Lock()


def get_active_players(db, room_id):
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND is_display = 0 AND left_at IS NULL ORDER BY joined_at",
        (room_id,),
    ).fetchall()


def get_settings(db, room_id):
    return db.execute("SELECT * FROM fanty_settings WHERE room_id = ?", (room_id,)).fetchone()


def settings_categories(settings_row):
    return json.loads(settings_row["categories"])


def get_state(db, room_id):
    return db.execute("SELECT * FROM fanty_state WHERE room_id = ?", (room_id,)).fetchone()


def init_state(db, room_id, host_player_id):
    db.execute(
        """INSERT INTO fanty_state (room_id, phase, next_spinner_id, round_number)
           VALUES (?, 'ready_to_spin', ?, 0)""",
        (room_id, host_player_id),
    )


def start_game(db, room):
    db.execute("UPDATE rooms SET status = 'playing' WHERE id = ?", (room["id"],))
    db.commit()


def content_pool_sizes(db, game_mode, location, categories, pair_mode="any"):
    """Dare/truth pool sizes for a location+categories combo, used to validate room settings before creation."""
    cat_placeholders = ",".join("?" * len(categories))
    dare_kind = "team" if game_mode == "team" else "solo"
    mixed_filter = ""
    mixed_params = []
    if dare_kind == "team":
        mixed_filter = "AND d.mixed_pair = ?"
        mixed_params = [1 if pair_mode == "mixed" else 0]
    dare_count = db.execute(
        f"""SELECT COUNT(DISTINCT d.id) AS c FROM fanty_dares d
            JOIN fanty_dare_locations dl ON dl.dare_id = d.id AND dl.location = ?
            JOIN fanty_dare_categories dc ON dc.dare_id = d.id AND dc.category IN ({cat_placeholders})
            WHERE d.status = 'active' AND d.kind = ? {mixed_filter}""",
        [location] + categories + [dare_kind] + mixed_params,
    ).fetchone()["c"]
    truth_count = 0
    if game_mode == "truth_or_dare":
        truth_count = db.execute(
            f"""SELECT COUNT(DISTINCT t.id) AS c FROM fanty_truths t
                JOIN fanty_truth_categories tc ON tc.truth_id = t.id AND tc.category IN ({cat_placeholders})
                WHERE t.status = 'active'""",
            categories,
        ).fetchone()["c"]
    return dare_count, truth_count


def _content_pool_dares(db, settings, kind):
    categories = settings_categories(settings)
    cat_placeholders = ",".join("?" * len(categories))
    mixed_filter = ""
    mixed_params = []
    if kind == "team":
        mixed_filter = "AND d.mixed_pair = ?"
        mixed_params = [1 if settings["pair_mode"] == "mixed" else 0]
    rows = db.execute(
        f"""SELECT DISTINCT d.id FROM fanty_dares d
            JOIN fanty_dare_locations dl ON dl.dare_id = d.id AND dl.location = ?
            JOIN fanty_dare_categories dc ON dc.dare_id = d.id AND dc.category IN ({cat_placeholders})
            WHERE d.status = 'active' AND d.kind = ? {mixed_filter}""",
        [settings["location"]] + categories + [kind] + mixed_params,
    ).fetchall()
    return [r["id"] for r in rows]


def _content_pool_truths(db, settings):
    categories = settings_categories(settings)
    cat_placeholders = ",".join("?" * len(categories))
    rows = db.execute(
        f"""SELECT DISTINCT t.id FROM fanty_truths t
            JOIN fanty_truth_categories tc ON tc.truth_id = t.id AND tc.category IN ({cat_placeholders})
            WHERE t.status = 'active'""",
        categories,
    ).fetchall()
    return [r["id"] for r in rows]


def _pick_preferring_unused(pool_ids, used_ids):
    available = [i for i in pool_ids if i not in used_ids]
    if available:
        return random.choice(available)
    if pool_ids:
        return random.choice(pool_ids)
    return None


def pick_dare(db, room_id, settings, kind):
    pool = _content_pool_dares(db, settings, kind)
    used = {
        row["dare_id"]
        for row in db.execute(
            "SELECT dare_id FROM fanty_rounds WHERE room_id = ? AND dare_id IS NOT NULL", (room_id,)
        ).fetchall()
    }
    return _pick_preferring_unused(pool, used)


def pick_truth(db, room_id, settings):
    pool = _content_pool_truths(db, settings)
    used = {
        row["truth_id"]
        for row in db.execute(
            "SELECT truth_id FROM fanty_rounds WHERE room_id = ? AND truth_id IS NOT NULL", (room_id,)
        ).fetchall()
    }
    return _pick_preferring_unused(pool, used)


def can_spin(room, state, player):
    if room["device_mode"] == "local":
        return bool(player["is_host"])
    return player["id"] == state["next_spinner_id"]


def can_act_as_picked(room, state, player):
    if room["device_mode"] == "local":
        return bool(player["is_host"])
    return player["id"] == state["current_picked_id"]


def _pick_main_player(state, settings, active_ids):
    exclude = set()
    if state["round_number"] > 0:
        exclude.add(state["next_spinner_id"])

    if settings["pick_mode"] != "fair":
        candidates = [pid for pid in active_ids if pid not in exclude] or active_ids
        return random.choice(candidates), None

    picked_cycle = [pid for pid in json.loads(state["picked_cycle"] or "[]") if pid in active_ids]
    remaining = [pid for pid in active_ids if pid not in picked_cycle]
    if not remaining:
        picked_cycle = []
        remaining = active_ids[:]
    candidates = [pid for pid in remaining if pid not in exclude] or remaining
    picked = random.choice(candidates)
    picked_cycle = picked_cycle + [picked]
    return picked, json.dumps(picked_cycle)


def spin_main(db, room):
    with _lock:
        state = get_state(db, room["id"])
        active = get_active_players(db, room["id"])
        active_ids = [p["id"] for p in active]
        settings = get_settings(db, room["id"])

        picked, picked_cycle_json = _pick_main_player(state, settings, active_ids)
        cycle_sql = ", picked_cycle=?" if picked_cycle_json is not None else ""
        cycle_params = (picked_cycle_json,) if picked_cycle_json is not None else ()

        round_number = state["round_number"] + 1

        if settings["game_mode"] == "truth_or_dare":
            db.execute(
                f"""UPDATE fanty_state SET phase='awaiting_choice', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type=NULL,
                   current_dare_id=NULL, current_truth_id=NULL, performance_started_at=NULL,
                   round_number=?{cycle_sql} WHERE room_id=?""",
                (picked, round_number) + cycle_params + (room["id"],),
            )
        elif settings["game_mode"] == "team":
            db.execute(
                f"""UPDATE fanty_state SET phase='awaiting_partner_spin', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type=NULL,
                   current_dare_id=NULL, current_truth_id=NULL, performance_started_at=NULL,
                   round_number=?{cycle_sql} WHERE room_id=?""",
                (picked, round_number) + cycle_params + (room["id"],),
            )
        else:  # solo
            dare_id = pick_dare(db, room["id"], settings, "solo")
            db.execute(
                f"""UPDATE fanty_state SET phase='awaiting_action', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type='dare',
                   current_dare_id=?, current_truth_id=NULL, performance_started_at=NULL,
                   round_number=?{cycle_sql} WHERE room_id=?""",
                (picked, dare_id, round_number) + cycle_params + (room["id"],),
            )
        db.commit()


def choose_truth_or_action(db, room, choice):
    with _lock:
        state = get_state(db, room["id"])
        settings = get_settings(db, room["id"])
        if choice == "truth":
            content_id = pick_truth(db, room["id"], settings)
            content_type = "truth"
        else:
            content_id = pick_dare(db, room["id"], settings, "solo")
            content_type = "dare"
        db.execute(
            """UPDATE fanty_state SET phase='awaiting_action', current_choice=?,
               current_content_type=?, current_dare_id=?, current_truth_id=?,
               performance_started_at=NULL
               WHERE room_id=?""",
            (
                choice,
                content_type,
                content_id if content_type == "dare" else None,
                content_id if content_type == "truth" else None,
                room["id"],
            ),
        )
        db.commit()


def start_performance(db, room):
    with _lock:
        db.execute(
            """UPDATE fanty_state SET performance_started_at=?
               WHERE room_id=? AND performance_started_at IS NULL""",
            (datetime.utcnow().isoformat() + "Z", room["id"]),
        )
        db.commit()


def spin_partner(db, room):
    with _lock:
        state = get_state(db, room["id"])
        active = get_active_players(db, room["id"])
        settings = get_settings(db, room["id"])

        picked = next((p for p in active if p["id"] == state["current_picked_id"]), None)
        pool = [p for p in active if p["id"] != state["current_picked_id"]]
        if settings["pair_mode"] == "mixed" and picked is not None:
            pool = [p for p in pool if p["gender"] != picked["gender"]]
        candidates = [p["id"] for p in pool]
        partner = random.choice(candidates) if candidates else None

        dare_id = pick_dare(db, room["id"], settings, "team")
        db.execute(
            """UPDATE fanty_state SET phase='awaiting_action', current_partner_id=?,
               current_content_type='dare', current_dare_id=?, current_truth_id=NULL,
               performance_started_at=NULL
               WHERE room_id=?""",
            (partner, dare_id, room["id"]),
        )
        db.commit()


def remove_player(db, room, player_id):
    """Soft-removes a player mid-game (host action). Returns (ok, error_message).

    A hard DELETE would hit fanty_rounds.picked_player_id/partner_player_id —
    those have no ON DELETE clause, so removing anyone who's already played a
    round would raise an IntegrityError. Marking left_at instead keeps round
    history intact and is what get_active_players/get_player_or_404 already
    treat as "not in the game" everywhere else.
    """
    with _lock:
        player = db.execute(
            "SELECT * FROM players WHERE id = ? AND room_id = ? AND is_display = 0",
            (player_id, room["id"]),
        ).fetchone()
        if not player or player["left_at"] is not None:
            return False, "Игрок не найден"
        if player["is_host"]:
            return False, "Нельзя удалить организатора"

        settings = get_settings(db, room["id"])
        remaining = [p for p in get_active_players(db, room["id"]) if p["id"] != player_id]
        if len(remaining) < min_players_for(settings["game_mode"]):
            return False, f"Останется слишком мало игроков (минимум {min_players_for(settings['game_mode'])})"
        if gender_required(settings) and not has_both_genders(remaining):
            return False, "Нужны игроки обоих полов для этого режима"

        db.execute(
            "UPDATE players SET left_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat() + "Z", player_id),
        )

        state = get_state(db, room["id"])
        remaining_ids = [p["id"] for p in remaining]
        involved = player_id in (state["next_spinner_id"], state["current_picked_id"], state["current_partner_id"])
        if involved and remaining_ids:
            # The round this player was part of can't continue — void it and
            # hand the bottle to whoever's left, same as a normal round
            # handoff, rather than trying to patch a half-finished round.
            fallback_spinner = (
                state["next_spinner_id"] if state["next_spinner_id"] in remaining_ids else remaining_ids[0]
            )
            db.execute(
                """UPDATE fanty_state SET phase='ready_to_spin', next_spinner_id=?,
                   current_picked_id=NULL, current_partner_id=NULL, current_choice=NULL,
                   current_content_type=NULL, current_dare_id=NULL, current_truth_id=NULL,
                   performance_started_at=NULL
                   WHERE room_id=?""",
                (fallback_spinner, room["id"]),
            )
        db.commit()
        return True, None


def format_team_text(text, player1, player2):
    text = text.replace("{p1}", player1["name"]).replace("{p2}", player2["name"])
    if player1["gender"] == "m" and player2["gender"] == "f":
        text = text.replace("{m}", player1["name"]).replace("{f}", player2["name"])
    elif player1["gender"] == "f" and player2["gender"] == "m":
        text = text.replace("{m}", player2["name"]).replace("{f}", player1["name"])
    return text


def resolve_round(db, room, counted, photo_filenames):
    with _lock:
        state = get_state(db, room["id"])
        round_id = gen_id()
        db.execute(
            """INSERT INTO fanty_rounds
               (id, room_id, round_number, picked_player_id, partner_player_id, choice,
                content_type, dare_id, truth_id, counted)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                round_id,
                room["id"],
                state["round_number"],
                state["current_picked_id"],
                state["current_partner_id"],
                state["current_choice"],
                state["current_content_type"],
                state["current_dare_id"],
                state["current_truth_id"],
                int(counted),
            ),
        )
        for idx, filename in enumerate(photo_filenames[:MAX_PHOTOS]):
            db.execute(
                "INSERT INTO fanty_round_photos (id, round_id, filename, order_index) VALUES (?, ?, ?, ?)",
                (gen_id(), round_id, filename, idx),
            )

        next_spinner = state["current_partner_id"] or state["current_picked_id"]
        db.execute(
            """UPDATE fanty_state SET phase='ready_to_spin', next_spinner_id=?,
               current_picked_id=NULL, current_partner_id=NULL, current_choice=NULL,
               current_content_type=NULL, current_dare_id=NULL, current_truth_id=NULL,
               performance_started_at=NULL
               WHERE room_id=?""",
            (next_spinner, room["id"]),
        )
        db.commit()
        return round_id

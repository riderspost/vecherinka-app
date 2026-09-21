import json
import random
import threading

from .rooms_common import gen_id

MIN_PLAYERS = 2
MAX_PHOTOS = 5
LOCATIONS = ("street", "apartment", "bar", "country_house")
CATEGORIES = ("basic", "flirt", "flirt_plus", "alcohol", "food")
GAME_MODES = ("truth_or_dare", "solo", "team")

_lock = threading.Lock()


def get_active_players(db, room_id):
    return db.execute(
        "SELECT * FROM players WHERE room_id = ? AND is_display = 0 ORDER BY joined_at",
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


def content_pool_sizes(db, game_mode, location, categories):
    """Dare/truth pool sizes for a location+categories combo, used to validate room settings before creation."""
    cat_placeholders = ",".join("?" * len(categories))
    dare_kind = "team" if game_mode == "team" else "solo"
    dare_count = db.execute(
        f"""SELECT COUNT(DISTINCT d.id) AS c FROM fanty_dares d
            JOIN fanty_dare_locations dl ON dl.dare_id = d.id AND dl.location = ?
            JOIN fanty_dare_categories dc ON dc.dare_id = d.id AND dc.category IN ({cat_placeholders})
            WHERE d.status = 'active' AND d.kind = ?""",
        [location] + categories + [dare_kind],
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
    rows = db.execute(
        f"""SELECT DISTINCT d.id FROM fanty_dares d
            JOIN fanty_dare_locations dl ON dl.dare_id = d.id AND dl.location = ?
            JOIN fanty_dare_categories dc ON dc.dare_id = d.id AND dc.category IN ({cat_placeholders})
            WHERE d.status = 'active' AND d.kind = ?""",
        [settings["location"]] + categories + [kind],
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


def spin_main(db, room):
    with _lock:
        state = get_state(db, room["id"])
        active = get_active_players(db, room["id"])
        active_ids = [p["id"] for p in active]

        exclude = set()
        if state["round_number"] > 0:
            exclude.add(state["next_spinner_id"])
        candidates = [pid for pid in active_ids if pid not in exclude] or active_ids
        picked = random.choice(candidates)

        settings = get_settings(db, room["id"])
        round_number = state["round_number"] + 1

        if settings["game_mode"] == "truth_or_dare":
            db.execute(
                """UPDATE fanty_state SET phase='awaiting_choice', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type=NULL,
                   current_dare_id=NULL, current_truth_id=NULL, round_number=? WHERE room_id=?""",
                (picked, round_number, room["id"]),
            )
        elif settings["game_mode"] == "team":
            db.execute(
                """UPDATE fanty_state SET phase='awaiting_partner_spin', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type=NULL,
                   current_dare_id=NULL, current_truth_id=NULL, round_number=? WHERE room_id=?""",
                (picked, round_number, room["id"]),
            )
        else:  # solo
            dare_id = pick_dare(db, room["id"], settings, "solo")
            db.execute(
                """UPDATE fanty_state SET phase='awaiting_action', current_picked_id=?,
                   current_partner_id=NULL, current_choice=NULL, current_content_type='dare',
                   current_dare_id=?, current_truth_id=NULL, round_number=? WHERE room_id=?""",
                (picked, dare_id, round_number, room["id"]),
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
               current_content_type=?, current_dare_id=?, current_truth_id=?
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


def spin_partner(db, room):
    with _lock:
        state = get_state(db, room["id"])
        active = get_active_players(db, room["id"])
        candidates = [p["id"] for p in active if p["id"] != state["current_picked_id"]]
        partner = random.choice(candidates) if candidates else None

        settings = get_settings(db, room["id"])
        dare_id = pick_dare(db, room["id"], settings, "team")
        db.execute(
            """UPDATE fanty_state SET phase='awaiting_action', current_partner_id=?,
               current_content_type='dare', current_dare_id=?, current_truth_id=NULL
               WHERE room_id=?""",
            (partner, dare_id, room["id"]),
        )
        db.commit()


def format_team_text(text, name1, name2):
    return text.replace("{p1}", name1).replace("{p2}", name2)


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
               current_content_type=NULL, current_dare_id=NULL, current_truth_id=NULL
               WHERE room_id=?""",
            (next_spinner, room["id"]),
        )
        db.commit()
        return round_id

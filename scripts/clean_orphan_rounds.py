"""One-off cleanup: remove rows left behind by rooms that were deleted
before PRAGMA foreign_keys=ON was consistently applied (or before
delete_room_and_files existed) — fanty_rounds/round_prompts/round_groups/
fanty_settings/fanty_state/players rows whose room_id no longer points at
an existing room. These orphans block dare/truth deletion forever (the FK
from fanty_rounds.dare_id/truth_id has no cascade), even though the room
that "used" them is long gone.

Order matters: fanty_rounds and round_prompts/round_groups are deleted
before players, since fanty_rounds.picked_player_id/partner_player_id
reference players without a cascade.

Usage: DATABASE_PATH=/path/to/vecherinka.db python3 scripts/clean_orphan_rounds.py [--yes]
"""
import os
import sqlite3
import sys

DB_PATH = os.environ.get(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vecherinka.db"),
)

TABLES_IN_ORDER = [
    "fanty_rounds",
    "round_prompts",
    "round_groups",
    "fanty_settings",
    "fanty_state",
    "players",
]


def main():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA foreign_keys = ON")

    counts = {}
    for table in TABLES_IN_ORDER:
        rows = db.execute(
            f"SELECT COUNT(*) FROM {table} t LEFT JOIN rooms r ON r.id = t.room_id WHERE r.id IS NULL"
        ).fetchone()[0]
        counts[table] = rows

    print("Orphaned rows found (room_id no longer in rooms):")
    for table, n in counts.items():
        print(f"  {table}: {n}")

    if "--yes" not in sys.argv:
        print("\nDry run only (pass --yes to actually delete).")
        db.close()
        return

    for table in TABLES_IN_ORDER:
        db.execute(f"DELETE FROM {table} WHERE room_id NOT IN (SELECT id FROM rooms)")
    db.commit()
    db.close()
    print("\nDeleted.")


if __name__ == "__main__":
    main()

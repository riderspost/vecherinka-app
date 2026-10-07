"""One-off cleanup: delete every room (and everything that cascades from it —
players, rounds, submissions, votes, fanty state/photos) plus the uploaded
round-photo files on disk. Prompts/dares/truths/users/admin content are
never touched.

Usage: run with the same Python/venv and DATABASE_PATH/UPLOAD_DIR the app
itself uses, e.g.:

    DATABASE_PATH=/path/to/vecherinka.db UPLOAD_DIR=/path/to/uploads \
        python3 scripts/purge_rooms.py
"""
import os
import sqlite3
import sys

DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vecherinka.db"))
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads"))


def main():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")

    rooms = db.execute("SELECT id, code, status, game_type, created_at FROM rooms").fetchall()
    print(f"Rooms to delete: {len(rooms)}")
    for r in rooms:
        print(f"  {r['code']} ({r['game_type']}, {r['status']}, created {r['created_at']})")

    photo_rows = db.execute("SELECT filename FROM fanty_round_photos").fetchall()
    filenames = []
    for row in photo_rows:
        filename = row["filename"]
        base, ext = os.path.splitext(filename)
        filenames.append(filename)
        filenames.append(f"{base}_thumb{ext}")
    print(f"Photo files to remove: {len(filenames)}")

    if "--yes" not in sys.argv:
        print("\nDry run only (pass --yes to actually delete).")
        return

    db.execute("DELETE FROM rooms")
    db.commit()
    db.close()

    removed = 0
    for filename in filenames:
        path = os.path.join(UPLOAD_DIR, filename)
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    print(f"Deleted {len(rooms)} rooms, removed {removed}/{len(filenames)} photo files.")


if __name__ == "__main__":
    main()

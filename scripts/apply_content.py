#!/usr/bin/env python3
"""Merge a content dump (from dump_content.py) into this environment's DB.

Upserts by unique text: a matching row gets its fields/categories/locations
updated, new text gets inserted. Never deletes — content added directly on
this environment that isn't in the dump is left untouched, so it's safe to
run against an environment that's also edited by hand.

Usage: python scripts/apply_content.py content.json
"""
import json
import os
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "vecherinka.db"))


def upsert_prompt(db, p):
    row = db.execute("SELECT id FROM prompts WHERE text = ?", (p["text"],)).fetchone()
    if row:
        db.execute("UPDATE prompts SET status = ? WHERE id = ?", (p["status"], row[0]))
        return "updated"
    db.execute("INSERT INTO prompts (text, status) VALUES (?, ?)", (p["text"], p["status"]))
    return "inserted"


def upsert_truth(db, t):
    row = db.execute("SELECT id FROM fanty_truths WHERE text = ?", (t["text"],)).fetchone()
    if row:
        truth_id = row[0]
        db.execute("UPDATE fanty_truths SET status = ? WHERE id = ?", (t["status"], truth_id))
        db.execute("DELETE FROM fanty_truth_categories WHERE truth_id = ?", (truth_id,))
        action = "updated"
    else:
        cur = db.execute(
            "INSERT INTO fanty_truths (text, status) VALUES (?, ?)", (t["text"], t["status"])
        )
        truth_id = cur.lastrowid
        action = "inserted"
    db.executemany(
        "INSERT OR IGNORE INTO fanty_truth_categories (truth_id, category) VALUES (?, ?)",
        [(truth_id, c) for c in t["categories"]],
    )
    return action


def upsert_dare(db, d, upload_dir):
    row = db.execute("SELECT id FROM fanty_dares WHERE text = ?", (d["text"],)).fetchone()
    music_filename = d["music_filename"]
    if music_filename and not os.path.isfile(os.path.join(upload_dir, music_filename)):
        print(
            f"  warning: music file {music_filename!r} referenced by dare "
            f"{d['text'][:40]!r} is missing from {upload_dir} — copy it over "
            f"manually, leaving musicFilename unset for now",
            file=sys.stderr,
        )
        music_filename = None

    if row:
        dare_id = row[0]
        db.execute(
            """UPDATE fanty_dares SET kind=?, status=?, mixed_pair=?, music_filename=?,
               has_timer=?, timer_seconds=? WHERE id=?""",
            (
                d["kind"],
                d["status"],
                int(d["mixed_pair"]),
                music_filename,
                int(d["has_timer"]),
                d["timer_seconds"],
                dare_id,
            ),
        )
        db.execute("DELETE FROM fanty_dare_categories WHERE dare_id = ?", (dare_id,))
        db.execute("DELETE FROM fanty_dare_locations WHERE dare_id = ?", (dare_id,))
        action = "updated"
    else:
        cur = db.execute(
            """INSERT INTO fanty_dares (text, kind, status, mixed_pair, music_filename,
               has_timer, timer_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                d["text"],
                d["kind"],
                d["status"],
                int(d["mixed_pair"]),
                music_filename,
                int(d["has_timer"]),
                d["timer_seconds"],
            ),
        )
        dare_id = cur.lastrowid
        action = "inserted"

    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_categories (dare_id, category) VALUES (?, ?)",
        [(dare_id, c) for c in d["categories"]],
    )
    db.executemany(
        "INSERT OR IGNORE INTO fanty_dare_locations (dare_id, location) VALUES (?, ?)",
        [(dare_id, loc) for loc in d["locations"]],
    )
    return action


def main():
    if len(sys.argv) != 2:
        print("usage: apply_content.py <dump.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        dump = json.load(f)

    upload_dir = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
    db = sqlite3.connect(DATABASE_PATH)
    db.execute("PRAGMA foreign_keys = ON")

    counts = {
        "prompts": {"inserted": 0, "updated": 0},
        "truths": {"inserted": 0, "updated": 0},
        "dares": {"inserted": 0, "updated": 0},
    }
    for p in dump["prompts"]:
        counts["prompts"][upsert_prompt(db, p)] += 1
    for t in dump["truths"]:
        counts["truths"][upsert_truth(db, t)] += 1
    for d in dump["dares"]:
        counts["dares"][upsert_dare(db, d, upload_dir)] += 1

    db.commit()
    db.close()
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()

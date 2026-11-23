#!/usr/bin/env python3
"""Merge a content dump (from dump_content.py) into this environment's DB.

Upserts by unique text: a matching row gets its fields/categories/locations
updated, new text gets inserted. By default never deletes — content added
directly on this environment that isn't in the dump is left untouched, so
it's safe to run against an environment that's also edited by hand.

Pass --replace to additionally remove anything on this environment whose
text isn't in the dump at all, so the result matches the dump exactly. A
row still referenced by game history (fanty_rounds/round_prompts) can't be
deleted (same rule as the admin panel) — those are skipped and reported,
not silently left in a half-replaced state.

Usage: python scripts/apply_content.py content.json [--replace]
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


def upsert_reverse_block(db, block, matched):
    """A block has no unique key of its own, so it's matched through its phrases:
    a block holding any phrase from the dump is the same block. Phrases are
    added to it, never removed (that's --replace's job)."""
    texts = block["phrases"]
    block_id = None
    for text in texts:
        row = db.execute("SELECT block_id FROM reverse_phrases WHERE text = ?", (text,)).fetchone()
        if row:
            block_id = row[0]
            break
    if block_id is None:
        block_id = db.execute("INSERT INTO reverse_blocks (status) VALUES (?)", (block["status"],)).lastrowid
        action = "inserted"
    else:
        db.execute("UPDATE reverse_blocks SET status = ? WHERE id = ?", (block["status"], block_id))
        action = "updated"
    for text in texts:
        row = db.execute("SELECT block_id FROM reverse_phrases WHERE text = ?", (text,)).fetchone()
        if row is None:
            db.execute(
                "INSERT INTO reverse_phrases (text, decoys, status, block_id) VALUES (?, '[]', 'active', ?)",
                (text, block_id),
            )
        elif row[0] != block_id:
            print(f"  warning: phrase {text!r} already belongs to another block here — left there", file=sys.stderr)
    matched.setdefault(block_id, set()).update(texts)
    return action


def _remove_unmatched_reverse(db, matched, counts):
    removed = 0
    blocked = 0
    for block_id, keep in matched.items():
        for row in db.execute("SELECT id, text FROM reverse_phrases WHERE block_id = ?", (block_id,)).fetchall():
            if row[1] in keep:
                continue
            try:
                db.execute("DELETE FROM reverse_phrases WHERE id = ?", (row[0],))
                removed += 1
            except sqlite3.IntegrityError:
                blocked += 1
    for row in db.execute("SELECT id FROM reverse_blocks").fetchall():
        if row[0] in matched:
            continue
        try:
            db.execute("DELETE FROM reverse_blocks WHERE id = ?", (row[0],))
            removed += 1
        except sqlite3.IntegrityError:
            blocked += 1
    counts["reverseRemoved"] = {"removed": removed, "blocked": blocked}


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

    music_original_name = d.get("music_original_name") if music_filename else None
    music_start_seconds = d.get("music_start_seconds", 0) if music_filename else 0

    if row:
        dare_id = row[0]
        db.execute(
            """UPDATE fanty_dares SET kind=?, status=?, mixed_pair=?, music_filename=?,
               music_original_name=?, music_start_seconds=?,
               has_timer=?, timer_seconds=? WHERE id=?""",
            (
                d["kind"],
                d["status"],
                int(d["mixed_pair"]),
                music_filename,
                music_original_name,
                music_start_seconds,
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
               music_original_name, music_start_seconds, has_timer, timer_seconds)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                d["text"],
                d["kind"],
                d["status"],
                int(d["mixed_pair"]),
                music_filename,
                music_original_name,
                music_start_seconds,
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


def _remove_missing(db, table, text_column, id_column, keep_texts, label, counts):
    removed = 0
    blocked = 0
    rows = db.execute(f"SELECT {id_column}, {text_column} FROM {table}").fetchall()
    for row in rows:
        if row[1] in keep_texts:
            continue
        try:
            db.execute(f"DELETE FROM {table} WHERE {id_column} = ?", (row[0],))
            removed += 1
        except sqlite3.IntegrityError:
            # Still referenced by game history — same rule the admin panel
            # enforces, so a --replace run can't silently nuke content a
            # finished game's "Итоги игры" summary still points to.
            blocked += 1
    counts[label] = {"removed": removed, "blocked": blocked}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    replace = "--replace" in sys.argv
    if len(args) != 1:
        print("usage: apply_content.py <dump.json> [--replace]", file=sys.stderr)
        sys.exit(1)

    with open(args[0], "r", encoding="utf-8") as f:
        dump = json.load(f)

    upload_dir = os.environ.get("UPLOAD_DIR", os.path.join(BASE_DIR, "uploads"))
    db = sqlite3.connect(DATABASE_PATH)
    db.execute("PRAGMA foreign_keys = ON")

    counts = {
        "prompts": {"inserted": 0, "updated": 0},
        "truths": {"inserted": 0, "updated": 0},
        "dares": {"inserted": 0, "updated": 0},
        "reverse_blocks": {"inserted": 0, "updated": 0},
    }
    # Dumps made before "Наоборот" existed have no such key — treat that as
    # "nothing to say about blocks", never as "the full set is empty", or a
    # --replace run would wipe every block on the target.
    reverse_blocks = dump.get("reverse_blocks")
    matched_reverse = {}
    for p in dump["prompts"]:
        counts["prompts"][upsert_prompt(db, p)] += 1
    for t in dump["truths"]:
        counts["truths"][upsert_truth(db, t)] += 1
    for d in dump["dares"]:
        counts["dares"][upsert_dare(db, d, upload_dir)] += 1
    for block in reverse_blocks or []:
        counts["reverse_blocks"][upsert_reverse_block(db, block, matched_reverse)] += 1

    if replace:
        _remove_missing(db, "prompts", "text", "id", {p["text"] for p in dump["prompts"]}, "promptsRemoved", counts)
        _remove_missing(
            db, "fanty_dares", "text", "id", {d["text"] for d in dump["dares"]}, "daresRemoved", counts
        )
        _remove_missing(
            db, "fanty_truths", "text", "id", {t["text"] for t in dump["truths"]}, "truthsRemoved", counts
        )
        if reverse_blocks is not None:
            _remove_unmatched_reverse(db, matched_reverse, counts)

    db.commit()
    db.close()
    print(json.dumps(counts, indent=2))


if __name__ == "__main__":
    main()

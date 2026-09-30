#!/usr/bin/env python3
"""Dump admin-curated content (prompts, fanty dares, fanty truths) to JSON.

Usage: python scripts/dump_content.py > content.json

Reads DATABASE_PATH the same way the app does (env var, else the default
local vecherinka.db) — run it against whichever environment's DB you want
to export from.
"""
import json
import os
import sqlite3
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "vecherinka.db"))


def main():
    db = sqlite3.connect(DATABASE_PATH)
    db.row_factory = sqlite3.Row

    prompts = [
        {"text": r["text"], "status": r["status"]}
        for r in db.execute("SELECT text, status FROM prompts").fetchall()
    ]

    dares = []
    for r in db.execute(
        "SELECT id, text, kind, status, mixed_pair, music_filename, has_timer, timer_seconds "
        "FROM fanty_dares"
    ).fetchall():
        categories = [
            c["category"]
            for c in db.execute(
                "SELECT category FROM fanty_dare_categories WHERE dare_id = ?", (r["id"],)
            ).fetchall()
        ]
        locations = [
            loc["location"]
            for loc in db.execute(
                "SELECT location FROM fanty_dare_locations WHERE dare_id = ?", (r["id"],)
            ).fetchall()
        ]
        dares.append(
            {
                "text": r["text"],
                "kind": r["kind"],
                "status": r["status"],
                "mixed_pair": bool(r["mixed_pair"]),
                "music_filename": r["music_filename"],
                "has_timer": bool(r["has_timer"]),
                "timer_seconds": r["timer_seconds"],
                "categories": categories,
                "locations": locations,
            }
        )

    truths = []
    for r in db.execute("SELECT id, text, status FROM fanty_truths").fetchall():
        categories = [
            c["category"]
            for c in db.execute(
                "SELECT category FROM fanty_truth_categories WHERE truth_id = ?", (r["id"],)
            ).fetchall()
        ]
        truths.append({"text": r["text"], "status": r["status"], "categories": categories})

    db.close()
    json.dump(
        {"prompts": prompts, "dares": dares, "truths": truths},
        sys.stdout,
        ensure_ascii=False,
        indent=2,
    )


if __name__ == "__main__":
    main()

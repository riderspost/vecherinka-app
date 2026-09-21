import os
import sqlite3

from flask import g

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "vecherinka.db"))
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE_PATH, timeout=10)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout = 10000")
    return g.db


def close_db(_exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _ensure_column(db, table, column, ddl):
    existing = {row["name"] for row in db.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in existing:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    db = sqlite3.connect(DATABASE_PATH)
    db.row_factory = sqlite3.Row
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        db.executescript(f.read())
    _ensure_column(db, "prompts", "status", "status TEXT NOT NULL DEFAULT 'active'")
    _ensure_column(db, "rooms", "game_type", "game_type TEXT NOT NULL DEFAULT 'sentence'")
    _ensure_column(db, "rooms", "device_mode", "device_mode TEXT NOT NULL DEFAULT 'remote'")
    db.commit()
    db.close()


def register_app(app):
    app.teardown_appcontext(close_db)

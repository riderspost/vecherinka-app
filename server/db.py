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
    _ensure_column(db, "fanty_settings", "pick_mode", "pick_mode TEXT NOT NULL DEFAULT 'random'")
    _ensure_column(db, "fanty_state", "picked_cycle", "picked_cycle TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(db, "rooms", "created_by_user_id", "created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL")
    _ensure_column(db, "users", "email_verified", "email_verified INTEGER NOT NULL DEFAULT 1")
    _ensure_column(db, "users", "verification_code", "verification_code TEXT")
    _ensure_column(db, "users", "verification_code_expires_at", "verification_code_expires_at TEXT")
    _ensure_column(db, "players", "gender", "gender TEXT")
    _ensure_column(db, "fanty_dares", "mixed_pair", "mixed_pair INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_settings", "pair_mode", "pair_mode TEXT NOT NULL DEFAULT 'any'")
    _ensure_column(db, "fanty_dares", "music_filename", "music_filename TEXT")
    _ensure_column(db, "fanty_dares", "has_timer", "has_timer INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_dares", "timer_seconds", "timer_seconds INTEGER NOT NULL DEFAULT 60")
    _ensure_column(db, "fanty_state", "performance_started_at", "performance_started_at TEXT")
    _ensure_column(
        db, "fanty_dares", "created_by_user_id", "created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL"
    )
    _ensure_column(
        db, "fanty_truths", "created_by_user_id", "created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL"
    )
    db.commit()
    db.close()


def register_app(app):
    app.teardown_appcontext(close_db)

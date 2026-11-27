import json
import os
import sqlite3
import uuid

from werkzeug.security import generate_password_hash

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


def _migrate_reverse_phrases_to_blocks(db):
    """Old rows were a phrase plus its own list of wrong options; each becomes a block.

    The phrase and its former wrong options are now just five phrases of
    equal standing. Rows already in a block are left alone, so this only
    ever does work once.
    """
    old_rows = db.execute("SELECT id, decoys, status FROM reverse_phrases WHERE block_id IS NULL").fetchall()
    for row in old_rows:
        block_id = db.execute("INSERT INTO reverse_blocks (status) VALUES (?)", (row["status"],)).lastrowid
        db.execute("UPDATE reverse_phrases SET block_id = ?, decoys = '[]' WHERE id = ?", (block_id, row["id"]))
        for text in json.loads(row["decoys"] or "[]"):
            db.execute(
                "INSERT OR IGNORE INTO reverse_phrases (text, decoys, status, block_id) VALUES (?, '[]', 'active', ?)",
                (text, block_id),
            )


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
    # A dare with a timer can ask for a voice recording of the performance
    # (reading a rap, say). The clip waits in fanty_state until the host
    # resolves the round, then moves to the round.
    _ensure_column(db, "fanty_dares", "has_recording", "has_recording INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_state", "recording_filename", "recording_filename TEXT")
    _ensure_column(db, "fanty_state", "recording_failed", "recording_failed INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_rounds", "recording_filename", "recording_filename TEXT")
    # Temporary testing aid: the host picks which dare comes up next.
    _ensure_column(db, "fanty_state", "forced_dare_id", "forced_dare_id INTEGER")
    _ensure_column(
        db, "fanty_dares", "created_by_user_id", "created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL"
    )
    _ensure_column(
        db, "fanty_truths", "created_by_user_id", "created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL"
    )
    _ensure_column(db, "users", "name", "name TEXT")
    _ensure_column(db, "users", "avatar_type", "avatar_type TEXT")
    _ensure_column(db, "users", "avatar_value", "avatar_value TEXT")
    _ensure_column(db, "prompts", "likes", "likes INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_dares", "likes", "likes INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_truths", "likes", "likes INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "rooms", "last_active_at", "last_active_at TEXT NOT NULL DEFAULT (datetime('now'))")
    _ensure_column(db, "users", "games_created_count", "games_created_count INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "fanty_dares", "music_original_name", "music_original_name TEXT")
    _ensure_column(db, "fanty_dares", "music_start_seconds", "music_start_seconds INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "players", "left_at", "left_at TEXT")
    _ensure_column(db, "players", "user_id", "user_id TEXT")
    _ensure_column(db, "players", "device_id", "device_id TEXT")
    _ensure_column(db, "players", "last_seen_at", "last_seen_at REAL")
    # a player's suggestion is reviewed: approved ('active') or rejected, with the date and a reason
    for table in ("fanty_dares", "fanty_truths"):
        _ensure_column(db, table, "reviewed_at", "reviewed_at TEXT")
        _ensure_column(db, table, "reject_reason", "reject_reason TEXT")
    _ensure_column(db, "reverse_rounds", "chunks_json", "chunks_json TEXT NOT NULL DEFAULT '[]'")
    _ensure_column(db, "reverse_rounds", "original_done", "original_done INTEGER NOT NULL DEFAULT 0")
    _ensure_column(db, "reverse_rounds", "imitation_done", "imitation_done INTEGER NOT NULL DEFAULT 0")
    _ensure_column(
        db, "reverse_phrases", "block_id", "block_id INTEGER REFERENCES reverse_blocks(id) ON DELETE CASCADE"
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_reverse_phrases_block ON reverse_phrases(block_id)")
    _migrate_reverse_phrases_to_blocks(db)
    _ensure_column(db, "users", "is_tester", "is_tester INTEGER NOT NULL DEFAULT 0")
    # A paid account may create the games that are not free ("Флирт+" fanty).
    _ensure_column(db, "users", "is_paid", "is_paid INTEGER NOT NULL DEFAULT 0")
    _ensure_tester_user(db)
    db.commit()
    db.close()


TESTER_LOGIN = "admin"
_tester_hashes = {}


def _ensure_tester_user(db):
    """The one account allowed to use the testing aids (extra test players in a
    room, picking which dare comes up). Created on first start in every
    environment; if it already exists only the flag is made sure of — its
    password is never touched again. Its login is not an email, so nobody can
    register it. The first password comes from TESTER_PASSWORD."""
    row = db.execute("SELECT id FROM users WHERE email = ?", (TESTER_LOGIN,)).fetchone()
    if row:
        db.execute("UPDATE users SET is_tester = 1, is_paid = 1 WHERE id = ?", (row["id"],))
        return
    password = os.environ.get("TESTER_PASSWORD") or "admin"
    if password not in _tester_hashes:  # hashing is slow on purpose; do it once
        _tester_hashes[password] = generate_password_hash(password, method="pbkdf2:sha256")
    db.execute(
        """INSERT INTO users (id, email, password_hash, email_verified, name, avatar_type, avatar_value, is_tester, is_paid)
           VALUES (?, ?, ?, 1, 'Админ', 'emoji', '🛠️', 1, 1)""",
        (str(uuid.uuid4()), TESTER_LOGIN, _tester_hashes[password]),
    )


def register_app(app):
    app.teardown_appcontext(close_db)

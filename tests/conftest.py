import os
import sqlite3
import tempfile

_tmp_dir = tempfile.mkdtemp(prefix="vecherinka-test-")
os.environ["DATABASE_PATH"] = os.path.join(_tmp_dir, "test.db")
os.environ["UPLOAD_DIR"] = os.path.join(_tmp_dir, "uploads")
os.environ["SECRET_KEY"] = "test-secret-key"
os.environ["ADMIN_USERNAME"] = "test-admin"
os.environ["ADMIN_PASSWORD"] = "test-admin-password"
os.environ.pop("RESEND_API_KEY", None)
os.environ.pop("OPENROUTER_API_KEY", None)

import pytest

from server.app import app as flask_app

flask_app.config.update(TESTING=True)

# Tables that hold per-game/per-user state; wiped before every test so tests
# don't see leftovers from each other. Seed content (prompts, fanty_dares,
# fanty_truths and their category/location tables) is intentionally left
# alone — it's inserted once at app import time and every test relies on it
# being there.
TRANSACTIONAL_TABLES = ["users", "rooms"]


@pytest.fixture()
def client():
    return flask_app.test_client()


@pytest.fixture()
def raw_db():
    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture(autouse=True)
def _clean_db():
    conn = sqlite3.connect(os.environ["DATABASE_PATH"])
    conn.execute("PRAGMA foreign_keys = ON")
    for table in TRANSACTIONAL_TABLES:
        conn.execute(f"DELETE FROM {table}")
    conn.commit()
    conn.close()
    yield

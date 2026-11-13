import os

import pytest

from server import app as flask_app

# Looks like the files that live next to the website but must never be served.
# They are created fresh for each test (with names that cannot clash with real
# files), so the test behaves the same on a laptop and in a clean CI checkout.
CANARIES = [
    ".env.canary",
    ".canary_secret",
    "canary.db",
    "canary_requirements.txt",
    "server/canary_secret.py",
    "tests/canary_notes.py",
    "scripts/canary_tool.py",
    ".git-canary/config",
]

# Names of the real private files. Whether or not they exist here, their
# contents must never come back; if the file is absent the app answers with
# its front page, which is fine.
REAL_PRIVATE_PATHS = [
    ".env", ".env.example", ".env.save", ".flask_secret", "vecherinka.db",
    "server/app.py", ".git/config", ".git/HEAD", ".github/workflows/ci.yml",
    "requirements.txt", "render.yaml", "pytest.ini", "tests/conftest.py", "Procfile",
    "src/../.env", "src/../server/app.py", "%2e%65%6e%76", "src/%2e%2e/.env",
]

PUBLIC_PATHS = [
    "", "index.html", "styles.css", "manifest.json", "sw.js",
    "src/main.js", "icons/apple-touch-icon.png",
]


@pytest.fixture()
def canary_files():
    marker = "CANARY-CONTENT-THAT-MUST-NOT-LEAK"
    created = []
    for rel in CANARIES:
        path = os.path.join(flask_app.BASE_DIR, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(marker)
        created.append(path)
    yield marker
    for path in created:
        os.remove(path)
    os.rmdir(os.path.join(flask_app.BASE_DIR, ".git-canary"))


@pytest.mark.parametrize("path", CANARIES)
def test_existing_project_files_answer_404(client, canary_files, path):
    res = client.get(f"/{path}")
    assert res.status_code == 404
    assert canary_files not in res.get_data(as_text=True)


@pytest.mark.parametrize("path", REAL_PRIVATE_PATHS)
def test_real_private_files_never_come_back(client, path):
    res = client.get(f"/{path}")
    assert res.status_code in (200, 400, 404)
    body = res.get_data(as_text=True)
    if res.status_code == 200:
        # only ever the single-page app's front page
        assert "<title>" in body
    for leaked in ("OPENROUTER_API_KEY", "RESEND_API_KEY", "SQLite format", "def ", "[core]"):
        assert leaked not in body


@pytest.mark.parametrize("path", PUBLIC_PATHS)
def test_website_files_are_served(client, path):
    assert client.get(f"/{path}").status_code == 200


def test_front_end_routes_still_fall_back_to_the_app(client):
    for path in ("/some/deep/link", "/r/ABCD"):
        res = client.get(path)
        assert res.status_code == 200
        assert "<title>" in res.get_data(as_text=True)

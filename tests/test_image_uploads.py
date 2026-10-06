import io
import os

from PIL import Image


def _big_jpeg_bytes(size=(2000, 2000)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 50, 100)).save(buf, "JPEG", quality=90)
    buf.seek(0)
    return buf


def test_avatar_upload_is_downscaled(client):
    resp = client.post(
        "/api/upload-avatar",
        data={"file": (_big_jpeg_bytes(), "big.jpg")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    filename = resp.get_json()["filename"]

    saved_path = os.path.join(os.environ["UPLOAD_DIR"], filename)
    with Image.open(saved_path) as img:
        assert max(img.size) <= 256


def test_fanty_round_photo_upload_is_downscaled(client):
    resp = client.post(
        "/api/fanty/rooms",
        json={
            "name": "Host",
            "avatarType": "emoji",
            "avatarValue": "🙂",
            "gameMode": "solo",
            "location": "apartment",
            "categories": ["basic"],
            "pickMode": "fair",
            "pairMode": "any",
            "deviceMode": "remote",
        },
    )
    code = resp.get_json()["code"]

    resp = client.post(
        f"/api/fanty/rooms/{code}/upload-photo",
        data={"file": (_big_jpeg_bytes((3000, 2000)), "big.jpg")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    filename = resp.get_json()["filename"]

    saved_path = os.path.join(os.environ["UPLOAD_DIR"], filename)
    with Image.open(saved_path) as img:
        assert max(img.size) <= 1600
        # Aspect ratio should survive the resize (3:2 in, 3:2 out).
        assert abs(img.size[0] / img.size[1] - 1.5) < 0.01


def test_avatar_upload_rejects_bad_extension(client):
    resp = client.post(
        "/api/upload-avatar",
        data={"file": (io.BytesIO(b"not an image"), "file.exe")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400

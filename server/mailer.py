import os

import requests

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL") or "onboarding@resend.dev"


def send_email(to, subject, html):
    """Sends an email via Resend. Returns True on success, False otherwise (never raises)."""
    if not RESEND_API_KEY:
        print(f"[mailer] RESEND_API_KEY не задан — письмо на {to} не отправлено: {subject}", flush=True)
        return False
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={"from": RESEND_FROM_EMAIL, "to": [to], "subject": subject, "html": html},
            timeout=10,
        )
        if resp.status_code >= 300:
            print(f"[mailer] Resend вернул {resp.status_code}: {resp.text[:300]}", flush=True)
            return False
        return True
    except requests.RequestException as e:
        print(f"[mailer] Ошибка отправки письма: {e}", flush=True)
        return False

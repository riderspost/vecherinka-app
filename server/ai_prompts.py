import json
import os

import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openrouter/free"
REQUEST_TIMEOUT = 60
MAX_EXISTING_SAMPLE = 80

SYSTEM_PROMPT = (
    "Ты помогаешь придумывать фразы для вечеринки-игры «Продолжи предложение». "
    "Каждая фраза — начало предложения на русском языке, которое участники "
    "дополняют своим смешным, неожиданным или интересным продолжением. Фразы "
    "должны быть короткими (до 15 слов), однозначно незаконченными (явно "
    "требовать продолжения), разнообразными по теме и подходящими для весёлой "
    "компании друзей — без оскорблений, жёсткой политики и контента 18+.\n\n"
    'Отвечай СТРОГО в формате JSON: {"prompts": ["фраза 1", "фраза 2", ...]} '
    "без каких-либо пояснений до или после."
)


class AIGenerationError(Exception):
    pass


def generate_prompts(count, theme, existing_texts):
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise AIGenerationError(
            "OPENROUTER_API_KEY не задан на сервере — генерация через AI недоступна"
        )
    model = os.environ.get("OPENROUTER_MODEL", DEFAULT_MODEL)

    parts = [f"Придумай {count} новых фраз для игры."]
    if theme:
        parts.append(f"Пожелание по теме/стилю: {theme}.")
    sample = existing_texts[-MAX_EXISTING_SAMPLE:]
    if sample:
        parts.append(
            "Не повторяй и не перефразируй уже существующие фразы:\n"
            + "\n".join(f"- {t}" for t in sample)
        )
    user_message = "\n\n".join(parts)

    try:
        resp = requests.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.9,
            },
            timeout=REQUEST_TIMEOUT,
        )
    except requests.ConnectionError:
        raise AIGenerationError("Не удалось подключиться к OpenRouter")
    except requests.Timeout:
        raise AIGenerationError("OpenRouter не ответил вовремя")

    if resp.status_code == 401:
        raise AIGenerationError("Неверный OPENROUTER_API_KEY на сервере")
    if resp.status_code == 429:
        raise AIGenerationError("Превышен лимит запросов к OpenRouter, попробуйте позже")
    if resp.status_code >= 400:
        raise AIGenerationError(f"Ошибка OpenRouter ({resp.status_code}): {resp.text[:300]}")

    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError):
        raise AIGenerationError("Не удалось разобрать ответ OpenRouter")

    try:
        parsed = json.loads(content)
        prompts = parsed["prompts"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise AIGenerationError("AI вернул ответ не в ожидаемом формате JSON")

    seen_lower = {t.lower() for t in existing_texts}
    cleaned = []
    for p in prompts:
        if not isinstance(p, str):
            continue
        p = p.strip()
        if not p or len(p) > 300 or p.lower() in seen_lower:
            continue
        seen_lower.add(p.lower())
        cleaned.append(p)

    return cleaned

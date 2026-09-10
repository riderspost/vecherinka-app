import json
import os

import requests

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-chat"
REQUEST_TIMEOUT = 60
MAX_EXISTING_SAMPLE = 80
MIN_PROMPT_LEN = 10

EXAMPLE_PROMPTS = [
    "Если бы я был супергероем, моей суперсилой было бы...",
    "Секрет моего успеха в том, что я...",
    "Самая странная вещь в моём холодильнике — это...",
    "Мой любимый способ бездельничать — это...",
    "Идеальное утро выходного дня начинается с...",
    "Если бы вещи в моей комнате могли говорить, они бы жаловались на...",
]

SYSTEM_PROMPT = (
    "Ты — опытный автор фраз для вечеринки-игры «Продолжи предложение». Каждая "
    "фраза — начало предложения на русском языке, которое участник дополняет "
    "своим смешным, неожиданным или интересным продолжением вслух при друзьях.\n\n"
    "Вот примеры уже хорошо работающих фраз (ориентируйся на их стиль, длину и "
    "разговорную интонацию, но не копируй и не перефразируй их):\n"
    + "\n".join(f"- {p}" for p in EXAMPLE_PROMPTS)
    + "\n\n"
    "Требования к каждой новой фразе:\n"
    "- короткая (до 12 слов), звучит как живая разговорная речь, а не книжно "
    "или казённо;\n"
    "- однозначно незаконченная — обрывается на месте, требующем продолжения "
    "(часто, но не всегда, заканчивается на «...»);\n"
    "- провоцирует конкретный, а не абстрактный ответ — представь, что её "
    "читают вслух в компании и через секунду начинают смеяться, придумывая "
    "продолжение;\n"
    "- не начинай все фразы одинаково — чередуй разные конструкции («Если "
    "бы...», «Мой/моя...», «Самое/самый...», «В моей жизни...», "
    "«Никогда не признаюсь, что...» и т.п.), как в примерах выше;\n"
    "- без оскорблений, жёсткой политики и контента 18+.\n\n"
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

    actual_model = data.get("model") or model

    try:
        parsed = json.loads(content)
        prompts = parsed["prompts"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise AIGenerationError("AI вернул ответ не в ожидаемом формате JSON")
    if not isinstance(prompts, list):
        raise AIGenerationError("AI вернул «prompts» не как список фраз")

    seen_lower = {t.lower() for t in existing_texts}
    cleaned = []
    for p in prompts:
        if not isinstance(p, str):
            continue
        p = p.strip()
        if len(p) < MIN_PROMPT_LEN or len(p) > 300 or p.lower() in seen_lower:
            continue
        seen_lower.add(p.lower())
        cleaned.append(p)

    return cleaned, actual_model

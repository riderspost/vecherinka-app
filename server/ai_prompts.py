import json
import os

import anthropic

MODEL = "claude-opus-5"
MAX_EXISTING_SAMPLE = 80

SYSTEM_PROMPT = (
    "Ты помогаешь придумывать фразы для вечеринки-игры «Продолжи предложение». "
    "Каждая фраза — начало предложения на русском языке, которое участники "
    "дополняют своим смешным, неожиданным или интересным продолжением. Фразы "
    "должны быть короткими (до 15 слов), однозначно незаконченными (явно "
    "требовать продолжения), разнообразными по теме и подходящими для весёлой "
    "компании друзей — без оскорблений, жёсткой политики и контента 18+."
)


class AIGenerationError(Exception):
    pass


def generate_prompts(count, theme, existing_texts):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIGenerationError(
            "ANTHROPIC_API_KEY не задан на сервере — генерация через AI недоступна"
        )

    client = anthropic.Anthropic(api_key=api_key)

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
        response = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            system=SYSTEM_PROMPT,
            output_config={
                "effort": "low",
                "format": {
                    "type": "json_schema",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "prompts": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["prompts"],
                        "additionalProperties": False,
                    },
                },
            },
            messages=[{"role": "user", "content": user_message}],
        )
    except anthropic.AuthenticationError:
        raise AIGenerationError("Неверный ANTHROPIC_API_KEY на сервере")
    except anthropic.RateLimitError:
        raise AIGenerationError("Превышен лимит запросов к AI, попробуйте чуть позже")
    except anthropic.APIStatusError as e:
        raise AIGenerationError(f"Ошибка AI-сервиса: {e.message}")
    except anthropic.APIConnectionError:
        raise AIGenerationError("Не удалось подключиться к AI-сервису")

    text_block = next((b.text for b in response.content if b.type == "text"), None)
    if not text_block:
        raise AIGenerationError("AI не вернул текстовый ответ")

    try:
        data = json.loads(text_block)
        prompts = data["prompts"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise AIGenerationError("Не удалось разобрать ответ AI")

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

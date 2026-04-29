import json
import logging
import re

import httpx
import os

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT = """\
You are a memory extraction assistant. Given a single conversation turn between a user \
and an AI, extract a structured memory object and return it as raw JSON with no preamble, \
no markdown, no code fences, and no commentary — only the JSON object itself.

The JSON must have exactly these fields:
- "title": string, 5–8 words, describes what was discussed
- "summary": string, 1–3 sentences, what was said — written so it makes sense when \
read later without the original conversation
- "tags": array of lowercase strings, 2–6 topic words or short phrases (e.g. "guitar", \
"music theory", "new hampshire beaches")
- "importance": float 0.0–1.0 (0.3 = casual chat, 0.6 = useful fact, \
0.9 = personal detail or decision)
- "sentiment": one of "positive", "negative", "neutral"

Conversation turn:
User: {user_message}
Assistant: {assistant_message}

Return only the JSON object.
"""
MAX_ASSISTANT_CHARS = 1500

async def extract_memory(user_message: str, assistant_message: str) -> dict | None:
    assistant_snippet = assistant_message[:MAX_ASSISTANT_CHARS]
    if len(assistant_message) > MAX_ASSISTANT_CHARS:
        assistant_snippet += "\n[truncated]"

    prompt = EXTRACTION_PROMPT.format(
        user_message=user_message,
        assistant_message=assistant_snippet,
    )

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "/no_think Return only valid JSON. No markdown, no explanation.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "stream": False,
                },
            )
            response.raise_for_status()

        raw = response.json()["message"]["content"].strip()
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

        # Strip markdown code fences if the model ignores instructions
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        parsed = json.loads(raw)
        logger.debug(f"Extracted memory: {parsed}")
        return parsed

    except (json.JSONDecodeError, KeyError, httpx.HTTPError) as e:
        logger.warning(f"Memory extraction failed: {type(e).__name__}: {e}", exc_info=True)
        return None
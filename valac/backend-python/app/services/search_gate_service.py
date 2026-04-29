import httpx
import json
import logging
import os
import re

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

logger = logging.getLogger(__name__)

GATE_PROMPT = """\
Does this question require current, real-time, or recently updated information \
to answer accurately? This includes: current events, news, prices, sports scores, \
weather, recent software releases, or anything that changes frequently.

Return only a JSON object with two fields:
- "needs_search": true or false
- "query": if needs_search is true, the best search query to use (concise, 5-8 words). \
  If false, set to null.

Question: {prompt}

Return only the JSON object."""


async def should_search(prompt: str) -> tuple[bool, str | None]:
    """
    Returns (needs_search, query_string).
    Fast call — uses no_think and stream=False.
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{OLLAMA_HOST}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "/no_think Return only valid JSON. No markdown, no explanation.",
                        },
                        {
                            "role": "user",
                            "content": GATE_PROMPT.format(prompt=prompt),
                        },
                    ],
                    "stream": False,
                },
            )
            response.raise_for_status()

        raw = response.json()["message"]["content"].strip()
        raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)

        # Find first JSON object in response
        match = re.search(r"\{.*?\}", raw, re.DOTALL)
        if not match:
            logger.debug(f"Search gate raw response: {raw!r}")
            return False, None

        parsed = json.loads(match.group())
        needs  = bool(parsed.get("needs_search", False))
        query  = parsed.get("query") if needs else None
        logger.debug(f"Search gate: needs_search={needs}, query={query!r}")
        return needs, query

    except Exception as e:
        logger.warning(f"Search gate failed ({type(e).__name__}): {e}")
        return False, None
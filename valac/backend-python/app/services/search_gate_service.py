import httpx
import json
import logging
import os
import re

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

logger = logging.getLogger(__name__)

GATE_PROMPT = """\
Analyze this message and return a JSON object with exactly these fields:

- "needs_search": true if the question requires current, real-time, or recently \
updated information (news, prices, scores, weather, recent releases, anything \
that changes frequently). false otherwise.
- "search_query": if needs_search is true, the best search query to use (5-8 words). \
null if false.
- "needs_verbatim": true if an accurate answer would benefit from seeing the exact \
wording of past exchanges (e.g. the user is asking about something very specific \
they said before, or precision matters). false if a summary would suffice.
- "is_personal": true if the message reveals personal information about the user \
(facts, preferences, constraints, habits, opinions) OR if the message references \
or implies something personal about the user that would require retrieving stored \
personal context to answer well. false otherwise.
- "is_complex": true if answering well requires deep context, multi-step reasoning, \
or broad memory retrieval. false for simple factual questions, greetings, or \
throwaway queries that need no memory at all.

Message: {prompt}

Return only the JSON object. No markdown, no explanation."""


async def should_search(prompt: str) -> tuple[bool, str | None, bool, bool, bool]:
    """
    Returns (needs_search, search_query, needs_verbatim, is_personal, is_complex).
    Runs concurrently with embedding in /ask — keep fast.
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

        match = re.search(r"\{.*?\}", raw, re.DOTALL)
        if not match:
            logger.debug(f"Gate raw response: {raw!r}")
            return False, None, False, False, True  # safe defaults

        parsed       = json.loads(match.group())
        needs_search = bool(parsed.get("needs_search", False))
        search_query = parsed.get("search_query") if needs_search else None
        needs_verbatim = bool(parsed.get("needs_verbatim", False))
        is_personal  = bool(parsed.get("is_personal", False))
        is_complex   = bool(parsed.get("is_complex", True))

        logger.debug(
            f"Gate: needs_search={needs_search}, needs_verbatim={needs_verbatim}, "
            f"is_personal={is_personal}, is_complex={is_complex}, query={search_query!r}"
        )
        return needs_search, search_query, needs_verbatim, is_personal, is_complex

    except Exception as e:
        logger.warning(f"Gate failed ({type(e).__name__}): {e}")
        return False, None, False, False, True  # fail open on is_complex
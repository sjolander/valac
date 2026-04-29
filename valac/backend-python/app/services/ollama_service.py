import httpx
import json
import os
import logging

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# The four levels you'll use day to day:
# logger.debug("raw detail you only want when hunting a bug")
# logger.info("normal lifecycle events — request received, memory found, etc.")
# logger.warning("something unexpected but not fatal")
# logger.error("something broke")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")


async def stream_chat(
    prompt: str,
    system_prompt: str | None = None,
    history: list[dict] | None = None,
):
    """
    Stream a chat response from Ollama.

    Uses /api/chat instead of /api/generate so we can pass a system prompt
    separately — this is how memory context gets injected without being
    mixed into the user's message.
    """
    messages = []

    if system_prompt:
        messages.append({"role": "system", "content": f"/no_think {system_prompt}"})

    if history:
        messages.extend(history)

    messages.append({"role": "user", "content": prompt})

    logger.debug(messages)

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_HOST}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": messages,
                "stream": True,
            },
        ) as response:
            async for line in response.aiter_lines():
                if not line:
                    continue

                data = json.loads(line)

                # /api/chat wraps content under message.content
                if content := data.get("message", {}).get("content"):
                    yield content

                if data.get("done"):
                    break

async def complete(prompt: str, system_prompt: str = "") -> str:
    """
    Non-streaming single-turn completion via Ollama.
    Used by topic_chunk_service for LLM summarization.
    Returns the full response text.
    """
    payload: dict = {
        "model":  OLLAMA_MODEL,
        "prompt": f"{prompt} /no_think",
        "stream": False,
    }
    if system_prompt:
        payload["system"] = system_prompt
 
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(f"{OLLAMA_HOST}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("response", "").strip()
 
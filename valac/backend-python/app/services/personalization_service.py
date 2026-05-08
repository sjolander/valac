import json
import logging
import uuid
from datetime import datetime, timezone

from app.services.embedding_service import get_embedding
from app.services.qdrant_service import (
    find_conflicting_personal_fact,
    get_personal_facts_by_category,
    get_all_active_personal_facts,
    search_active_personal_facts,
    supersede_personal_fact,
    upsert_personal_fact,
)

# Import however your extraction_service calls Ollama non-streaming.
# Adjust if your function name/signature differs.
from app.services.ollama_service import complete

logger = logging.getLogger(__name__)

ALWAYS_INJECT_CATEGORIES = {"identity", "occupation"}

# ── Extraction ────────────────────────────────────────────────────────────────

EXTRACTION_SYSTEM = """\
You extract personal facts about the user from their messages.
Return ONLY a JSON array — no explanation, no markdown, no commentary.
If there are no personal facts, return an empty array: []

Each item must have exactly these fields:
  fact          — a single, self-contained sentence stating the fact
  category      — one of: identity, occupation, skill, preference, relationship, goal, context
  canonical_key — a dot-separated key like "skill.linked_lists" or "preference.dark_mode"
  confidence    — float 0.0–1.0

Rules:
- Extract only facts about the user, stated explicitly or very clearly implied.
- Do not infer from vague statements. Prefer high confidence over quantity.
- canonical_key must be stable: use snake_case, be specific but not verbose.
- One fact per item. Split compound facts.
"""

EXTRACTION_USER_TMPL = """\
Extract personal facts from this user message:

\"\"\"{message}\"\"\"
"""


async def _extract_facts_from_message(user_message: str) -> list[dict]:
    """Call the LLM to extract structured personal facts from a single user message."""
    logger.debug("Looking for personal facts in user message")
    logger.debug(f"User message: {user_message[:500]}")

    try:
        raw = await complete(
            prompt=EXTRACTION_USER_TMPL.format(message=user_message.strip()),
            system_prompt=EXTRACTION_SYSTEM,
        )

        logger.debug(f"Raw personal fact extraction response: {raw[:1000]}")

        # Strip accidental markdown fences
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        facts = json.loads(raw.strip())

        if not isinstance(facts, list):
            logger.debug("Extraction response was not a list")
            return []

        filtered_facts = [f for f in facts if isinstance(f, dict) and "fact" in f]

        if filtered_facts:
            logger.debug(
                "Found these personal facts: %s",
                [f.get("fact", "") for f in filtered_facts],
            )
        else:
            logger.debug("No personal facts found")

        return filtered_facts

    except Exception as e:
        logger.error(f"Personal fact extraction failed: {e}", exc_info=True)
        return []


# ── Storage ───────────────────────────────────────────────────────────────────

async def _store_fact(fact: dict, user_id: str, conversation_id: str) -> None:
    """
    Embed a fact, check for conflicts, version if needed, then upsert.
    """
    fact_text   = fact.get("fact", "").strip()
    category    = fact.get("category", "context")
    canon_key   = fact.get("canonical_key", "")
    confidence  = float(fact.get("confidence", 0.7))

    logger.debug(
        "Preparing to store personal fact: "
        f"fact='{fact_text}', "
        f"category='{category}', "
        f"canonical_key='{canon_key}', "
        f"confidence={confidence}"
    )

    if not fact_text or confidence < 0.6:
        logger.debug(
            f"Skipping personal fact due to missing text or low confidence: "
            f"fact='{fact_text}', confidence={confidence}"
        )
        return

    logger.debug(f"Generating embedding for personal fact: {fact_text}")

    vector   = await get_embedding(fact_text)

    logger.debug(
        f"Looking for conflicting/similar stored personal facts for: {fact_text}"
    )

    existing = await find_conflicting_personal_fact(vector, user_id)

    if existing:
        logger.debug(
            "Found existing/conflicting personal fact in DB: "
            f"{existing.get('fact', '')}"
        )
    else:
        logger.debug("No conflicting personal fact found in DB")

    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)

    if existing:
        existing_id   = existing.pop("_id")
        existing_fact = existing.get("fact", "")
        existing_ver  = existing.get("version", 1)

        if existing_fact.lower() == fact_text.lower():
            # Exact confirmation — just bump last_confirmed_at and times_seen
            from app.services.qdrant_service import get_client, PERSONAL_FACTS_COLLECTION
            client = get_client()

            logger.debug(
                f"Fact already exists verbatim. Updating confirmation metadata for: "
                f"{fact_text}"
            )

            await client.set_payload(
                collection_name=PERSONAL_FACTS_COLLECTION,
                payload={
                    "last_confirmed_at": now_ms,
                    "times_seen": existing.get("times_seen", 1) + 1,
                },
                points=[existing_id],
            )

            logger.debug(f"Confirmed personal fact: {fact_text[:60]}")
            return

        # Different text on same topic → version it
        logger.debug(
            f"Versioning personal fact [{category}]: "
            f"'{existing_fact[:50]}' → '{fact_text[:50]}'"
        )

        await supersede_personal_fact(existing_id)

        payload = {
            "fact":              fact_text,
            "category":          category,
            "canonical_key":     canon_key,
            "confidence":        confidence,
            "status":            "active",
            "version":           existing_ver + 1,
            "previous_fact":     existing_fact,
            "user_id":           user_id,
            "source_conversation_id": conversation_id,
            "created_at":        now_ms,
            "last_confirmed_at": now_ms,
            "times_seen":        1,
        }
    else:
        # Brand new fact
        payload = {
            "fact":              fact_text,
            "category":          category,
            "canonical_key":     canon_key,
            "confidence":        confidence,
            "status":            "active",
            "version":           1,
            "previous_fact":     None,
            "user_id":           user_id,
            "source_conversation_id": conversation_id,
            "created_at":        now_ms,
            "last_confirmed_at": now_ms,
            "times_seen":        1,
        }

    logger.debug(
        "Storing these personal facts payload fields: "
        f"fact='{payload['fact']}', "
        f"category='{payload['category']}', "
        f"canonical_key='{payload['canonical_key']}', "
        f"version={payload['version']}"
    )

    await upsert_personal_fact(payload, vector)

    logger.debug(f"Successfully stored personal fact: {fact_text}")


async def extract_and_store_personal_facts(
    user_message: str,
    user_id: str,
    conversation_id: str,
) -> None:
    """
    Background task: extract personal facts from user message, version/store each one.
    Already wired into /ask via asyncio.create_task when is_personal=True.
    """
    logger.debug(
        f"Starting personal fact extraction pipeline for user_id={user_id}, "
        f"conversation_id={conversation_id}"
    )

    facts = await _extract_facts_from_message(user_message)

    if not facts:
        logger.debug("No personal facts extracted from message")
        return

    logger.debug(
        "Extracted personal facts for storage: %s",
        [f.get("fact", "") for f in facts],
    )

    logger.debug(f"Storing {len(facts)} personal fact(s)")

    for fact in facts:
        try:
            await _store_fact(fact, user_id, conversation_id)
        except Exception as e:
            logger.error(f"Failed to store personal fact: {e}", exc_info=True)


# ── Retrieval ─────────────────────────────────────────────────────────────────

async def search_personal_facts(
    query_vector: list[float],
    user_id: str,
) -> list[dict]:
    """
    Dual retrieval pass:
    1. Semantic search — facts relevant to the current query
    2. Always-inject — identity + occupation facts, regardless of query
    Deduplicates by canonical_key, returns merged list.
    """
    logger.debug(
        f"Looking up personal facts for prompt assembly for user_id={user_id}"
    )

    semantic_task  = search_active_personal_facts(query_vector, user_id)
    always_task    = get_personal_facts_by_category(user_id, list(ALWAYS_INJECT_CATEGORIES))

    semantic, always = await __import__("asyncio").gather(semantic_task, always_task)

    logger.debug(
        "Pulled always-inject personal facts from DB: %s",
        [f.get("fact", "") for f in always],
    )

    logger.debug(
        "Pulled semantic-match personal facts from DB: %s",
        [f.get("fact", "") for f in semantic],
    )

    seen_keys: set[str] = set()
    merged: list[dict]  = []

    for fact in always:
        key = fact.get("canonical_key", fact["fact"])
        if key not in seen_keys:
            seen_keys.add(key)
            merged.append(fact)

    for fact in semantic:
        key = fact.get("canonical_key", fact["fact"])
        if key not in seen_keys:
            seen_keys.add(key)
            merged.append(fact)

    logger.debug(
        "Final merged personal facts injected into prompt: %s",
        [f.get("fact", "") for f in merged],
    )

    return merged


# ── Prompt formatting ─────────────────────────────────────────────────────────

def format_personal_facts_for_prompt(facts: list[dict]) -> str:
    if not facts:
        logger.debug("No personal facts available for prompt formatting")
        return ""

    logger.debug(
        "Formatting personal facts for prompt: %s",
        [f.get("fact", "") for f in facts],
    )

    lines = []
    for f in facts:
        text = f.get("fact", "")
        prev = f.get("previous_fact")
        ver  = f.get("version", 1)

        if prev and ver > 1:
            # Expose the arc — this is the key UX insight
            lines.append(f"- {text} (previously: {prev})")
        else:
            lines.append(f"- {text}")

    return "## What you know about the user\n" + "\n".join(lines)
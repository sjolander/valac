"""
Topic-chunk pipeline for Valac.

Runs post-response as a fire-and-forget task. Responsibilities:

  1. Persist user + assistant messages to Postgres.
  2. Determine whether the new exchange extends the current topic chunk
     or represents a topic drift requiring a new chunk.
  3. Summarize (via LLM) and upsert the chunk to both Qdrant and Postgres.
  4. Format retrieved topic chunks for injection into the system prompt.

Topic drift detection:
  Cosine similarity between the user message embedding (query_vector, already
  computed in /ask) and the current chunk's stored vector. Below
  TOPIC_DRIFT_THRESHOLD → new chunk.
"""

import json
import logging
import math
import uuid
from datetime import datetime, timezone

from app.models import (
    ExtractedTopicChunk,
    MessageRecord,
    StoredTopicChunk,
    TopicChunkPayload,
    TopicChunkRecord,
)
from app.services.embedding_service import get_embedding
from app.services.ollama_service import complete
from app.services.postgres_service import (
    ensure_conversation,
    get_latest_chunk,
    get_messages_in_range,
    get_next_turn_index,
    get_pool,
    set_conversation_title,
    store_messages,
    upsert_topic_chunk,
)
from app.services.qdrant_service import (
    get_topic_chunk_point,
    upsert_topic_chunk as qdrant_upsert_chunk,
    update_topic_chunk
)

logger = logging.getLogger(__name__)

TOPIC_DRIFT_THRESHOLD = 0.65   # cosine similarity below this → start new chunk

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na  = math.sqrt(sum(x * x for x in a))
    nb  = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _to_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


_SUMMARIZE_SYSTEM = (
    "You are a memory assistant. Given a conversation excerpt, return a JSON object "
    "with exactly two keys:\n"
    '  "topic_label": a short noun phrase (6 words or fewer) naming the topic\n'
    '  "summary": 1–3 sentences capturing the key points discussed\n'
    "Return only valid JSON — no markdown fences, no explanation."
)


async def _summarize_turns(turns: list[MessageRecord]) -> ExtractedTopicChunk:
    """Ask the LLM to label and summarize a list of turns."""
    formatted = "\n".join(
        f"{r.role.capitalize()}: {r.content}" for r in turns
    )
    prompt = f"Summarize this conversation excerpt:\n\n{formatted}"
    raw    = await complete(prompt, system_prompt=_SUMMARIZE_SYSTEM)

    try:
        data = json.loads(raw)
        return ExtractedTopicChunk(
            topic_label=data["topic_label"],
            summary=data["summary"],
        )
    except Exception:
        logger.warning("Failed to parse summarization JSON; using raw text as summary")
        return ExtractedTopicChunk(topic_label="conversation", summary=raw[:300])


async def _build_stored_chunk(
    extracted: ExtractedTopicChunk,
    conversation_id: str,
    turn_start: int,
    turn_end: int,
    timestamp_start_ms: int,
    timestamp_end_ms: int,
    chunk_id: str | None = None,
) -> StoredTopicChunk:
    """Embed the summary and assemble a StoredTopicChunk ready for Qdrant upsert."""
    payload = extracted.to_payload(
        conversation_id=conversation_id,
        turn_start=turn_start,
        turn_end=turn_end,
        timestamp_start=timestamp_start_ms,
        timestamp_end=timestamp_end_ms,
    )
    if chunk_id:
        payload.chunk_id = chunk_id  # preserve ID when re-summarizing an existing chunk
    vector = await get_embedding(extracted.summary)
    return StoredTopicChunk(id=payload.chunk_id, vector=vector, payload=payload)


def _chunk_record_from_stored(stored: StoredTopicChunk, now: datetime) -> TopicChunkRecord:
    """Convert a StoredTopicChunk to the Postgres row shape."""
    p = stored.payload
    return TopicChunkRecord(
        chunk_id=p.chunk_id,
        conversation_id=p.conversation_id,
        topic_label=p.topic_label,
        turn_start=p.turn_start,
        turn_end=p.turn_end,
        timestamp_start=datetime.fromtimestamp(p.timestamp_start / 1000, tz=timezone.utc),
        timestamp_end=now,
    )


# ---------------------------------------------------------------------------
# Main background task
# ---------------------------------------------------------------------------

async def process_turn_post_response(
    user_message: str,
    assistant_message: str,
    conversation_id: str,
    query_vector: list[float],
) -> None:
    """
    Persist a completed exchange and update the topic-chunk layer.

    Designed to run as a fire-and-forget asyncio task immediately after
    the LLM stream completes — do not await in the critical path.
    """
    try:
        now    = datetime.now(timezone.utc)
        now_ms = _to_ms(now)

        # ── 1. Ensure conversation row ───────────────────────────────────
        await ensure_conversation(conversation_id)

        # ── 2. Allocate turn indices ─────────────────────────────────────
        pool = await get_pool()
        async with pool.acquire() as conn:
            user_turn_idx = await get_next_turn_index(conversation_id, conn)
        assistant_turn_idx = user_turn_idx + 1

        # ── 3. Persist messages ──────────────────────────────────────────
        user_rec = MessageRecord(
            conversation_id=conversation_id,
            turn_index=user_turn_idx,
            role="user",
            content=user_message,
            created_at=now,
        )
        asst_rec = MessageRecord(
            conversation_id=conversation_id,
            turn_index=assistant_turn_idx,
            role="assistant",
            content=assistant_message,
            created_at=now,
        )
        await store_messages(user_rec, asst_rec)

        if user_turn_idx == 0:
            raw_title = user_message[:60].strip()
            title     = raw_title if len(user_message) <= 60 else raw_title + "..."
            await set_conversation_title(conversation_id, title)

        # ── 4. Fetch current chunk ───────────────────────────────────────
        current_pg = await get_latest_chunk(conversation_id)

        if current_pg is None:
            # First exchange in this conversation — create a fresh chunk
            extracted = await _summarize_turns([user_rec, asst_rec])
            stored    = await _build_stored_chunk(
                extracted, conversation_id,
                turn_start=user_turn_idx,
                turn_end=assistant_turn_idx,
                timestamp_start_ms=now_ms,
                timestamp_end_ms=now_ms,
            )
            await qdrant_upsert_chunk(stored)
            await upsert_topic_chunk(_chunk_record_from_stored(stored, now))
            logger.debug(f"[topic_chunk] Created '{stored.payload.topic_label}' for {conversation_id}")
            return

        # ── 5. Check topic drift ─────────────────────────────────────────
        chunk_point = await get_topic_chunk_point(current_pg.chunk_id)

        if chunk_point is not None and chunk_point.vector:
            similarity = _cosine_similarity(query_vector, chunk_point.vector)
        else:
            similarity = 1.0  # can't compare → conservatively assume same topic
        logger.debug(f"[topic_chunk] Similarity to current chunk: {similarity:.3f}")

        if similarity >= TOPIC_DRIFT_THRESHOLD:
            # ── 6a. Same topic — extend the chunk ────────────────────────
            all_turns = await get_messages_in_range(
                conversation_id,
                current_pg.turn_start,
                assistant_turn_idx,
            )
            extracted  = await _summarize_turns(all_turns)
            new_vector = await get_embedding(extracted.summary)

            await update_topic_chunk(
                chunk_id=current_pg.chunk_id,
                new_vector=new_vector,
                updates={
                    "topic_label":   extracted.topic_label,
                    "summary":       extracted.summary,
                    "turn_end":      assistant_turn_idx,
                    "timestamp_end": now_ms,
                },
            )

        else:
            # ── 6b. Topic drift — start a new chunk ──────────────────────
            extracted = await _summarize_turns([user_rec, asst_rec])
            stored    = await _build_stored_chunk(
                extracted, conversation_id,
                turn_start=user_turn_idx,
                turn_end=assistant_turn_idx,
                timestamp_start_ms=now_ms,
                timestamp_end_ms=now_ms,
            )
            await qdrant_upsert_chunk(stored)
            await upsert_topic_chunk(_chunk_record_from_stored(stored, now))
            logger.debug(
                f"[topic_chunk] Drift detected — new chunk '{stored.payload.topic_label}' "
                f"for {conversation_id}"
            )

    except Exception as e:
        logger.error(f"process_turn_post_response failed: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------

async def format_topic_chunks_for_prompt(
    chunks: list[StoredTopicChunk],
) -> str:
    """
    Format retrieved topic chunks for injection into the system prompt.
    For each chunk, includes the summary always and the verbatim turns
    if exact_turns_available is True.

    Example output:
        ## Relevant past conversations

        ### Career change discussion (3 weeks ago)
        You discussed your interest in transitioning from finance to software engineering.
        Exact exchange:
          You: I've been thinking about switching careers...
          Valac: That's a significant decision. What's drawing you toward software?
    """
    if not chunks:
        return ""

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    lines  = ["## Relevant past conversations"]

    for chunk in chunks:
        p        = chunk.payload
        age_ms   = now_ms - p.timestamp_end
        age_days = age_ms / (1000 * 60 * 60 * 24)

        if age_days < 1:
            when = "today"
        elif age_days < 2:
            when = "yesterday"
        elif age_days < 14:
            when = f"{int(age_days)} days ago"
        elif age_days < 60:
            when = f"{int(age_days / 7)} weeks ago"
        else:
            when = f"{int(age_days / 30)} months ago"

        lines.append(f"\n### {p.topic_label} ({when})")
        lines.append(p.summary)

        if p.exact_turns_available:
            try:
                turns = await get_messages_in_range(
                    p.conversation_id, p.turn_start, p.turn_end
                )
                if turns:
                    lines.append("Exact exchange:")
                    for t in turns:
                        prefix = "You" if t.role == "user" else "Valac"
                        lines.append(f"  {prefix}: {t.content}")
            except Exception as e:
                logger.warning(f"Could not fetch turns for chunk {p.chunk_id}: {e}")

    return "\n".join(lines)
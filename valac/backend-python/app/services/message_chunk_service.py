"""
Message chunk pipeline for Valac.

Two-stage LLM chunking strategy:
  Stage 1 — Segment: LLM classifies content type and identifies semantic
             boundaries, returning a list of labeled segments.
  Stage 2 — Store: each segment is embedded and upserted to Qdrant.
             A hard-split safety net handles pathologically long segments.

Content types:
  conversational  — split at topic-drift boundaries
  structured_text — split at logical unit boundaries (functions, sections, etc.)
  mixed           — structured and conversational regions handled separately
"""

import json
import logging
import re
import uuid

from app.services.embedding_service import get_embedding
from app.services.ollama_service import complete
from app.services.qdrant_service import upsert_message_chunk

logger = logging.getLogger(__name__)

# nomic-embed-text supports 8192 tokens (~32k chars). This is a conservative
# safety ceiling — the LLM should never produce segments this large, but if
# something slips through we hard-split rather than silently truncate.
MAX_CHUNK_CHARS = 6000

_SEGMENT_SYSTEM = """\
You are a text segmentation assistant. Given a piece of text, divide it into \
semantically coherent segments and return a JSON object with exactly two keys:

  "content_type": one of "conversational", "structured_text", or "mixed"
  "segments": an array of objects, each with:
      "text":        the verbatim text of this segment
      "type":        "conversational" or "structured_text"
      "topic_hint":  a short phrase (5 words or fewer) naming the topic

Segmentation rules:
- conversational  : group sentences that share a topic. Split when the subject \
changes. Each segment should cover one coherent idea or question thread.
- structured_text : split at logical unit boundaries — functions, classes, \
config blocks, recipe steps, article sections, numbered lists, etc.
- mixed           : first separate structured regions from conversational ones, \
then apply the rules above to each region independently.

Return only valid JSON. No markdown fences. No explanation.\
"""


async def _segment(text: str) -> list[dict]:
    """
    Stage 1: ask the LLM to classify and semantically segment the text.
    Falls back to a single chunk on parse failure.
    """
    raw = await complete(
        f"Segment this text:\n\n{text}",
        system_prompt=_SEGMENT_SYSTEM,
    )

    try:
        data     = json.loads(raw)
        segments = data.get("segments", [])
        if segments:
            return segments
    except Exception:
        pass

    logger.warning("Segmentation JSON parse failed — falling back to single chunk")
    return [{"text": text, "type": "conversational", "topic_hint": "general"}]


def _hard_split(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """
    Safety net: split a segment that still exceeds max_chars.
    Tries sentence boundaries first; falls back to hard character slicing.
    """
    if len(text) <= max_chars:
        return [text]

    sentences = re.split(r'(?<=[.!?])\s+', text)
    chunks, current = [], ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current += (" " if current else "") + sentence
        else:
            if current:
                chunks.append(current)
            if len(sentence) > max_chars:
                # single sentence is itself too long — slice it
                for i in range(0, len(sentence), max_chars):
                    chunks.append(sentence[i : i + max_chars])
                current = ""
            else:
                current = sentence

    if current:
        chunks.append(current)

    return chunks


async def store_message_chunks(
    message_id: str,
    conversation_id: str,
    text: str,
) -> None:
    """
    Segment text semantically via LLM, then embed and upsert each chunk.
    Runs as a fire-and-forget background task — errors are logged, not raised.
    """
    if not text.strip():
        return

    try:
        # ── Stage 1: semantic segmentation ───────────────────────────────
        segments = await _segment(text)

        # ── Stage 2: embed + store ────────────────────────────────────────
        chunk_index = 0
        for segment in segments:
            seg_text = segment.get("text", "").strip()
            if not seg_text:
                continue

            for sub in _hard_split(seg_text):
                vector = await get_embedding(sub)
                await upsert_message_chunk({
                    "id": str(uuid.uuid4()),
                    "vector": vector,
                    "payload": {
                        "message_id":      message_id,
                        "conversation_id": conversation_id,
                        "chunk_index":     chunk_index,
                        "text":            sub,
                        "type":            segment.get("type", "conversational"),
                        "topic_hint":      segment.get("topic_hint", ""),
                    },
                })
                chunk_index += 1

    except Exception as e:
        logger.error(f"store_message_chunks failed: {e}", exc_info=True)
"""
Memory models for the AI memory system.

Design notes:
- StoredMemory mirrors Qdrant's point structure (id / vector / payload).
- MemoryPayload is the payload stored alongside each vector.
- MemorySearchResult wraps Qdrant's scored point for re-ranking.
- ExtractedMemory is the intermediate shape produced by the LLM extraction
  step — before embedding, before persistence.

Topic-chunk architecture (Qdrant + Postgres):
- TopicChunkPayload / StoredTopicChunk mirror the `topic_chunks` Qdrant collection.
- ConversationRecord / MessageRecord / TopicChunkRecord are Pydantic shapes for
  the three Postgres tables; used for serialization and API layer validation.
  (SQL DDL lives in migrations/.)
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class Sentiment(str, Enum):
    positive = "positive"
    negative = "negative"
    neutral   = "neutral"

# ---------------------------------------------------------------------------
# Core payload — what sits inside each Qdrant point
# ---------------------------------------------------------------------------

class MemoryPayload(BaseModel):
    # ── Identity ──────────────────────────────────────────────────────────
    user_id: str
    conversation_id: str              # Groups memories from the same session;
                                      # used for filtering, not graph traversal

    # ── Time ──────────────────────────────────────────────────────────────
    created_at: int = Field(          # Unix ms — set once, never changed
        default_factory=lambda: int(time.time() * 1000)
    )
    last_accessed_at: int = Field(    # Unix ms — updated on every retrieval
        default_factory=lambda: int(time.time() * 1000)
    )

    # ── Content ───────────────────────────────────────────────────────────
    title: str                        # Short human-readable label (LLM-generated)
    summary: str                      # What gets injected into the system prompt

    # ── Retrieval signals ─────────────────────────────────────────────────
    tags: list[str] = Field(          # Normalized lowercase; keyword-indexed in Qdrant
        default_factory=list
    )
    importance: float = Field(        # 0.0–1.0; part of composite retrieval score
        default=0.5,
        ge=0.0,
        le=1.0,
    )
    access_count: int = Field(        # Incremented each retrieval; feeds importance decay
        default=0,
        ge=0,
    )

    # ── Summarization ─────────────────────────────────────────────────────
    is_summary: bool = False          # True when this memory replaced several older ones
    replaces_ids: list[str] = Field(  # IDs of the memories this summary collapsed
        default_factory=list
    )

    # ── Viewer / management ───────────────────────────────────────────────
    sentiment: Optional[Sentiment] = None
    is_locked: bool = False           # User-pinned; skipped by summarization + auto-delete

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, v: list[str]) -> list[str]:
        return [tag.lower().strip() for tag in v]

    @field_validator("importance", mode="before")
    @classmethod
    def clamp_importance(cls, v: float) -> float:
        return max(0.0, min(1.0, float(v)))


# ---------------------------------------------------------------------------
# Full Qdrant point — what you upsert / receive back
# ---------------------------------------------------------------------------

class StoredMemory(BaseModel):
    """Mirrors Qdrant's point structure: id / vector / payload."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    vector: list[float]
    payload: MemoryPayload

    def to_qdrant_point(self) -> dict:
        """Serialize to the dict shape expected by qdrant_client.models.PointStruct."""
        return {
            "id":      self.id,
            "vector":  self.vector,
            "payload": self.payload.model_dump(),
        }


# ---------------------------------------------------------------------------
# Intermediate shape produced by the LLM extraction step
# (before embedding, before upsert)
# ---------------------------------------------------------------------------

class ExtractedMemory(BaseModel):
    """
    What your extraction prompt asks the LLM to return as JSON.
    Cast to StoredMemory once you have the embedding vector.
    """
    title: str
    summary: str
    tags: list[str]
    importance: float = Field(ge=0.0, le=1.0)
    sentiment: Optional[Sentiment] = None

    def to_payload(
        self,
        user_id: str,
        conversation_id: str,
    ) -> MemoryPayload:
        return MemoryPayload(
            user_id=user_id,
            conversation_id=conversation_id,
            title=self.title,
            summary=self.summary,
            tags=self.tags,
            importance=self.importance,
            sentiment=self.sentiment,
        )


# ---------------------------------------------------------------------------
# Search result — Qdrant candidate + composite re-ranking score
# ---------------------------------------------------------------------------

class MemorySearchResult(BaseModel):
    """
    Wraps one Qdrant result during the re-ranking step.

    Composite score formula (tune weights to taste):
        score = (similarity * 0.5) + (recency * 0.3) + (importance * 0.2)
    """

    memory: StoredMemory
    similarity: float = Field(ge=-1.0, le=1.0)   # Raw cosine score from Qdrant
    composite_score: float = 0.0                 # Set by re_rank()

    @classmethod
    def from_qdrant_hit(cls, hit) -> "MemorySearchResult":
        """
        Construct from a qdrant_client ScoredPoint.
        Usage:
            hits = qdrant.search(...)
            results = [MemorySearchResult.from_qdrant_hit(h) for h in hits]
        """
        payload = MemoryPayload(**hit.payload)
        memory  = StoredMemory(id=str(hit.id), vector=[], payload=payload)
        return cls(memory=memory, similarity=hit.score)

    def recency_weight(self, now_ms: Optional[int] = None) -> float:
        """
        Exponential decay over ~90 days.
        Returns 1.0 for brand-new memories, approaches 0.0 after ~6 months.
        """
        now    = now_ms or int(time.time() * 1000)
        age_ms = now - self.memory.payload.last_accessed_at
        age_days = age_ms / (1000 * 60 * 60 * 24)
        half_life_days = 90
        return 0.5 ** (age_days / half_life_days)


def re_rank(
    results: list[MemorySearchResult],
    top_n: int = 6,
    w_similarity: float = 0.5,
    w_recency:    float = 0.3,
    w_importance: float = 0.2,
) -> list[MemorySearchResult]:
    """
    Apply composite scoring and return the top_n memories.

    Call this on the raw Qdrant candidates before injecting into the prompt.
    """
    now = int(time.time() * 1000)
    for r in results:
        r.composite_score = (
            r.similarity                          * w_similarity
            + r.recency_weight(now)               * w_recency
            + r.memory.payload.importance         * w_importance
        )
    ranked = sorted(results, key=lambda r: r.composite_score, reverse=True)
    return ranked[:top_n]


# ---------------------------------------------------------------------------
# Prompt injection helper
# ---------------------------------------------------------------------------

def format_memories_for_prompt(memories: list[MemorySearchResult]) -> str:
    """
    Converts ranked memories into the text block injected into the system prompt.

    Example output:
        ## Relevant memories
        - [3 weeks ago] You discussed barre chords and hand positioning. (guitar, music)
        - [2 days ago]  You asked about the circle of fifths. (music theory)
    """
    if not memories:
        return ""

    now_ms   = int(time.time() * 1000)
    lines    = ["## Relevant memories"]

    for r in memories:
        payload  = r.memory.payload
        age_ms   = now_ms - payload.last_accessed_at
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

        tag_str = ", ".join(payload.tags[:4]) if payload.tags else ""
        tag_part = f" ({tag_str})" if tag_str else ""
        lines.append(f"- [{when}] {payload.summary}{tag_part}")

    return "\n".join(lines)


# ===========================================================================
# Topic-chunk architecture
# ===========================================================================
#
# Separate from the per-fact MemoryPayload system above. Topic chunks are
# coarser-grained: one chunk covers a contiguous window of conversation turns
# that share a topic. Qdrant holds the vector + summary; Postgres holds the
# exact turns. The two sides are linked by chunk_id and conversation_id.
# ===========================================================================

# ---------------------------------------------------------------------------
# Qdrant — topic_chunks collection
# ---------------------------------------------------------------------------

class TopicChunkPayload(BaseModel):
    """
    Payload stored alongside each vector in the `topic_chunks` Qdrant collection.
    The vector is the embedding of `summary`.

    Payload indexes to create in Qdrant:
        chunk_id              — keyword
        conversation_id       — keyword
        topic_label           — keyword
        timestamp_start       — datetime (integer unix ms)
        exact_turns_available — bool
    """

    # ── Identity ──────────────────────────────────────────────────────────
    chunk_id: str = Field(            # UUID — shared with Postgres topic_chunks table
        default_factory=lambda: str(uuid.uuid4())
    )
    conversation_id: str              # UUID — links to Postgres conversations table

    # ── Content ───────────────────────────────────────────────────────────
    topic_label: str                  # Short LLM-generated label, e.g. "career change discussion"
    summary: str                      # LLM-generated; injected into prompt at retrieval time

    # ── Turn range ────────────────────────────────────────────────────────
    turn_start: int                   # Inclusive; matches turn_index in Postgres messages
    turn_end: int                     # Inclusive

    # ── Time ──────────────────────────────────────────────────────────────
    timestamp_start: int              # Unix ms — wall time of first turn in chunk
    timestamp_end: int                # Unix ms — wall time of last turn in chunk

    # ── Retrieval signals ─────────────────────────────────────────────────
    recall_count: int = Field(        # Incremented each time this chunk is retrieved
        default=0,
        ge=0,
    )
    last_accessed: Optional[int] = None  # Unix ms; None until first recall

    # ── Retention ─────────────────────────────────────────────────────────
    exact_turns_available: bool = True   # Set to False once Postgres turns are trimmed


class StoredTopicChunk(BaseModel):
    """
    Full Qdrant point for the `topic_chunks` collection.
    Mirrors StoredMemory's role for the per-fact collection.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    vector: list[float]               # 384-dim embedding of payload.summary
    payload: TopicChunkPayload

    def to_qdrant_point(self) -> dict:
        """Serialize to the dict shape expected by qdrant_client.models.PointStruct."""
        return {
            "id":      self.id,
            "vector":  self.vector,
            "payload": self.payload.model_dump(),
        }

    @classmethod
    def from_qdrant_hit(cls, hit) -> "StoredTopicChunk":
        payload = TopicChunkPayload(**hit.payload)
        return cls(id=str(hit.id), vector=[], payload=payload)


# ---------------------------------------------------------------------------
# Intermediate shape produced by the LLM chunking step
# (before embedding, before upsert — analogous to ExtractedMemory)
# ---------------------------------------------------------------------------

class ExtractedTopicChunk(BaseModel):
    """
    What the topic-chunking prompt asks the LLM to return as JSON.
    Cast to StoredTopicChunk once you have the embedding vector and turn metadata.
    """
    topic_label: str
    summary: str

    def to_payload(
        self,
        conversation_id: str,
        turn_start: int,
        turn_end: int,
        timestamp_start: int,
        timestamp_end: int,
    ) -> TopicChunkPayload:
        return TopicChunkPayload(
            conversation_id=conversation_id,
            topic_label=self.topic_label,
            summary=self.summary,
            turn_start=turn_start,
            turn_end=turn_end,
            timestamp_start=timestamp_start,
            timestamp_end=timestamp_end,
        )


# ---------------------------------------------------------------------------
# Postgres row models
# (Pydantic shapes for the API/service layer — DDL lives in migrations/)
# ---------------------------------------------------------------------------

class ConversationRecord(BaseModel):
    """Mirrors the `conversations` Postgres table."""

    conversation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    title: Optional[str] = None
    archived_at: Optional[datetime] = None

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None


class MessageRecord(BaseModel):
    """
    Mirrors one row in the `messages` Postgres table.
    turn_index is 0-based and unique within a conversation_id.
    """

    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    turn_index: int = Field(ge=0)
    role: str = Field(pattern=r"^(user|assistant|system)$")
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TopicChunkRecord(BaseModel):
    """
    Mirrors the `topic_chunks` Postgres table.
    Acts as the referential anchor between Qdrant payloads and Postgres messages.
    chunk_id matches the chunk_id in TopicChunkPayload (and StoredTopicChunk.id).
    """

    chunk_id: str                     # FK into Qdrant — not a DB-generated value
    conversation_id: str              # FK → conversations.conversation_id
    topic_label: str
    turn_start: int = Field(ge=0)
    turn_end: int = Field(ge=0)
    timestamp_start: datetime
    timestamp_end: datetime
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    exact_turns_available: bool = True

    def turn_range(self) -> range:
        """Inclusive range of turn_index values covered by this chunk."""
        return range(self.turn_start, self.turn_end + 1)
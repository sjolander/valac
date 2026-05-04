"""
Postgres persistence layer for Valac.

Manages three tables:
  conversations  — top-level session records
  messages       — verbatim user/assistant turns
  topic_chunks   — referential anchor between Qdrant topic vectors and Postgres messages

Uses asyncpg directly (no ORM). All IDs are stored as TEXT to avoid UUID conversion
friction with asyncpg; the application layer uses string UUIDs throughout.
"""

import logging
import os
import uuid
import math
from datetime import datetime, timezone

import asyncpg

from app.models import MessageRecord, TopicChunkRecord

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://valac:valac@localhost:5432/valac")

_pool: asyncpg.Pool | None = None


# ---------------------------------------------------------------------------
# Pool management
# ---------------------------------------------------------------------------

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


# ---------------------------------------------------------------------------
# Schema init — call once at startup
# ---------------------------------------------------------------------------

async def init_db() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                conversation_id TEXT PRIMARY KEY,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                title           TEXT,
                archived_at     TIMESTAMPTZ DEFAULT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id      TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL
                    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                turn_index      INTEGER NOT NULL,
                role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                content         TEXT NOT NULL,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (conversation_id, turn_index)
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
                ON messages(conversation_id)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_turn_index
                ON messages(conversation_id, turn_index)
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS topic_chunks (
                chunk_id              TEXT PRIMARY KEY,
                conversation_id       TEXT NOT NULL
                    REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                topic_label           TEXT NOT NULL,
                turn_start            INTEGER NOT NULL,
                turn_end              INTEGER NOT NULL,
                timestamp_start       TIMESTAMPTZ NOT NULL,
                timestamp_end         TIMESTAMPTZ NOT NULL,
                created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
                exact_turns_available BOOLEAN NOT NULL DEFAULT TRUE
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_topic_chunks_conversation_id
                ON topic_chunks(conversation_id)
        """)
    logger.info("Postgres tables initialized")

async def wipe_postgres():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("TRUNCATE TABLE messages CASCADE")
        await conn.execute("TRUNCATE TABLE topic_chunks CASCADE")
        await conn.execute("TRUNCATE TABLE conversations CASCADE")

# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

async def ensure_conversation(conversation_id: str) -> None:
    """
    Insert the conversation row if it doesn't exist; bump updated_at if it does.
    Call at the start of every post-response background task.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO conversations (conversation_id)
            VALUES ($1)
            ON CONFLICT (conversation_id) DO UPDATE SET updated_at = now()
        """, conversation_id)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

async def get_next_turn_index(conversation_id: str, conn: asyncpg.Connection) -> int:
    """
    Return the next available 0-based turn_index for this conversation.
    Must be called within an open connection to avoid TOCTOU races.
    """
    result = await conn.fetchval("""
        SELECT COALESCE(MAX(turn_index) + 1, 0)
        FROM messages
        WHERE conversation_id = $1
    """, conversation_id)
    return result


async def store_messages(user_record: MessageRecord, assistant_record: MessageRecord) -> None:
    """Atomically insert a user + assistant turn pair."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            for record in (user_record, assistant_record):
                await conn.execute("""
                    INSERT INTO messages
                        (message_id, conversation_id, turn_index, role, content, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (conversation_id, turn_index) DO UPDATE SET
                        content = EXCLUDED.content
                """,
                    record.message_id,
                    record.conversation_id,
                    record.turn_index,
                    record.role,
                    record.content,
                    record.created_at,
                )


async def get_messages_in_range(
    conversation_id: str,
    turn_start: int,
    turn_end: int,
) -> list[MessageRecord]:
    """Fetch verbatim turns covering [turn_start, turn_end] inclusive."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT message_id, conversation_id, turn_index, role, content, created_at
            FROM messages
            WHERE conversation_id = $1
              AND turn_index BETWEEN $2 AND $3
            ORDER BY turn_index ASC
        """, conversation_id, turn_start, turn_end)
    return [
        MessageRecord(
            message_id=row["message_id"],
            conversation_id=row["conversation_id"],
            turn_index=row["turn_index"],
            role=row["role"],
            content=row["content"],
            created_at=row["created_at"],
        )
        for row in rows
    ]


# ---------------------------------------------------------------------------
# Topic chunks
# ---------------------------------------------------------------------------

async def get_latest_chunk(conversation_id: str) -> TopicChunkRecord | None:
    """Return the most recent topic chunk for a conversation, or None."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT chunk_id, conversation_id, topic_label,
                   turn_start, turn_end,
                   timestamp_start, timestamp_end, created_at,
                   exact_turns_available
            FROM topic_chunks
            WHERE conversation_id = $1
            ORDER BY turn_end DESC
            LIMIT 1
        """, conversation_id)
    if row is None:
        return None
    return TopicChunkRecord(
        chunk_id=row["chunk_id"],
        conversation_id=row["conversation_id"],
        topic_label=row["topic_label"],
        turn_start=row["turn_start"],
        turn_end=row["turn_end"],
        timestamp_start=row["timestamp_start"],
        timestamp_end=row["timestamp_end"],
        created_at=row["created_at"],
        exact_turns_available=row["exact_turns_available"],
    )


async def upsert_topic_chunk(record: TopicChunkRecord) -> None:
    """
    Insert or update a topic chunk row.
    On conflict (same chunk_id), updates the mutable fields only —
    turn_start and created_at are never overwritten.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO topic_chunks
                (chunk_id, conversation_id, topic_label,
                 turn_start, turn_end,
                 timestamp_start, timestamp_end,
                 exact_turns_available)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (chunk_id) DO UPDATE SET
                topic_label           = EXCLUDED.topic_label,
                turn_end              = EXCLUDED.turn_end,
                timestamp_end         = EXCLUDED.timestamp_end,
                exact_turns_available = EXCLUDED.exact_turns_available
        """,
            record.chunk_id,
            record.conversation_id,
            record.topic_label,
            record.turn_start,
            record.turn_end,
            record.timestamp_start,
            record.timestamp_end,
            record.exact_turns_available,
        )

async def set_conversation_title(conversation_id: str, title: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            UPDATE conversations SET title = $1, updated_at = now()
            WHERE conversation_id = $2
        """, title, conversation_id)
 
 
async def get_conversations(limit: int = 50) -> list[dict]:
    """
    Return conversations ordered by most recent activity, with a preview
    derived from the last user message in that conversation.
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                c.conversation_id,
                c.title,
                c.updated_at,
                m.content AS preview
            FROM conversations c
            LEFT JOIN LATERAL (
                SELECT content
                FROM messages
                WHERE conversation_id = c.conversation_id
                  AND role = 'user'
                ORDER BY turn_index DESC
                LIMIT 1
            ) m ON true
            WHERE c.archived_at IS NULL
            ORDER BY c.updated_at DESC
            LIMIT $1
        """, limit)
    return [dict(r) for r in rows]
 
 
async def get_messages_for_conversation(conversation_id: str) -> list[dict]:
    """Return all messages for a conversation ordered by turn_index."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT message_id, role, content, turn_index, created_at
            FROM messages
            WHERE conversation_id = $1
            ORDER BY turn_index ASC
        """, conversation_id)
    return [dict(r) for r in rows]

async def get_all_topics(limit: int = 100) -> list[dict]:
    """
    Return all topic chunks with co-occurrence-based connections and
    recency-based relevance scores, ordered most recent first.
 
    Each row:
        id          — chunk_id
        label       — topic_label
        connections — list of other topic_labels sharing the same conversation
        relevance   — float 0.0–1.0 based on 90-day exponential decay
        timestamp   — timestamp_end for display
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT
                t1.chunk_id                                                  AS id,
                t1.topic_label                                               AS label,
                t1.timestamp_end                                             AS timestamp_end,
                COALESCE(
                    array_agg(DISTINCT t2.topic_label)
                    FILTER (WHERE t2.topic_label IS NOT NULL
                              AND t2.topic_label <> t1.topic_label),
                    ARRAY[]::TEXT[]
                )                                                            AS connections
            FROM topic_chunks t1
            LEFT JOIN topic_chunks t2
                ON  t2.conversation_id = t1.conversation_id
                AND t2.chunk_id       <> t1.chunk_id
            WHERE t1.exact_turns_available = TRUE
               OR t1.exact_turns_available = FALSE   -- include all; filter trimmed later if needed
            GROUP BY t1.chunk_id, t1.topic_label, t1.timestamp_end
            ORDER BY t1.timestamp_end DESC
            LIMIT $1
        """, limit)
 
    now = datetime.now(timezone.utc)
    result = []
    for row in rows:
        ts: datetime = row["timestamp_end"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_days  = (now - ts).total_seconds() / 86400
        relevance = math.pow(0.5, age_days / 90)          # half-life 90 days, matches backend
        result.append({
            "id":          row["id"],
            "label":       row["label"],
            "connections": list(row["connections"]),
            "relevance":   round(min(1.0, max(0.05, relevance)), 3),
            "timestamp":   ts.isoformat(),
        })
    return result
 
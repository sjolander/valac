from datetime import datetime, timezone
import logging
import math
import os

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PayloadSchemaType,
    PointStruct,
    VectorParams,
)

from app.models import ExtractedMemory, MemorySearchResult, StoredMemory, StoredTopicChunk, TopicChunkPayload
from app.services.embedding_service import EMBEDDING_DIM

logger = logging.getLogger(__name__)

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", "6333"))
COLLECTION   = "memories"
TOPIC_CHUNKS_COLLECTION = "topic_chunks"
MESSAGE_CHUNKS_COLLECTION = "message_chunks"

_client: AsyncQdrantClient | None = None


def get_client() -> AsyncQdrantClient:
    global _client
    if _client is None:
        _client = AsyncQdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    return _client

async def wipe_qdrant():
    client = get_client()
    collections = await client.get_collections()

    for c in collections.collections:
        await client.delete_collection(c.name)

async def init_collection() -> None:
    """
    Create the collection and payload indexes if they don't exist yet.
    Call once at startup.
    """
    client = get_client()
    existing = await client.get_collections()
    names = [c.name for c in existing.collections]

    if COLLECTION not in names:
        await client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info(f"Created Qdrant collection '{COLLECTION}'")

        # Payload indexes — required for fast filtering in the viewer and retrieval
        await client.create_payload_index(COLLECTION, "user_id",    PayloadSchemaType.KEYWORD)
        await client.create_payload_index(COLLECTION, "tags",       PayloadSchemaType.KEYWORD)
        await client.create_payload_index(COLLECTION, "created_at", PayloadSchemaType.INTEGER)
        logger.info("Created payload indexes")
    else:
        logger.info(f"Qdrant collection '{COLLECTION}' already exists")

async def init_message_chunks_collection():
    client = get_client()
    existing = await client.get_collections()
    names    = [c.name for c in existing.collections]

    if MESSAGE_CHUNKS_COLLECTION not in names:
        await client.recreate_collection(
            collection_name="message_chunks",
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info(f"Created Qdrant collection '{MESSAGE_CHUNKS_COLLECTION}")

async def init_topic_chunks_collection() -> None:
    """
    Create the topic_chunks collection and its payload indexes if absent.
    """
    client = get_client()
    existing = await client.get_collections()
    names    = [c.name for c in existing.collections]
 
    if TOPIC_CHUNKS_COLLECTION not in names:
        await client.create_collection(
            collection_name=TOPIC_CHUNKS_COLLECTION,
            vectors_config=VectorParams(size=EMBEDDING_DIM, distance=Distance.COSINE),
        )
        logger.info(f"Created Qdrant collection '{TOPIC_CHUNKS_COLLECTION}'")
 
        for field, schema in [
            ("chunk_id",              PayloadSchemaType.KEYWORD),
            ("conversation_id",       PayloadSchemaType.KEYWORD),
            ("topic_label",           PayloadSchemaType.KEYWORD),
            ("timestamp_start",       PayloadSchemaType.INTEGER),
            ("exact_turns_available", PayloadSchemaType.BOOL),       # needs Qdrant ≥1.9
        ]:
            await client.create_payload_index(
                TOPIC_CHUNKS_COLLECTION, field, schema
            )
        logger.info(f"Created payload indexes on '{TOPIC_CHUNKS_COLLECTION}'")
    else:
        logger.info(f"Qdrant collection '{TOPIC_CHUNKS_COLLECTION}' already exists")

async def upsert_message_chunk(point: dict):
    client = get_client()
    await client.upsert(
        collection_name="message_chunks",
        points=[point]
    )

async def search_message_chunks(vector: list[float], limit: int = 5):
    client = get_client()
    results = await client.query_points(
        collection_name="message_chunks",
        query=vector,
        limit=limit,
        with_payload=True
    )
    for point in results.points:
        if not isinstance(point.payload, dict):
            point.payload = dict(point.payload)
    return results.points

async def update_topic_chunk(
    chunk_id: str,
    new_vector: list[float],
    updates: dict,
) -> None:
    """
    Fetch an existing topic chunk, merge `updates` into its payload,
    and re-upsert with the new vector. Preserves fields like recall_count
    and last_accessed that the caller doesn't own.
    """
    client  = get_client()
    results = await client.retrieve(
        collection_name=TOPIC_CHUNKS_COLLECTION,
        ids=[chunk_id],
        with_payload=True,
        with_vectors=False,
    )
    if not results:
        logger.warning(f"update_topic_chunk: chunk {chunk_id} not found")
        return

    merged = {**dict(results[0].payload), **updates}
    await client.upsert(
        collection_name=TOPIC_CHUNKS_COLLECTION,
        points=[PointStruct(id=chunk_id, vector=new_vector, payload=merged)],
    )
    logger.debug(f"Updated topic chunk {chunk_id}: {updates.get('topic_label', '')}")

async def upsert_memory(memory: StoredMemory) -> None:
    client = get_client()
    point  = memory.to_qdrant_point()
    await client.upsert(
        collection_name=COLLECTION,
        points=[PointStruct(**point)],
    )
    logger.debug(f"Upserted memory {memory.id}: {memory.payload.title}")


async def search_memories(
    query_vector: list[float],
    user_id: str,
    limit: int = 20,
) -> list[MemorySearchResult]:
    """
    Vector search filtered to a specific user.
    Returns up to `limit` candidates for re-ranking.
    """
    client = get_client()
    results = await client.query_points(
        collection_name=COLLECTION,
        query=query_vector,
        query_filter=Filter(
            must=[FieldCondition(key="user_id", match=MatchValue(value=user_id))]
        ),
        limit=limit,
        score_threshold=0.55,
        with_payload=True,
    )
    return [MemorySearchResult.from_qdrant_hit(h) for h in results.points]

async def upsert_topic_chunk(chunk: StoredTopicChunk) -> None:
    client = get_client()
    point  = chunk.to_qdrant_point()
    await client.upsert(
        collection_name=TOPIC_CHUNKS_COLLECTION,
        points=[PointStruct(**point)],
    )
    logger.debug(f"Upserted topic chunk {chunk.id}: '{chunk.payload.topic_label}'")
 
 
async def search_topic_chunks(
    query_vector: list[float],
    exclude_conversation_id: str | None = None,
    limit: int = 5,
) -> list[StoredTopicChunk]:
    """
    ANN search against the topic_chunks collection.
    Optionally excludes the current conversation (its turns are already in history).
    Returns StoredTopicChunk objects with vector=[] (vectors not needed post-retrieval).
    """
    client = get_client()
 
    must_not = []
    if exclude_conversation_id:
        must_not.append(
            FieldCondition(
                key="conversation_id",
                match=MatchValue(value=exclude_conversation_id),
            )
        )
 
    query_filter = Filter(must_not=must_not) if must_not else None
 
    results = await client.query_points(
        collection_name=TOPIC_CHUNKS_COLLECTION,
        query=query_vector,
        query_filter=query_filter,
        limit=limit,
        score_threshold=0.60,
        with_payload=True,
    )
    chunks = []
    for hit in results.points:
        payload = TopicChunkPayload(**hit.payload)
        chunks.append(StoredTopicChunk(id=str(hit.id), vector=[], payload=payload))
    return chunks
 
 
class _ChunkPoint:
    """Lightweight container returned by get_topic_chunk_point."""
    def __init__(self, vector: list[float], payload: dict):
        self.vector  = vector
        self.payload = payload
 
 
async def get_topic_chunk_point(chunk_id: str) -> _ChunkPoint | None:
    """
    Fetch a single topic chunk by ID, returning both its vector and raw payload dict.
    Used by topic_chunk_service to check similarity and merge payload on update.
    """
    client  = get_client()
    results = await client.retrieve(
        collection_name=TOPIC_CHUNKS_COLLECTION,
        ids=[chunk_id],
        with_payload=True,
        with_vectors=True,
    )
    if not results:
        return None
    point = results[0]
    return _ChunkPoint(
        vector=list(point.vector) if point.vector else [],
        payload=dict(point.payload) if point.payload else {},
    )

async def get_all_tags(limit: int = 1000) -> list[dict]:
    """
    Scroll all memories from Qdrant, build a tag co-occurrence graph.
    Returns nodes (unique tags) and connections (co-occurring tags).
    """
    client = get_client()
    now = datetime.now(timezone.utc)

    # Scroll all memory points
    points = []
    next_offset = None
    while True:
        result, next_offset = await client.scroll(
            collection_name=COLLECTION,
            offset=next_offset,
            limit=100,
            with_payload=True,
            with_vectors=False,
        )
        points.extend(result)
        logger.debug(f"[get_all_tags] scroll batch: {len(result)} points, next_offset={next_offset}")
        if next_offset is None:
            break

    logger.debug(f"[get_all_tags] total points scrolled: {len(points)}")

    # Build per-tag metadata: latest timestamp, set of co-occurring tags
    tag_latest:  dict[str, datetime] = {}
    tag_cooccur: dict[str, set[str]] = {}

    for point in points:
        payload = dict(point.payload or {})
        tags = payload.get("tags", [])
        logger.debug(f"[get_all_tags] point {point.id}: tags={tags}")
        if not tags:
            continue

        # Parse timestamp
        raw_ts = payload.get("created_at")
        try:
            ts = datetime.fromtimestamp(raw_ts / 1000, tz=timezone.utc) if isinstance(raw_ts, (int, float)) else datetime.fromisoformat(raw_ts).replace(tzinfo=timezone.utc)
        except Exception:
            ts = now

        for tag in tags:
            tag = tag.lower().strip()
            if not tag:
                continue
            # Track most recent memory for this tag
            if tag not in tag_latest or ts > tag_latest[tag]:
                tag_latest[tag] = ts
            # Track co-occurring tags
            if tag not in tag_cooccur:
                tag_cooccur[tag] = set()
            for other in tags:
                other = other.lower().strip()
                if other and other != tag:
                    tag_cooccur[tag].add(other)

    # Build result
    result = []
    for tag, latest_ts in tag_latest.items():
        age_days  = (now - latest_ts).total_seconds() / 86400
        relevance = math.pow(0.5, age_days / 90)
        result.append({
            "id":          tag,
            "label":       tag,
            "connections": list(tag_cooccur.get(tag, set())),
            "relevance":   round(min(1.0, max(0.05, relevance)), 3),
            "timestamp":   latest_ts.isoformat(),
        })

    # Most recent first
    result.sort(key=lambda x: x["timestamp"], reverse=True)
    return result[:limit]
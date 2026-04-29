import logging
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

_client: AsyncQdrantClient | None = None


def get_client() -> AsyncQdrantClient:
    global _client
    if _client is None:
        _client = AsyncQdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    return _client


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
import asyncio
import logging
import time
import uuid
import httpx
import os
import re
import json

OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from app.services.search_service import search, format_search_results
from app.services.search_gate_service import should_search

from app.models import (
    AskRequest,
    ExtractedMemory,
    StoredMemory,
    MessageRecord,
    format_memories_for_prompt,
    re_rank,
)
from app.services.personalization_service import (
    search_personal_facts,
    format_personal_facts_for_prompt,
    extract_and_store_personal_facts,
)
from app.routes import health
from app.services.embedding_service import get_embedding
from app.services.extraction_service import extract_memory
from app.services.ollama_service import stream_chat
from app.services.postgres_service import (
    ensure_conversation,
    get_next_turn_index,
    get_pool,
    init_db,
    get_conversations,
    get_messages_for_conversation,
    get_all_topics,
    set_conversation_title,
    store_messages,
    wipe_postgres
)
from app.services.topic_chunk_service import (
    format_topic_chunks_for_prompt,
    process_turn_post_response,
)
from app.services.message_chunk_service import store_message_chunks
from app.services.qdrant_service import (
    get_all_tags,
    init_collection,
    init_message_chunks_collection,
    search_memories,
    search_message_chunks,
    upsert_memory,
    init_topic_chunks_collection,
    search_topic_chunks,
    wipe_qdrant,
)
from app.services.event_service import emit, subscribe, unsubscribe


logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

app = FastAPI(title="Valac Python Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)

# In-memory conversation history: conversation_id → [{role, content}]
conversation_histories: dict[str, list[dict]] = {}


@app.on_event("startup")
async def startup():
    await init_collection()
    await init_topic_chunks_collection()
    await init_message_chunks_collection()
    await init_db()


@app.get("/")
def root():
    return {"message": "Valac Python backend running"}

# Careful with this guy!
@app.post("/admin/wipe-all")
async def wipe_all():
    logger.debug(f"Wipe ALL!!!!!")
    await wipe_qdrant()
    await wipe_postgres()
    conversation_histories.clear()
    await startup()
    return {"status": "ok"}

@app.get("/events")
async def events():
    q = subscribe()

    async def stream():
        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"data: {event}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # stay alive, loop again
        except asyncio.CancelledError:
            pass
        finally:
            unsubscribe(q)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })

# ---------------------------------------------------------------------------
# Background task — extract and store memory after the stream completes
# ---------------------------------------------------------------------------

async def store_memory(
    user_message: str,
    assistant_message: str,
    user_id: str,
    conversation_id: str,
) -> None:
    try:
        extracted_dict = await extract_memory(user_message, assistant_message)
        if not extracted_dict:
            return

        extracted = ExtractedMemory(**extracted_dict)
        vector    = await get_embedding(extracted.summary)
        payload   = extracted.to_payload(user_id=user_id, conversation_id=conversation_id)
        memory    = StoredMemory(id=str(uuid.uuid4()), vector=vector, payload=payload)

        await upsert_memory(memory)
        await emit("tags_updated")
        return extracted_dict.get("tags", [])
    except Exception as e:
        logger.error(f"store_memory failed: {e}", exc_info=True)
        return [] 

# ---------------------------------------------------------------------------
# /ask
# ---------------------------------------------------------------------------

@app.post("/ask")
async def ask(req: AskRequest):
    now     = time.strftime("%A, %B %d %Y — %I:%M %p")
    history = conversation_histories.get(req.conversation_id)
    if history is None:
        rows = await get_messages_for_conversation(req.conversation_id)
        history = [{"role": r["role"], "content": r["content"]} for r in rows]
        conversation_histories[req.conversation_id] = history
 
    full_response: list[str] = []
 
    async def stream():
        try:
            # ── 1. Embed + search gate concurrently ──────────────────────
            embed_task = asyncio.create_task(get_embedding(req.prompt))
            gate_task  = asyncio.create_task(should_search(req.prompt))
            query_vector, (needs_search, search_query, needs_verbatim, is_personal, is_complex) = await asyncio.gather(
                embed_task, gate_task
            )
 
            # ── 2. Web search (if needed) ─────────────────────────────────
            search_block = ""
            if needs_search and search_query:
                yield f"__STATUS__Searching the web for: {search_query}...\n"
                results      = await search(search_query)
                search_block = format_search_results(results)
                if search_block:
                    logger.debug(f"Injecting search results for: {search_query!r}")
            else:
                yield "__STATUS__Decided not to search the web\n"
 
      # ── 3. Retrieve all memory sources concurrently ───────────────────
            memory_block = ""
            chunk_block  = ""
            topic_block  = ""


            if is_complex:
                yield "__STATUS__Searching past conversations...\n"

                personal_future = search_personal_facts(query_vector, user_id=req.user_id) if is_personal else asyncio.sleep(0)

                chunk_future = search_message_chunks(query_vector) if needs_verbatim else asyncio.sleep(0)

                candidates, chunk_result, topic_chunks, personal_result = await asyncio.gather(
                    search_memories(query_vector, user_id=req.user_id),
                    chunk_future,
                    search_topic_chunks(query_vector, exclude_conversation_id=req.conversation_id),
                    personal_future,
                )

                # Process memories
                ranked       = re_rank(candidates)
                memory_block = format_memories_for_prompt(ranked)
                if memory_block:
                    tag_line = ranked[0].memory.payload.tags[:3] if ranked else []
                    label    = ", ".join(tag_line) if tag_line else "related topics"
                    yield f"__STATUS__Found memories about: {label}...\n"
                else:
                    yield "__STATUS__No matching memories found\n"

                # Process message chunks (only if needs_verbatim)
                if needs_verbatim and isinstance(chunk_result, list) and chunk_result:
                    chunk_texts = [
                        c.payload.get("text", "")
                        for c in chunk_result[:5]
                        if c.payload and c.payload.get("text")
                    ]
                    chunk_block = (
                        "Relevant verbatim excerpts from past conversations:\n\n" +
                        "\n\n".join(chunk_texts)
                    ) if chunk_texts else ""
                    yield "__STATUS__Found relevant excerpts\n" if chunk_texts else "__STATUS__No relevant excerpts found\n"

                # Process topic chunks
                topic_block = await format_topic_chunks_for_prompt(topic_chunks)
                if topic_block:
                    labels = ", ".join(c.payload.topic_label for c in topic_chunks[:2])
                    yield f"__STATUS__Found related past conversations: {labels}\n"
                else:
                    yield "__STATUS__No related past conversations found\n"
            else:
                yield "__STATUS__Simple query — skipping memory retrieval\n"
 
            # ── 5. Build system prompt ────────────────────────────────────
            system_parts = [
                (
                    f"The current date and time is {now}. "
                    "This is ground truth — trust it unconditionally and use it to answer "
                    "any questions about today's date, the current year, upcoming events, "
                    "or how much time has passed. Do not contradict or second-guess it based "
                    "on your training data."
                ),
                (
                    "You are a helpful assistant with memory of past conversations. "
                    "The conversation history is provided in full. Always use it to resolve "
                    "references like 'that', 'it', 'there', or 'that state' — never say you "
                    "lack context when the answer is visible in the conversation above."
                ),
            ]
 
            if memory_block:
                system_parts.append(memory_block)
 
            if topic_block:
                system_parts.append(topic_block)

            if chunk_block:
                system_parts.append(chunk_block)

            if is_personal and isinstance(personal_result, list) and personal_result:
                personal_block = format_personal_facts_for_prompt(personal_result)
                if personal_block:
                    system_parts.append(personal_block)
 
            if search_block:
                system_parts.append(
                    "The following web search results are current and accurate. "
                    "Use them to answer questions about recent events. "
                    "Do not say you lack access to current information when search results are provided.\n\n"
                    + search_block
                )
 
            system_prompt = "\n\n".join(system_parts)
 
            # ── 6. Stream LLM response ────────────────────────────────────
            yield "__STATUS__Generating response...\n"
            async for token in stream_chat(
                req.prompt,
                system_prompt=system_prompt,
                history=history,
            ):
                full_response.append(token)
                yield token
 
            # ── 7. Update history ─────────────────────────────────────────
            assistant_message = "".join(full_response)

            # Ensure conversation exists / update timestamp
            await ensure_conversation(req.conversation_id)

            # Persist messages atomically with proper turn ordering
            pool = await get_pool()
            async with pool.acquire() as conn:
                base_turn = await get_next_turn_index(req.conversation_id, conn)

                stored_at = datetime.now(timezone.utc)

                user_record = MessageRecord(
                    message_id=str(uuid.uuid4()),
                    conversation_id=req.conversation_id,
                    turn_index=base_turn,
                    role="user",
                    content=req.prompt,
                    created_at=stored_at,
                )

                assistant_record = MessageRecord(
                    message_id=str(uuid.uuid4()),
                    conversation_id=req.conversation_id,
                    turn_index=base_turn + 1,
                    role="assistant",
                    content=assistant_message,
                    created_at=stored_at,
                )

                await store_messages(user_record, assistant_record)

                if base_turn == 0:
                    raw_title = req.prompt[:60].strip()
                    title = raw_title if len(req.prompt) <= 60 else raw_title + "..."
                    await set_conversation_title(req.conversation_id, title)

            history.append({"role": "user", "content": req.prompt})
            history.append({"role": "assistant", "content": assistant_message})
 
            # ── 8. Background tasks — per-fact extraction + topic chunking ─
            #       Both are fire-and-forget; store_memory waits up to 45s
            #       for tags, process_turn_post_response is fully detached.

            asyncio.create_task(store_message_chunks(
                message_id=user_record.message_id,
                conversation_id=req.conversation_id,
                text=req.prompt,
            ))

            asyncio.create_task(store_message_chunks(
                message_id=assistant_record.message_id,
                conversation_id=req.conversation_id,
                text=assistant_message,
            ))
 
            asyncio.create_task(store_memory(
                user_message=req.prompt,
                assistant_message=assistant_message,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
            ))
 
            asyncio.create_task(process_turn_post_response(
                conversation_id=req.conversation_id,
                query_vector=query_vector,        # reuse — already computed in step 1
                user_record=user_record,
                assistant_record=assistant_record
            ))

            if is_personal:
                asyncio.create_task(extract_and_store_personal_facts(
                    user_message=req.prompt,
                    user_id=req.user_id,
                    conversation_id=req.conversation_id,
                ))
 
        except Exception as e:
            logger.error(f"Stream error: {e}", exc_info=True)
            yield f"__ERROR__{e}\n"
 
    return StreamingResponse(stream(), media_type="text/plain")

@app.get("/conversations")
async def list_conversations():
    """
    Returns conversations ordered by most recent activity.
    Used by the frontend conversation list panel.
    """
    rows = await get_conversations(limit=50)
    result = []
    for r in rows:
        updated_at: datetime = r["updated_at"]
        result.append({
            "id":        r["conversation_id"],
            "title":     r["title"] or "New conversation",
            "preview":   (r["preview"] or "")[:80],
            "timestamp": _format_age(updated_at),
        })
    return JSONResponse(result)
 
 
@app.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    """
    Returns all messages for a conversation, ordered by turn_index.
    Used when the user selects a past conversation to resume.
    """
    rows = await get_messages_for_conversation(conversation_id)
    return JSONResponse([
        {
            "id":        r["message_id"],
            "role":      r["role"],
            "content":   r["content"],
            "timestamp": r["created_at"].strftime("%I:%M %p").lstrip("0"),
        }
        for r in rows
    ])
 
 
def _format_age(dt: datetime) -> str:
    """Return a human-readable relative timestamp (e.g. '3 hours ago')."""
    now     = datetime.now(timezone.utc)
    delta   = now - dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else now - dt
    seconds = int(delta.total_seconds())
 
    if seconds < 60:
        return "just now"
    if seconds < 3600:
        m = seconds // 60
        return f"{m} minute{'s' if m != 1 else ''} ago"
    if seconds < 86400:
        h = seconds // 3600
        return f"{h} hour{'s' if h != 1 else ''} ago"
    if seconds < 86400 * 7:
        d = seconds // 86400
        return f"{d} day{'s' if d != 1 else ''} ago"
    if seconds < 86400 * 30:
        w = seconds // (86400 * 7)
        return f"{w} week{'s' if w != 1 else ''} ago"
    m = seconds // (86400 * 30)
    return f"{m} month{'s' if m != 1 else ''} ago"

@app.get("/topics")
async def list_topics():
    """
    Returns all topic chunks across all conversations, ordered most recent first.
    Connections are co-occurring topics within the same conversation.
    Relevance is a recency score (1.0 = brand new, ~0.05 after 6 months).
    """
    topics = await get_all_topics(limit=100)
    return JSONResponse(topics)

@app.get("/tags")
async def list_tags():
    """
    Returns tag nodes and co-occurrence edges built from stored memories.
    Two tags are connected if they appear on the same memory.
    Relevance is recency-weighted by the most recent memory containing that tag.
    """
    tags = await get_all_tags()
    return JSONResponse(tags)
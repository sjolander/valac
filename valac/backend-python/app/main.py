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
    format_memories_for_prompt,
    re_rank,
)
from app.routes import health
from app.services.embedding_service import get_embedding
from app.services.extraction_service import extract_memory
from app.services.ollama_service import stream_chat
from app.services.postgres_service import (
    init_db,
    get_conversations,
    get_messages_for_conversation,
    get_all_topics
)
from app.services.topic_chunk_service import (
    format_topic_chunks_for_prompt,
    process_turn_post_response,
)
from app.services.qdrant_service import (
    init_collection,
    search_memories,
    upsert_memory,
    init_topic_chunks_collection,
    search_topic_chunks,
)


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
    await init_db()


@app.get("/")
def root():
    return {"message": "Valac Python backend running"}


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
            query_vector, (needs_search, search_query) = await asyncio.gather(
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
 
            # ── 3. Retrieve per-fact memories ─────────────────────────────
            yield "__STATUS__Searching past conversations...\n"
            candidates   = await search_memories(query_vector, user_id=req.user_id)
            ranked       = re_rank(candidates)
            memory_block = format_memories_for_prompt(ranked)
 
            if memory_block:
                tag_line = ranked[0].memory.payload.tags[:3] if ranked else []
                label    = ", ".join(tag_line) if tag_line else "related topics"
                yield f"__STATUS__Found memories about: {label}...\n"
            else:
                yield "__STATUS__No matching memories found\n"
 
            # ── 4. Retrieve topic chunks (past conversations) ─────────────
            topic_chunks = await search_topic_chunks(
                query_vector,
                exclude_conversation_id=req.conversation_id,
            )
            topic_block = await format_topic_chunks_for_prompt(topic_chunks)
 
            if topic_block:
                labels = ", ".join(c.payload.topic_label for c in topic_chunks[:2])
                yield f"__STATUS__Found related past conversations: {labels}\n"
            else:
                yield "__STATUS__No related past conversations found\n"
 
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
            history.append({"role": "user",      "content": req.prompt})
            history.append({"role": "assistant", "content": assistant_message})
 
            # ── 8. Background tasks — per-fact extraction + topic chunking ─
            #       Both are fire-and-forget; store_memory waits up to 45s
            #       for tags, process_turn_post_response is fully detached.
 
            store_task = asyncio.create_task(store_memory(
                user_message=req.prompt,
                assistant_message=assistant_message,
                user_id=req.user_id,
                conversation_id=req.conversation_id,
            ))
 
            asyncio.create_task(process_turn_post_response(
                user_message=req.prompt,
                assistant_message=assistant_message,
                conversation_id=req.conversation_id,
                query_vector=query_vector,        # reuse — already computed in step 1
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
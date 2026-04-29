# Valac Memory Schema

## Overview

Two storage layers with complementary roles:

- **Qdrant** — durable semantic layer. Holds topic-chunked summaries as vectors. Survives conversation deletion.
- **Postgres** — verbatim layer. Holds exact conversation turns. Expendable; trimmed over time.

The shared key linking them is `chunk_id` (Qdrant → Postgres `topic_chunks` table) and `conversation_id` (both sides).

---

## Qdrant

### Collection: `topic_chunks`

- **Vector**: 384-dim embedding of `summary` text (`all-minilm`)
- **Distance**: Cosine
- **Purpose**: Semantic retrieval of topic summaries at inference time

#### Payload Schema

```python
class TopicChunkPayload(BaseModel):
    chunk_id: str                  # UUID — primary identity, shared with Postgres
    conversation_id: str           # UUID — links to Postgres conversations table
    topic_label: str               # Short LLM-generated label, e.g. "career change discussion"
    summary: str                   # LLM-generated summary of this topic window
    turn_start: int                # Inclusive index of first message in Postgres messages table
    turn_end: int                  # Inclusive index of last message covered
    timestamp_start: datetime      # Wall time of first turn in this chunk
    timestamp_end: datetime        # Wall time of last turn in this chunk
    recall_count: int              # Number of times this chunk was retrieved (starts at 0)
    last_accessed: datetime | None # Last retrieval timestamp; None until first recall
    exact_turns_available: bool    # False once Postgres rows have been trimmed
```

#### Payload Indexes

```
chunk_id            — keyword (for direct lookup)
conversation_id     — keyword (for fetching all chunks belonging to a conversation)
topic_label         — keyword (for user-facing topic browsing/trim UI)
timestamp_start     — datetime (for time-range filtering)
exact_turns_available — bool (for filtering to chunks that still have verbatim backup)
```

---

## Postgres

### Table: `conversations`

Top-level record for each conversation session.

```sql
CREATE TABLE conversations (
    conversation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    title             TEXT,                        -- Optional user-visible label
    archived_at       TIMESTAMPTZ DEFAULT NULL     -- Set before hard deletion; enables soft-delete window
);
```

---

### Table: `messages`

Exact verbatim turns. One row per message.

```sql
CREATE TABLE messages (
    message_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    turn_index        INTEGER NOT NULL,            -- 0-based ordering within conversation
    role              TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content           TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (conversation_id, turn_index)
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_turn_index ON messages(conversation_id, turn_index);
```

---

### Table: `topic_chunks`

Mirrors chunk metadata from Qdrant. Acts as the referential anchor between Qdrant payloads and Postgres messages. Also tracks trim state.

```sql
CREATE TABLE topic_chunks (
    chunk_id          UUID PRIMARY KEY,            -- Matches chunk_id in Qdrant payload
    conversation_id   UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
    topic_label       TEXT NOT NULL,
    turn_start        INTEGER NOT NULL,            -- Matches turn_index in messages
    turn_end          INTEGER NOT NULL,
    timestamp_start   TIMESTAMPTZ NOT NULL,
    timestamp_end     TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    exact_turns_available BOOLEAN NOT NULL DEFAULT TRUE  -- Set to FALSE when messages are trimmed
);

CREATE INDEX idx_topic_chunks_conversation_id ON topic_chunks(conversation_id);
```

---

## Relationships

```
conversations
    │
    ├──< messages          (one conversation → many messages, ordered by turn_index)
    │
    └──< topic_chunks      (one conversation → many chunks, each covering a turn range)
                │
                └── chunk_id ──→ Qdrant topic_chunks collection (semantic vectors + summary)
```

---

## Trim Sequence

When a user selects a topic chunk to trim:

1. Look up `chunk_id` in Postgres `topic_chunks` — get `conversation_id`, `turn_start`, `turn_end`
2. Delete `messages` rows where `conversation_id` matches and `turn_index BETWEEN turn_start AND turn_end`
3. Set `topic_chunks.exact_turns_available = FALSE`
4. Update Qdrant payload: `exact_turns_available = False`
5. If all chunks for a `conversation_id` have `exact_turns_available = FALSE`, optionally archive/delete the `conversations` row

Qdrant payload (`summary`, `topic_label`, vector) is **never deleted** during a trim — only exact turns are removed.

---

## Retrieval Flow (Inference Time)

1. Embed the current user message
2. ANN search Qdrant `topic_chunks` → ranked list of relevant chunks + their `chunk_id`s
3. For each chunk: if `exact_turns_available = True`, fetch verbatim turns from Postgres `messages` using `conversation_id` + `turn_start..turn_end`
4. Assemble context:
   - **Summary** always included (from Qdrant payload)
   - **Exact turns** included only when available
5. Pass assembled context to LLM alongside current conversation window

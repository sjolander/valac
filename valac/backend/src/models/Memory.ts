export interface Conversation {
  conversationId: string; // UUID - persistent across messages of the same conversation
  parentMessageId: string | null; // For child conversations branched off a parent
  branchRootId: string | null; // Root of a branched conversation
}

// export interface StoredMemory {
//   // This top level (id/vector/payload) matches Qdrant's storage structure & naming.

//   id: string; // UUID
//   vector: number[]; // Embedding vector
//   payload: {
//     timestamp: number; // Unix timestamp in milliseconds (This allows for easier searching in Qdrant)

//     conversation: Conversation;

//     summarization: {
//       isSummarized: boolean; // Whether the memory has been summarized
//       isSummary: boolean; // Whether the memory itself is a summary
//       summarizedMemoryIds?: string[]; // Original memories that this summary (if it is one) is a summary of
//     };

//     user: string;
//     assistant: string;

//     tags: string[]; // lowercase words or phrases ex/ "guitar", "music theory"
//     relatedMemoryIds: string[];

//     sentiment: string | null;
//     importance: number;
//     isLocked: boolean;
//     userId: string; // For future multi-user support
//   };
// }

export interface StoredMemory {
  id: string; // UUID — Qdrant point ID
  vector: number[];

  payload: {
    // ── Time ──────────────────────────────────
    createdAt: number; // Unix ms — used for recency scoring & viewer date filter
    lastAccessedAt: number; // Unix ms — updated on each retrieval; drives "haven't seen this in a while"

    // ── Content ───────────────────────────────
    title: string; // Short human-readable label for the memory viewer (LLM-generated)
    summary: string; // What was actually said — this is what gets injected into context
    conversationId: string; // Groups memories from the same conversation; filter-only, not traversal

    // ── Retrieval signals ─────────────────────
    tags: string[]; // Normalized lowercase; indexed in Qdrant as keyword
    importance: number; // 0.0–1.0; part of retrieval score
    accessCount: number; // Incremented on retrieval; useful for importance decay/boost later

    // ── Summarization ─────────────────────────
    isSummary: boolean; // True if this memory replaces several older ones
    replacesIds?: string[]; // IDs of the memories this summary replaced (for audit/undo)

    // ── Viewer / management ───────────────────
    sentiment: 'positive' | 'negative' | 'neutral' | null;
    isLocked: boolean; // User-pinned; excluded from summarization and auto-deletion
    userId: string; // Keyword-indexed; required for all Qdrant queries
  };
}

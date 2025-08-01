export interface MemoryMetadata {
  role: 'user' | 'assistant';
  created_at: string;
  conversation_id: string;
  tags?: string[];
  source?: string;
}

export interface MemoryRecord {
  id: string;
  content: string;
  embedding: number[];
  metadata: MemoryMetadata;
}

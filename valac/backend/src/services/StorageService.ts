import { MemoryRecord } from '../models/Memory';

export abstract class StorageService {
  abstract initialize(embeddingLength: number): Promise<void>;

  /**
   * Store a memory record.
   * @param record The memory record to store.
   */
  abstract insert(record: MemoryRecord): Promise<void>;

  /**
   * Search for similar memory records based on an embedding.
   * @param embedding Vector to search against.
   * @param topK Number of results to return.
   */
  abstract query(embedding: number[], topK: number): Promise<MemoryRecord[]>;

  /**
   * Delete a memory record by its ID.
   * @param id The ID of the memory to delete.
   */
  abstract delete(id: string): Promise<void>;

  /**
   * Delete all memory records for a given conversation.
   * @param conversationId The conversation ID.
   */
  abstract deleteByConversation(conversationId: string): Promise<void>;

  /**
   * Clear the entire memory store. Use cautiously.
   */
  abstract clear(): Promise<void>;
}

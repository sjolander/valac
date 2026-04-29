import { StoredMemory } from '../models/Memory';
import { v4 as uuidv4 } from 'uuid';

export abstract class StorageService {
  /**
   * Initialize the storage service.
   * @param embeddingLength The length of the embeddings.
   * @returns A promise that resolves to true if the initialization was successful.
   */
  abstract initialize(embeddingLength: number): Promise<boolean>;

  abstract queryAll(): Promise<StoredMemory[]>;

  abstract getMetadata(): Promise<any>;

  abstract getAllTagsWithCounts(): Promise<Map<string, number>>;

  /**
   * Store a memory record.
   * @param record The memory record to store.
   * @returns A promise that resolves to true if the record was successfully inserted.
   */
  abstract insert(record: StoredMemory): Promise<boolean>;

  /**
   * Search for similar memory records based on an embedding.
   * @param embedding Vector to search against.
   * @param topK Number of results to return.
   */
  abstract query(embedding: number[], topK: number): Promise<StoredMemory[]>;

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
   * Get the most recent memory records.
   * @param count Quantity of memories to return.
   */
  abstract getMostRecentMemories(count: number): Promise<StoredMemory[]>;

  /**
   * Get a memory record by its ID.
   * @param id The ID of the memory to retrieve.
   */
  abstract getMemoryById(id: string): Promise<StoredMemory | null>;

  /**
   * Clear the entire memory store. Use cautiously.
   */
  abstract clear(): Promise<void>;

  async storeMemory(
    id: string,
    prompt: string,
    llmResponse: string,
    time: number,
    embedding: number[],
    conversationId: string,
    relatedMemoryIds: string[],
    tags: string[]
  ): Promise<boolean> {
    const record: StoredMemory = {
      id: id,
      vector: embedding,
      payload: {
        timestamp: time,
        conversation: {
          conversationId: conversationId,
          parentMessageId: null, // TODO
          branchRootId: null, // TODO
        },
        summarization: {
          isSummarized: false, // TODO
          isSummary: false, // TODO
          summarizedMemoryIds: undefined, // TODO
        },
        user: prompt,
        assistant: llmResponse,
        tags: tags,
        relatedMemoryIds: relatedMemoryIds,

        sentiment: null, // TODO
        importance: 5, // TODO
        isLocked: false, // TODO
        userId: 'tsjoland', //TODO
      },
    };

    return this.insert(record);
  }
}

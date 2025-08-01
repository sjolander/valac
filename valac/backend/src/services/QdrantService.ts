import { StorageService } from './StorageService.js';
import { MemoryRecord } from '../models/Memory';
import axios from 'axios';

const QDRANT_URL = process.env.QDRANT_HOST || 'http://qdrant:6333';
const COLLECTION_NAME = 'valac-memory';

export class QdrantService extends StorageService {
  private collectionName = COLLECTION_NAME;

  async initialize(embeddingLength: number): Promise<void> {
    try {
      // Check if the collection exists
      const res = await axios.get(`${QDRANT_URL}/collections`);
      const collections = res.data.result.collections || [];
      const exists = collections.some(
        (c: any) => c.name === this.collectionName
      );

      if (!exists) {
        await axios.put(`${QDRANT_URL}/collections/${this.collectionName}`, {
          vectors: {
            size: embeddingLength,
            distance: 'Cosine',
          },
        });
      }
    } catch (err) {
      throw new Error(`Qdrant init failed: ${err}`);
    }
  }

  async insert(record: MemoryRecord): Promise<void> {
    await axios.put(`${QDRANT_URL}/collections/${this.collectionName}/points`, {
      points: [
        {
          id: record.id,
          vector: record.embedding,
          payload: {
            content: record.content,
            ...record.metadata,
          },
        },
      ],
    });
  }

  async query(embedding: number[], topK: number): Promise<MemoryRecord[]> {
    const res = await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/search`,
      {
        vector: embedding,
        limit: topK,
        with_payload: true,
        with_vector: true,
        score_threshold: 0.8,
      }
    );

    return res.data.result.map((item: any) => {
      const payload = item.payload || {};
      return {
        id: item.id.toString(),
        content: payload.content || '',
        embedding: item.vector,
        metadata: {
          role: payload.role,
          created_at: payload.created_at,
          conversation_id: payload.conversation_id,
          tags: payload.tags,
          source: payload.source,
        },
      };
    });
  }

  async delete(id: string): Promise<void> {
    await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/delete`,
      {
        points: [id],
      }
    );
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/delete`,
      {
        filter: {
          must: [
            {
              key: 'conversation_id',
              match: { value: conversationId },
            },
          ],
        },
      }
    );
  }

  async clear(): Promise<void> {
    await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/delete`,
      {
        filter: {}, // deletes all
      }
    );
  }
}

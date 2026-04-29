import { StorageService } from './StorageService.js';
import { StoredMemory } from '../models/Memory';
import axios from 'axios';

const QDRANT_URL = process.env.QDRANT_HOST || 'http://qdrant:6333';
const QDRANT_HOST = 'qdrant';
const QDRANT_PORT = 6333;
const COLLECTION_NAME = 'valac-memory';

export class QdrantService extends StorageService {
  constructor() {
    super();
  }

  async getMetadata(): Promise<any> {
    const response = await axios.get(
      `${QDRANT_URL}/collections/${this.collectionName}`
    );
    return response;
  }

  async queryAll(): Promise<StoredMemory[]> {
    const res = await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/scroll`,
      {
        limit: 10000, // adjust as needed for your dataset size
        with_payload: true,
        with_vector: true,
      }
    );

    return (res.data.result.points || []).map((item: any) => {
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
  private collectionName = COLLECTION_NAME;

  async initialize(embeddingLength: number): Promise<boolean> {
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

        // Create payload index for timestamp to speed up recency searches
        await axios.put(
          `${QDRANT_URL}/collections/${this.collectionName}/index`,
          {
            field_name: 'timestamp',
            field_schema: 'datetime',
          }
        );

        // Payload index for tags
        await axios.put(
          `${QDRANT_URL}/collections/${this.collectionName}/index`,
          {
            field_name: 'tags',
            field_schema: 'integer', // exact-match strings
          }
        );
        return true;
      } else {
        return true;
      }
    } catch (err) {
      throw new Error(`Qdrant init failed: ${err}`);
    }
  }

  async insert(record: StoredMemory): Promise<boolean> {
    try {
      console.dir(record, { depth: null });

      const response = await axios.put(
        `${QDRANT_URL}/collections/${this.collectionName}/points`,
        { points: [record] },
        { maxBodyLength: Infinity, maxContentLength: Infinity }
      );

      if (response.status !== 200) {
        throw new Error(`Failed to insert record. Status ${response.status}`);
      }
      return true;
    } catch (err) {
      throw new Error(`Failed to insert record: ${err}`);
    }
  }

  async query(embedding: number[], topK: number): Promise<StoredMemory[]> {
    // const res2 = await axios.post(
    //   `${QDRANT_URL}/collections/${this.collectionName}/points/scroll`,
    //   {
    //     limit: 5,
    //     with_payload: true,
    //     with_vector: true,
    //   }
    // );

    // console.dir(res2.data, { depth: null });

    const res = await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/search`,
      {
        vector: embedding,
        limit: topK,
        with_payload: true,
        with_vector: true,
        score_threshold: 0.3,
      },
      { maxBodyLength: Infinity, maxContentLength: Infinity }
    );

    // const res = await axios.post(
    //   `${QDRANT_URL}/collections/${this.collectionName}/points/search`,
    //   {
    //     // vector: embedding,
    //     limit: topK,
    //     with_payload: true,
    //     with_vector: true,
    //     // score_threshold: 0.8,
    //   },
    //   { timeout: 10000 }
    // );

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

  async getAllTagsWithCounts(): Promise<Map<string, number>> {
    const tagCounts = new Map<string, number>();
    let offset = 0;
    const batchSize = 100; // adjust as needed

    while (true) {
      // TODO: Tighten this type
      const points: any = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
        {
          limit: batchSize,
          with_payload: true,
          with_vector: false,
          offset: offset,
        }
      );

      if (!points.points || points.points.length === 0) break;

      for (const point of points.points) {
        const payloadTags = point.payload?.tags;
        if (Array.isArray(payloadTags)) {
          for (const tag of payloadTags) {
            const normalizedTag = tag.toLowerCase();
            tagCounts.set(
              normalizedTag,
              (tagCounts.get(normalizedTag) || 0) + 1
            );
          }
        }
      }

      offset += points.points.length;
      if (points.points.length < batchSize) break;
    }

    return tagCounts;
  }

  async delete(id: string): Promise<void> {
    await axios.post(
      `${QDRANT_URL}/collections/${this.collectionName}/points/delete`,
      {
        points: [id],
      }
    );
  }

  async getMemoryById(id: string): Promise<StoredMemory | null> {
    try {
      const res = await axios.post(
        `${QDRANT_URL}/collections/${this.collectionName}/points/get`,
        {
          ids: [id],
          with_payload: true,
          with_vector: false,
        }
      );

      return res.data.result[0]
        ? {
            id: res.data.result[0].id,
            vector: [],
            payload: res.data.result[0].payload,
          }
        : null;
    } catch (err: any) {
      console.error('Error fetching memory:', err.message);
      throw err;
    }
  }

  async getMostRecentMemories(count: number = 10): Promise<StoredMemory[]> {
    // Scroll gets batches of points; we take the most recent by timestamp
    const response: any = await axios.post(
      `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
      {
        limit: count * 2,
        with_payload: true,
        with_vector: true,
      }
    );

    // Sort by timestamp descending
    const sorted = response.points
      ? (response.points as any[])
          .sort(
            (a, b) => (b.payload.timestamp ?? 0) - (a.payload.timestamp ?? 0)
          )
          .slice(0, count)
      : [];

    return sorted.map((point) => ({
      id: point.id.toString(),
      vector: point.vector as number[],
      payload: point.payload,
    }));
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

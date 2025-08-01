import { StorageService } from './StorageService.js';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { MemoryMetadata, MemoryRecord } from '../models/Memory';

// ChromaDB has been shelved because it cannot return query results with top-K matching,
// so it would not scale when the number of memories grows large.
// Instead, we are using Qdrant for vector storage and retrieval.

const CHROMA_URL = 'http://chromadb:8000/api/v1';
const COLLECTION_NAME = 'valac-memory';

interface QueryResponse {
  ids: string[][];
  documents: string[][];
  embeddings: number[][][];
  metadatas: MemoryMetadata[][];
  distances: number[][];
}

export class ChromaDBService extends StorageService {
  private collectionUUID: string | null = null;

  async initialize(embeddingLength: number): Promise<void> {
    const res = await axios.get(`${CHROMA_URL}/collections`);
    const data = res.data;
    const exists = data?.collections?.some(
      (c: any) => c.name === COLLECTION_NAME
    );

    if (!exists) {
      const response = await axios.post(`${CHROMA_URL}/collections`, {
        name: COLLECTION_NAME,
      });
      this.collectionUUID = response.data.id;
    }
  }

  async insert(record: MemoryRecord): Promise<void> {
    await axios.post(
      `${CHROMA_URL}/collections/${this.collectionUUID}/upsert`,
      {
        ids: [record.id || uuidv4()],
        embeddings: [record.embedding],
        documents: [record.content],
        metadatas: [record.metadata],
      }
    );
  }

  async query(embedding: number[], topK: number): Promise<MemoryRecord[]> {
    const payload = {
      query_embeddings: [embedding],
      n_results: topK,
      include: ['embeddings', 'documents', 'metadatas', 'distances'],
    };
    const res = await axios.post<QueryResponse>(
      `${CHROMA_URL}/collections/${this.collectionUUID}/query`,
      payload
    );

    const data = res.data;
    const results: MemoryRecord[] = [];
    const threshold = 0.3;

    for (let i = 0; i < data.ids[0].length; i++) {
      const distance = data.distances[0][i];
      if (distance > threshold) continue;
      results.push({
        id: data.ids[0][i],
        content: data.documents[0][i],
        embedding: data.embeddings[0][i],
        metadata: data.metadatas[0][i],
      });
    }

    return results;
  }

  async delete(id: string): Promise<void> {
    await axios.post(
      `${CHROMA_URL}/collections/${this.collectionUUID}/delete`,
      {
        ids: [id],
      }
    );
  }

  async deleteByConversation(conversationId: string): Promise<void> {
    await axios.post(
      `${CHROMA_URL}/collections/${this.collectionUUID}/delete`,
      {
        where: { conversation_id: conversationId },
      }
    );
  }

  async clear(): Promise<void> {
    await axios.post(
      `${CHROMA_URL}/collections/${this.collectionUUID}/delete`,
      {
        where: {},
      }
    );
  }
}

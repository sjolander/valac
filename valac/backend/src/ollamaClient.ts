// src/ollamaClient.ts
import fetch from 'node-fetch';
import { MemoryRecord } from './models/Memory';

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://ollama:11434';

export async function getEmbedding(prompt: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral', // or 'mistral:latest'
      prompt,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as any;
  return data.embedding; // this is an array of floats
}

export async function getCompletionWithMemory(
  prompt: string,
  memory: MemoryRecord[]
): Promise<string> {
  const context = memory
    .map((m) => `[${m.metadata.role}] ${m.content}`)
    .join('\n');

  const finalPrompt = `${context}\n[user] ${prompt}`;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral:latest',
      prompt: finalPrompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Completion failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as any;
  return data.response;
}

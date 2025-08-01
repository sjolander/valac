import { MemoryRecord } from './models/Memory.js';
import { getCompletionWithMemory, getEmbedding } from './ollamaClient.js';
import { StorageService } from './services/StorageService.js';
import { v4 as uuidv4 } from 'uuid';

let initialized = false;

function generateMetadata(
  prompt: string,
  embedding: number[],
  isUser: boolean = true
): MemoryRecord {
  return {
    id: uuidv4(),
    content: prompt,
    embedding: embedding,
    metadata: {
      role: isUser ? 'user' : 'assistant',
      created_at: new Date().toISOString(),
      conversation_id: 'default-conversation',
      // source: "ask-function",
      // TODO
      // tags: ["ask"],
    },
  };
}

export async function ask(prompt: string, storage: StorageService) {
  try {
    const embedding = await getEmbedding(prompt);
    console.log('aaa Got embedding with length:', embedding.length);
    if (!initialized) {
      await storage.initialize(embedding.length);
      initialized = true;
      console.log('aaa Storage initialized');
    }
    const record = generateMetadata(prompt, embedding);
    console.log('aaa Generated metadata record');
    await storage.insert(record);
    console.log('aaa Inserted record into storage');
    const memories = await storage.query(embedding, 5);
    console.log('aaa Finished query for memories:', memories.length);
    const llmResponse = await getCompletionWithMemory(prompt, memories);
    // Don't wait for the response to be inserted back into storage
    console.log('aaa LLM Response:', llmResponse);
    (async () => {
      try {
        const responseRecord = generateMetadata(
          llmResponse,
          await getEmbedding(llmResponse),
          false
        );
        await storage.insert(responseRecord);
      } catch (error) {
        console.error('Error inserting response record into storage:', error);
      }
    })();

    return llmResponse;
  } catch (error) {
    console.error('Error in ask function:', error);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

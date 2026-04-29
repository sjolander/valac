import { StoredMemory } from './models/Memory.js';
import { getCompletionWithMemory, getTags } from './ollamaClient.js';
import { StorageService } from './services/StorageService.js';
import { v4 as uuidv4 } from 'uuid';
import { cosineSimilarity, getEmbedding } from './util.js';

let initialized = false;

/**
 * Get a conversation ID for a memory
 *
 * What constitutes a new conversation?  We use a hybrid approach:
 * Step 1: From the existing memories that we already know are related, find one with the most matching tags.
 * Step 2: If there are no existing memories to draw from, look at recent memories.  Do any of them have matching tags or similar content?
 * Step 3: If still no conversation is found, create a new one.
 *
 * This should cover a few scenarios:
 * A) You're talking about vector databases.  Then a few days go by.  You have a new thought and have a follow-up question.
 *    That's part of the same conversation.
 * B) You're talking about vector databases, and the LLM mentions how REST is less efficient than gRPC, so you say "Compare gRPC to REST."
 *    You're not talking about vector databases anymore, but it's still part of the same conversation.
 * C) You're talking about vector databases.  Then you ask "Why is the sky blue?"  That's a new conversation
 *
 * @param tags Topics of the new memory
 * @param relatedMemoryIds IDs of related memories that were sent to the LLM as part of the prompt
 */
async function getConversationId(
  tags: string[],
  relatedMemoryIds: string[],
  storage: StorageService
): Promise<string> {
  const getEmbeddingsForTags = async (tags: string[]) => {
    const allTags = tags.join();
    const embeddings = await getEmbedding(allTags);
    return embeddings;
  };
  const tagEmbedding = await getEmbeddingsForTags(tags);
  const getBestTagMatch = (memories: (StoredMemory | null)[]) => {
    let bestMatch = 0,
      bestMatchId = '';
    memories.forEach(async (memory) => {
      if (memory) {
        const cosineSim = cosineSimilarity(
          tagEmbedding,
          await getEmbeddingsForTags(memory.payload.tags)
        );
        if (cosineSim > bestMatch) {
          bestMatch = cosineSim;
          bestMatchId = memory.payload.conversation.conversationId;
        }
      }
    });
    return bestMatch > 0.8 ? bestMatchId : null;
  };

  const relatedMemories: (StoredMemory | null)[] = await Promise.all(
    relatedMemoryIds.map((id) => storage.getMemoryById(id))
  );
  const relatedId = getBestTagMatch(relatedMemories);
  if (relatedId) {
    return relatedId;
  }

  const recentMemories: StoredMemory[] = await storage.getMostRecentMemories(
    10
  );
  const recentId = getBestTagMatch(recentMemories);
  return recentId || uuidv4();
}

async function prepareAndSaveMemory(
  userInput: string,
  assistantReply: string,
  relatedMemoryIds: string[],
  storage: StorageService
) {
  const tags = await getTags(userInput, 5, assistantReply);
  const sessionId = uuidv4();
  const timestamp = Date.now();
  const formattedText = `[Time]: ${timestamp}
[Session]: ${sessionId}
[User]: ${userInput}
[Assistant]: ${assistantReply}
[Tags]: ${tags.join()}`;

  const embedding = await getEmbedding(formattedText); // Call to embedding model
  const id = uuidv4();

  await storage.storeMemory(
    id,
    userInput,
    assistantReply,
    timestamp,
    embedding,
    await getConversationId(tags, relatedMemoryIds, storage),
    relatedMemoryIds,
    tags
  );
}

export async function ask(prompt: string, storage: StorageService) {
  try {
    // Our goal here is twofold:
    // 1. Assemble an augmented prompt with relevant memories, process with an LLM, and send the LLM response back
    // 2. Store the prompt and response in our vector database for future reference

    // Here's our multi-step process:
    // 1. Get embedding for the prompt (using lightweight LLM)
    // 2. Search vector DB for relevant memories
    // 3. Assemble augmented prompt with memories and current time
    // 4. Send to LLM for response
    // 5. Response to user
    // 6. Generate tags from the prompt/response pair
    // 7. Store the response in vector DB - prompt & response pair, timestamp, tags, related memory IDs

    const embedding = await getEmbedding(prompt);
    await storage.initialize(embedding.length);

    const memories = await storage.query(embedding, 5);
    const relatedMemoryIds = memories.map((memory) => memory.id);
    console.log('aaa Finished query for memories:', memories.length);
    const llmResponse = await getCompletionWithMemory(prompt, memories);
    // Don't wait for the response to be inserted back into storage
    console.log('aaa LLM Response:', llmResponse);
    (async () => {
      try {
        await prepareAndSaveMemory(
          prompt,
          llmResponse,
          relatedMemoryIds,
          storage
        );
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

// src/ollamaClient.ts
import fetch from 'node-fetch';
import { StoredMemory } from './models/Memory';

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://ollama:11434';

// Get tags for either a single user prompt or a pair
// of prompt & LLM reply
export async function getTags(
  prompt: string,
  quantity: number = 3,
  assistantReply?: string
): Promise<string[]> {
  const formattedPrompt = assistantReply
    ? `Return ${quantity} topic tags that best describe the following interaction.
      User message: "${prompt}"
      LLM Assistant reply: "${assistantReply}"
      Format the response as a JSON array of strings.`
    : `Return ${quantity} topic tags that best describe the following message.
      Message: "${prompt}"
      Format the response as a JSON array of strings.`;
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mistral:latest',
      prompt: formattedPrompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tags generation failed: ${response.status} ${errorText}`);
  }
  const data = (await response.json()) as any;
  let tags: string[] = data.response
    .split('"')
    .filter((s: string, i: number) => i % 2 === 1)
    .map((s: string) => s.replaceAll('_', ' ').toLowerCase().trim());
  console.log('aaa Tags response:', tags);
  return tags;
}

export async function getCompletionWithMemory(
  userPrompt: string,
  memory: StoredMemory[]
): Promise<string> {
  const finalPrompt = `You are an AI assistant with access to a list of related past conversations ("memories") from the user. These memories may help you respond more accurately and personally.

Your job is to answer the user’s question based on current context and any useful memories, but **do not reference irrelevant memories.**
You are also given the current date and time in case that is helpful in your reply.

---

Current Date/Time: ${new Date().toISOString()}

User Prompt:
"""
${userPrompt}
"""

Relevant Memories:
${memory
  .map(
    (m) =>
      `- [${m.payload.timestamp}] ///User input: ${m.payload.user} ///LLM Reply: ${m.payload.assistant}`
  )
  .join('\n')}
---

Based on the prompt and any useful memories above, provide the best possible response.`;

  console.log('aaa Final prompt to LLM:', finalPrompt);

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

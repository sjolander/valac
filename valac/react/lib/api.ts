/**
 * lib/api.ts
 *
 * Streaming fetch against the Valac /ask endpoint.
 * Parses __STATUS__, __ERROR__, and __TAGS__ prefix lines out of the stream
 * and routes them to separate callbacks so the caller stays clean.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onStatus: (status: string) => void;
  onTags: (tags: string[]) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export async function streamAsk(
  prompt: string,
  conversationId: string,
  userId: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const response = await fetch(`${API_URL}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      conversation_id: conversationId,
      user_id: userId,
    }),
  });

  if (!response.ok) {
    callbacks.onError(`HTTP ${response.status}: ${response.statusText}`);
    callbacks.onDone();
    return;
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    callbacks.onError('No response body');
    callbacks.onDone();
    return;
  }

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process all complete lines, hold the last incomplete chunk in buffer
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('__STATUS__')) {
        callbacks.onStatus(line.slice('__STATUS__'.length).trim());
      } else if (line.startsWith('__ERROR__')) {
        callbacks.onError(line.slice('__ERROR__'.length).trim());
      } else if (line.startsWith('__TAGS__')) {
        const raw = line.slice('__TAGS__'.length).trim();
        callbacks.onTags(
          raw
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        );
      } else {
        // Real LLM token — newlines are meaningful, restore the \n the split consumed
        callbacks.onToken(line + '\n');
      }
    }
  }

  // Flush any remaining buffer content that wasn't newline-terminated
  if (buffer) {
    if (buffer.startsWith('__STATUS__')) {
      callbacks.onStatus(buffer.slice('__STATUS__'.length).trim());
    } else if (buffer.startsWith('__ERROR__')) {
      callbacks.onError(buffer.slice('__ERROR__'.length).trim());
    } else if (!buffer.startsWith('__TAGS__')) {
      callbacks.onToken(buffer);
    }
  }

  callbacks.onDone();
}

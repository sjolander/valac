import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Conversation, Message } from '../models/Conversation';
import { useVault } from '../contexts/VaultContext';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL;

interface ConversationContextType {
  conversation: Conversation | null;
  askQuestion: (prompt: string) => Promise<void>;
  branchConversation: (branchPointId: string) => void;
  deleteConversation: () => void;
}

const ConversationContext = createContext<ConversationContextType | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const {
    conversations,
    activeConversationId,
    updateConversation,
    deleteConversation: deleteFromVault,
  } = useVault();
  const [conversation, setConversation] = useState<Conversation | null>(null);

  // Load conversation when activeConversationId changes
  useEffect(() => {
    const conv =
      conversations.find((c) => c.id === activeConversationId) || null;
    setConversation(conv);
  }, [activeConversationId, conversations]);

  const askQuestion = async (prompt: string) => {
    if (!conversation) return;

    const messageId = crypto.randomUUID();

    const initialMessage: Message = {
      id: messageId,
      timestamp: Date.now(),
      prompt,
      response: '',
      status: 'Connecting...',
    };

    const withPlaceholder: Conversation = {
      ...conversation,
      lastUsed: Date.now(),
      messages: [...conversation.messages, initialMessage],
    };
    setConversation(withPlaceholder);
    updateConversation(withPlaceholder);

    const updateMsg = (patch: Partial<Message>) =>
      setConversation((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === messageId ? { ...m, ...patch } : m,
          ),
        };
      });

    const appendAction = (text: string) =>
      setConversation((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === messageId
              ? { ...m, actions: [...(m.actions ?? []), text] }
              : m,
          ),
        };
      });

    let res: Response;
    try {
      res = await fetch(`${API_URL}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, conversation_id: conversation.id }),
      });
    } catch (e) {
      updateMsg({ status: undefined, error: 'Could not reach the server.' });
      return;
    }

    if (!res.ok) {
      updateMsg({ status: undefined, error: `Server error: ${res.status}` });
      return;
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    let accumulated = '';
    let responseStarted = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Once real content has started, accumulate directly — no parsing needed
      if (responseStarted) {
        // Still check for __TAGS__ even after response has started
        if (chunk.startsWith('__TAGS__')) {
          const names = chunk
            .replace('__TAGS__', '')
            .replace('\n', '')
            .split(',')
            .filter(Boolean);
          const newTags = names.map((name) => ({
            id: name,
            name,
            lastUsed: Date.now(),
          }));
          setConversation((prev: any) => {
            if (!prev) return prev;
            const updated = { ...prev, tags: newTags };
            updateConversation(updated);
            return updated;
          });
        } else {
          accumulated += chunk;
          updateMsg({ response: accumulated });
        }
        continue;
      }

      // Still in status phase — check each line in this chunk
      for (const line of chunk.split('\n')) {
        if (line.startsWith('__STATUS__')) {
          appendAction(line.slice('__STATUS__'.length).trim());
        } else if (line.startsWith('__ERROR__')) {
          updateMsg({
            status: undefined,
            error: line.slice('__ERROR__'.length),
          });
          return;
        } else if (line.length > 0) {
          // First real content — flip the flag and start accumulating
          responseStarted = true;
          accumulated += line;
          updateMsg({ status: undefined, response: accumulated });
        }
      }
    }

    updateMsg({ status: undefined });
  };

  const branchConversation = (branchPointId: string) => {
    if (!conversation) return;
    const branch: Conversation = {
      id: crypto.randomUUID(),
      tags: [...conversation.tags],
      lastUsed: Date.now(),
      messages: conversation.messages.filter((m) => m.id <= branchPointId),
    };
    updateConversation(branch);
    setConversation(branch);
  };

  const deleteConversation = () => {
    if (!conversation) return;
    deleteFromVault(conversation.id);
    setConversation(null);
  };

  return (
    <ConversationContext.Provider
      value={{
        conversation,
        askQuestion,
        branchConversation,
        deleteConversation,
      }}
    >
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversation() {
  const ctx = useContext(ConversationContext);
  if (!ctx) {
    throw new Error(
      'useConversation must be used within a ConversationProvider',
    );
  }
  return ctx;
}

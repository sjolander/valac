import React, { createContext, useContext, useState, type ReactNode } from "react";
import type { Conversation } from "../models/Conversation";

interface VaultContextType {
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  newConversation: () => string;
  deleteConversation: (id: string) => void;
  updateConversation: (conversation: Conversation) => void;
}

const VaultContext = createContext<VaultContextType | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const newConversation = () => {
    const id = crypto.randomUUID();
    const conv: Conversation = {
      id,
      tags: [],
      lastUsed: Date.now(),
      messages: [],
    };
    setConversations((prev) => [...prev, conv]);
    setActiveConversationId(id);
    return id;
  };

  const deleteConversation = (id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
    }
  };

  const updateConversation = (updated: Conversation) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  return (
    <VaultContext.Provider
      value={{
        conversations,
        activeConversationId,
        setActiveConversationId,
        newConversation,
        deleteConversation,
        updateConversation,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return ctx;
}
// src/services/ApiContext.tsx
import React, { createContext, useContext } from "react";
import * as conversationService from "./ConversationService";
import * as tagService from "./TagService";

export interface ApiService {
  conversation: typeof conversationService;
  tag: typeof tagService;
}

const ApiContext = createContext<ApiService | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const api: ApiService = {
    conversation: conversationService,
    tag: tagService,
  };

  return (
    <ApiContext.Provider value={api}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi() {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used within ApiProvider");
  return ctx;
}
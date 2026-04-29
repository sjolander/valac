import type { Tag } from './Tag';

export interface Message {
  id: string;
  timestamp: number;
  prompt: string;
  response: string;
  status?: string; // cleared when real content starts
  error?: string; // set on __ERROR__, never cleared
  actions?: string[];
}

export interface Conversation {
  id: string;
  tags: Tag[];
  lastUsed: number;
  // Without a title, default to showing the tag list
  title?: string;
  // sorted by timestamp (index zero is oldest)
  messages: Message[];
}

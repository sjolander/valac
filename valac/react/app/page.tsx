'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ChatView, type Message } from '@/components/chat-view';
import { ConversationList } from '@/components/conversation-list';
import { TagsPanel, type Tag } from '@/components/topics-panel';
import { TagGraph } from '@/components/topic-graph';
import { cn } from '@/lib/utils';
import { Menu, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { streamAsk } from '@/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const USER_ID = 'default-user';

function generateId(): string {
  return crypto.randomUUID();
}

interface ConversationMeta {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
}

export default function Home() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [graphExpanded, setGraphExpanded] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const conversationId = useRef<string>(generateId());

  // ── Fetch conversation list ───────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/conversations`);
      const data = await res.json();
      setConversations(data);
    } catch (e) {
      console.error('Failed to fetch conversations:', e);
    }
  }, []);

  // ── Fetch tags ──────────────────────────────────────────────────────────
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tags`);
      const data = await res.json();
      setTags(data);
    } catch (e) {
      console.error('Failed to fetch tags:', e);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchTags();
  }, [fetchConversations, fetchTags]);

  useEffect(() => {
    const es = new EventSource(`${API_URL}/events`);
    es.onmessage = (e) => {
      if (e.data == 'tags_updated') fetchTags();
    };
    return () => es.close();
  }, [fetchTags]);

  // ── Select a past conversation ────────────────────────────────────────────
  const handleSelect = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      setActiveId(id);
      conversationId.current = id;
      setMessages([]);
      setStatusLine('');

      try {
        const res = await fetch(`${API_URL}/conversations/${id}/messages`);
        const data = await res.json();
        setMessages(data.map((m: Message) => ({ ...m })));
      } catch (e) {
        console.error('Failed to load messages:', e);
      }
    },
    [activeId],
  );

  // ── New conversation ──────────────────────────────────────────────────────
  const handleNewChat = useCallback(() => {
    const newId = generateId();
    conversationId.current = newId;
    setActiveId(null);
    setMessages([]);
    setStatusLine('');
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || isLoading) return;

    if (!activeId) {
      setActiveId(conversationId.current);
    }

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
    const assistantId = generateId();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsLoading(true);
    setStatusLine('');

    await streamAsk(prompt, conversationId.current, USER_ID, {
      onToken: (token) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + token } : m,
          ),
        );
      },
      onStatus: setStatusLine,
      onTags: (_tags) => {
        /* reserved for tag panel */
      },
      onError: (error) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `Error: ${error}` } : m,
          ),
        );
      },
      onDone: () => {
        setIsLoading(false);
        setStatusLine('');
        fetchConversations();
      },
    });
  }, [input, isLoading, activeId, fetchConversations, fetchTags]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside
        className={cn(
          'h-full border-r border-border/50 bg-sidebar transition-all duration-300 ease-in-out',
          leftPanelOpen ? 'w-72' : 'w-0',
        )}
      >
        <div
          className={cn(
            'h-full overflow-hidden',
            leftPanelOpen ? 'opacity-100' : 'opacity-0',
          )}
        >
          <ConversationList
            conversations={conversations}
            activeId={activeId}
            onSelect={handleSelect}
            onNewChat={handleNewChat}
          />
        </div>
      </aside>

      <main className="flex flex-1 flex-col min-w-0">
        <header className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary shadow-[0_0_8px_var(--glow)] animate-pulse" />
              <span className="text-sm font-medium text-foreground tracking-tight">
                Valac AI
              </span>
            </div>
          </div>

          {statusLine && (
            <span className="text-xs text-muted-foreground/70 italic truncate mx-4 flex-1 text-center">
              {statusLine}
            </span>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            {rightPanelOpen ? (
              <PanelRightClose className="h-5 w-5" />
            ) : (
              <PanelRightOpen className="h-5 w-5" />
            )}
          </Button>
        </header>

        <div className="flex-1 overflow-hidden">
          <ChatView
            messages={messages}
            input={input}
            onInputChange={setInput}
            onSend={handleSend}
            isLoading={isLoading}
          />
        </div>
      </main>

      <aside
        className={cn(
          'h-full border-l border-border/50 bg-sidebar transition-all duration-300 ease-in-out',
          rightPanelOpen ? (graphExpanded ? 'w-[500px]' : 'w-64') : 'w-0',
        )}
      >
        <div
          className={cn(
            'h-full overflow-hidden',
            rightPanelOpen ? 'opacity-100' : 'opacity-0',
          )}
        >
          {graphExpanded ? (
            <TagGraph tags={tags} onClose={() => setGraphExpanded(false)} />
          ) : (
            <TagsPanel
              tags={tags}
              isExpanded={graphExpanded}
              onToggleExpand={() => setGraphExpanded(true)}
              onTagClick={() => setGraphExpanded(true)}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

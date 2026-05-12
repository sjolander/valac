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
import { usePersonalFacts } from '@/hooks/use-personal-facts';

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
  const [rightView, setRightView] = useState<'list' | 'graph'>('list');
  const [rightContent, setRightContent] = useState<'topics' | 'profile'>(
    'topics',
  );
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const [rightPanelWidth, setRightPanelWidth] = useState(256);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const conversationId = useRef<string>(generateId());

  const { facts: personalFacts, refresh: refreshFacts } =
    usePersonalFacts(USER_ID);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/conversations`);
      setConversations(await res.json());
    } catch (e) {
      console.error('Failed to fetch conversations:', e);
    }
  }, []);

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/tags`);
      setTags(await res.json());
    } catch (e) {
      console.error('Failed to fetch tags:', e);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchTags();
  }, [fetchConversations, fetchTags]);

  // ── SSE — refresh both tags and personal facts when memory settles ────────
  useEffect(() => {
    const es = new EventSource(`${API_URL}/events`);
    es.onmessage = (e) => {
      if (e.data === 'tags_updated') {
        fetchTags();
        refreshFacts();
      }
    };
    return () => es.close();
  }, [fetchTags, refreshFacts]);

  useEffect(() => {
    setRightPanelWidth(rightView === 'graph' ? 500 : 256);
  }, [rightView]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStartX.current = e.clientX;
      dragStartWidth.current = rightPanelWidth;

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = dragStartX.current - e.clientX;
        const newWidth = Math.max(
          200,
          Math.min(800, dragStartWidth.current + delta),
        );
        setRightPanelWidth(newWidth);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [rightPanelWidth],
  );

  // ── Conversation management ───────────────────────────────────────────────

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

  const handleNewChat = useCallback(() => {
    conversationId.current = generateId();
    setActiveId(null);
    setMessages([]);
    setStatusLine('');
  }, []);

  // ── Send ──────────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (override?: string) => {
      const prompt = (override ?? input).trim();
      if (!prompt || isLoading) return;
      if (override) setInput(''); // clear if came from suggestion

      if (!activeId) setActiveId(conversationId.current);

      const userMsg: Message = {
        id: generateId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      const assistantId = generateId();
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      if (!override) setInput('');
      setIsLoading(true);
      setStatusLine('');

      await streamAsk(prompt, conversationId.current, USER_ID, {
        onToken: (token) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m,
            ),
          ),
        onStatus: setStatusLine,
        onTags: () => {},
        onError: (error) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: `Error: ${error}` } : m,
            ),
          ),
        onDone: () => {
          setIsLoading(false);
          setStatusLine('');
          fetchConversations();
        },
      });
    },
    [input, isLoading, activeId, fetchConversations],
  );

  const handleSuggestionClick = useCallback(
    (text: string) => {
      handleSend(text);
    },
    [handleSend],
  );

  // ── Render ────────────────────────────────────────────────────────────────

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
            onSend={() => handleSend()}
            onSuggestionClick={handleSuggestionClick}
            isLoading={isLoading}
          />
        </div>
      </main>

      <aside
        className="h-full border-l border-border/50 bg-sidebar transition-[width] duration-300 ease-in-out relative"
        style={{ width: rightPanelOpen ? rightPanelWidth : 0 }}
      >
        {/* Drag handle */}
        {rightPanelOpen && (
          <div
            onMouseDown={handleDragStart}
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize z-10 hover:bg-primary/40 transition-colors"
          />
        )}
        <div
          className={cn(
            'h-full overflow-hidden flex flex-col',
            rightPanelOpen ? 'opacity-100' : 'opacity-0',
          )}
        >
          {/* ── Toggle header ── */}
          <div className="border-b border-border/50 p-3 space-y-2 shrink-0">
            {/* Content: Topics | Profile */}
            <div className="flex rounded-lg bg-secondary/50 p-0.5 gap-0.5">
              {(['topics', 'profile'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setRightContent(mode)}
                  className={cn(
                    'flex-1 text-xs py-1 rounded-md capitalize transition-all duration-150',
                    rightContent === mode
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {mode === 'topics' ? 'Topics' : 'Profile'}
                </button>
              ))}
            </div>
            {/* View: List | Graph — only meaningful for Topics */}
            <div className="flex rounded-lg bg-secondary/50 p-0.5 gap-0.5">
              {(['list', 'graph'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setRightView(view)}
                  className={cn(
                    'flex-1 text-xs py-1 rounded-md capitalize transition-all duration-150',
                    rightView === view
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {view === 'list' ? 'List' : 'Graph'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Content ── */}
          <div className="flex-1 overflow-hidden">
            {rightView === 'graph' ? (
              <TagGraph
                tags={rightContent === 'topics' ? tags : []}
                personalFacts={rightContent === 'profile' ? personalFacts : []}
                onClose={() => setRightView('list')}
              />
            ) : rightContent === 'profile' ? (
              <div className="h-full overflow-y-auto p-3 space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 px-1 pt-1">
                  What Valac knows about you
                </p>
                {personalFacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 px-1 pt-2">
                    No profile facts yet — they accumulate as you chat.
                  </p>
                ) : (
                  personalFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className="rounded-xl border border-border/50 bg-secondary/40 px-3 py-2 space-y-1.5"
                    >
                      <p className="text-xs text-foreground leading-snug">
                        {fact.label}
                      </p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary capitalize">
                          {fact.category}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {Math.round(fact.confidence * 100)}% confident
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <TagsPanel tags={tags} onTagClick={() => setRightView('graph')} />
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

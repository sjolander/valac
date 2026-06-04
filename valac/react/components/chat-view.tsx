'use client';

import { cn } from '@/lib/utils';
import { useRef, useEffect } from 'react';
import { Send, Sparkles, User, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StatusTrack } from './status-track';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatViewProps {
  messages: Message[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onSuggestionClick: (value: string) => void;
  isLoading?: boolean;
  statusLines?: string[];
  forgetful: boolean;
  onForgetfulChange: (value: boolean) => void;
}

export function ChatView({
  messages,
  input,
  onInputChange,
  onSend,
  onSuggestionClick,
  isLoading,
  statusLines = [],
  forgetful,
  onForgetfulChange,
}: ChatViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
              <div className="rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 p-6 mb-6 shadow-[0_0_30px_var(--glow)]">
                <Sparkles className="h-12 w-12 text-primary" />
              </div>
              <h1 className="text-2xl font-semibold text-foreground mb-2 tracking-tight">
                Valac remembers.
              </h1>
              <p className="text-muted-foreground text-sm max-w-sm mb-6">
                Unlike a standard AI, Valac builds a persistent memory of who
                you are — your projects, preferences, and context — and brings
                it to every conversation.
              </p>
              <div className="grid grid-cols-3 gap-3 max-w-md text-left mb-8">
                {[
                  {
                    title: 'Complete personalization',
                    body: 'Builds a profile of who you are — your goals, preferences, and context — and brings it to every reply.',
                  },
                  {
                    title: 'Fully private',
                    body: 'Runs entirely on your machine. Your conversations never leave your hardware.',
                  },
                  {
                    title: 'Transparent memory',
                    body: 'See exactly what it knows. Browse your topics and profile in the panel on the right.',
                  },
                ].map(({ title, body }) => (
                  <div
                    key={title}
                    className="rounded-xl border border-border/50 bg-secondary/30 p-3"
                  >
                    <p className="text-xs font-semibold text-primary mb-1">
                      {title}
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {body}
                    </p>
                  </div>
                ))}
              </div>
              <div className="w-full max-w-md">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground/50 mb-3">
                  Try asking
                </p>
                <div className="flex flex-col gap-2">
                  {[
                    'What do you remember about me so far?',
                    'What topics have we talked about the most?',
                    'Based on our conversations, what are my main goals?',
                    'Summarize what you know about my work.',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => onSuggestionClick(suggestion)}
                      className="w-full rounded-xl border border-border/50 bg-secondary/30 px-4 py-2.5 text-left text-sm text-muted-foreground hover:border-primary/40 hover:bg-secondary/60 hover:text-foreground hover:shadow-[0_0_12px_var(--glow)] transition-all duration-200"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-4',
                  message.role === 'user' ? 'flex-row-reverse' : '',
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    message.role === 'assistant'
                      ? 'bg-gradient-to-br from-primary/30 to-accent/30 text-primary shadow-[0_0_15px_var(--glow)]'
                      : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {message.role === 'assistant' ? (
                    <Sparkles className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </div>

                {/* Message Content */}
                <div
                  className={cn(
                    'flex-1 space-y-1 max-w-[80%]',
                    message.role === 'user' ? 'text-right' : '',
                  )}
                >
                  <div
                    className={cn(
                      'inline-block rounded-2xl px-4 py-3 text-sm leading-relaxed',
                      message.role === 'assistant'
                        ? 'bg-card border border-border/50 text-card-foreground'
                        : 'bg-primary/15 text-foreground border border-primary/20',
                    )}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // Tables
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-2">
                            <table className="text-xs border-collapse w-full">
                              {children}
                            </table>
                          </div>
                        ),
                        th: ({ children }) => (
                          <th className="border border-border/50 px-2 py-1 bg-muted/50 text-left font-medium">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border border-border/50 px-2 py-1">
                            {children}
                          </td>
                        ),
                        // Code blocks
                        code: ({
                          inline,
                          children,
                          ...props
                        }: {
                          inline?: boolean;
                          children?: React.ReactNode;
                        }) =>
                          inline ? (
                            <code
                              className="bg-muted/70 rounded px-1 py-0.5 text-xs font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          ) : (
                            <pre className="bg-muted/70 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono">
                              <code>{children}</code>
                            </pre>
                          ),
                        // Lists
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside space-y-0.5 my-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside space-y-0.5 my-1">
                            {children}
                          </ol>
                        ),
                        // Headings — scale them down since they're inside a chat bubble
                        h1: ({ children }) => (
                          <p className="font-semibold text-base mt-2 mb-1">
                            {children}
                          </p>
                        ),
                        h2: ({ children }) => (
                          <p className="font-semibold text-sm mt-2 mb-1">
                            {children}
                          </p>
                        ),
                        h3: ({ children }) => (
                          <p className="font-medium text-sm mt-1 mb-0.5">
                            {children}
                          </p>
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 px-1">
                    {message.timestamp}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Status Track */}
      <div className="px-6 pb-0">
        <StatusTrack lines={statusLines} isLoading={!!isLoading} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border bg-card p-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative flex items-end gap-3 rounded-2xl bg-background border-2 border-border p-3 focus-within:border-primary focus-within:shadow-[0_0_25px_var(--glow)] transition-all duration-300">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Valac..."
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              style={{ minHeight: '44px', maxHeight: '200px' }}
            />
            <div className="group relative shrink-0">
              <button
                type="button"
                onClick={() => onForgetfulChange(!forgetful)}
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200',
                  forgetful
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/50',
                )}
              >
                <EyeOff className="h-4 w-4" />
              </button>
              <div className="pointer-events-none absolute bottom-full right-0 mb-2 w-60 rounded-xl border border-border bg-popover px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground shadow-lg opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-50">
                {forgetful
                  ? "Forgetful mode is on — this conversation won't be saved to memory or used to update your profile."
                  : 'Forgetful mode is off — Valac will remember this conversation normally.'}
                <div className="absolute -bottom-1 right-3.5 h-2 w-2 rotate-45 border-b border-r border-border bg-popover" />
              </div>
            </div>
            <Button
              onClick={onSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className={cn(
                'h-10 w-10 rounded-xl transition-all duration-200 shrink-0',
                input.trim()
                  ? 'bg-primary text-primary-foreground shadow-[0_0_15px_var(--glow)]'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

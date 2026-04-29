'use client';

import { cn } from '@/lib/utils';
import { useRef, useEffect } from 'react';
import { Send, Sparkles, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  isLoading?: boolean;
}

export function ChatView({
  messages,
  input,
  onInputChange,
  onSend,
  isLoading,
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
                How can I help you today?
              </h1>
              <p className="text-muted-foreground text-sm max-w-md">
                Ask me anything. I&apos;m here to assist with questions,
                creative tasks, analysis, and more.
              </p>
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

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-accent/30 text-primary shadow-[0_0_15px_var(--glow)]">
                <Sparkles className="h-4 w-4 animate-pulse" />
              </div>
              <div className="flex items-center gap-1 px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-primary/50 animate-bounce" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-border/50 bg-card/50 p-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative flex items-end gap-3 rounded-2xl bg-secondary/50 border border-border/50 p-2 focus-within:border-primary/50 focus-within:shadow-[0_0_20px_var(--glow)] transition-all duration-300">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Valac..."
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              style={{
                minHeight: '40px',
                maxHeight: '200px',
              }}
            />
            <Button
              onClick={onSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className={cn(
                'h-10 w-10 rounded-xl transition-all duration-200',
                input.trim()
                  ? 'bg-primary text-primary-foreground shadow-[0_0_15px_var(--glow)]'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground/50">
            Valac AI can make mistakes. Consider checking important information.
          </p>
        </div>
      </div>
    </div>
  );
}

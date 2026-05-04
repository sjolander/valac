'use client';

import { cn } from '@/lib/utils';
import { Plus, MessageSquare, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Conversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
  isActive?: boolean;
}

interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: ConversationListProps) {
  const handleWipe = async () => {
    const confirm1 = window.confirm(
      'This will DELETE ALL DATA (messages, memory, topics). Continue?',
    );
    if (!confirm1) return;
    const confirm2 = window.confirm(
      'Last warning. This cannot be undone. Proceed?',
    );
    if (!confirm2) return;
    await fetch('http://localhost:8000/admin/wipe-all', {
      method: 'POST',
    });
    window.location.reload();
  };
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <h2 className="text-lg font-medium tracking-wide text-muted-foreground">
          Conversations
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewChat}
          className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => onSelect(conversation.id)}
              className={cn(
                'w-full rounded-lg p-3 text-left transition-all duration-200',
                'hover:bg-secondary/80 group',
                activeId === conversation.id
                  ? 'bg-secondary border border-primary/30 shadow-[0_0_15px_var(--glow)]'
                  : 'border border-transparent',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 rounded-md p-1.5 transition-colors',
                    activeId === conversation.id
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3
                      className={cn(
                        'text-sm font-medium truncate transition-colors',
                        activeId === conversation.id
                          ? 'text-foreground'
                          : 'text-muted-foreground group-hover:text-foreground',
                      )}
                    >
                      {conversation.title}
                    </h3>
                    <div
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                    {conversation.preview}
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    {conversation.timestamp}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={handleWipe}
        style={{
          marginLeft: 'auto',
          background: 'red',
          color: 'white',
          padding: '6px 10px',
          borderRadius: 6,
          border: 'none',
          margin: '10px',
          cursor: 'pointer',
        }}
      >
        Wipe DB
      </button>
    </div>
  );
}

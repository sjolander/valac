'use client';

import { cn } from '@/lib/utils';
import { Network } from 'lucide-react';

export interface Tag {
  id: string;
  label: string;
  connections: string[];
  relevance: number;
}

interface TagsPanelProps {
  tags: Tag[];
  onTagClick: (tag: Tag) => void;
}

export function TagsPanel({ tags, onTagClick: onTagClick }: TagsPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <h2 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Topics
        </h2>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <Network className="h-3 w-3" />
          <span>{tags.length}</span>
        </div>
      </div>

      {/* Tags List */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() => onTagClick(tag)}
              className={cn(
                'w-full rounded-xl p-3 text-left transition-all duration-200',
                'border border-transparent hover:border-primary/30',
                'bg-secondary/50 hover:bg-secondary',
                'hover:shadow-[0_0_15px_var(--glow)]',
                'group',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {tag.label}
                </span>
                <div
                  className="h-2 w-2 rounded-full bg-primary/50"
                  style={{
                    opacity: tag.relevance,
                    boxShadow: `0 0 ${tag.relevance * 10}px var(--glow)`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tag.connections.slice(0, 3).map((conn, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {conn}
                  </span>
                ))}
                {tag.connections.length > 3 && (
                  <span className="inline-flex items-center rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    +{tag.connections.length - 3}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

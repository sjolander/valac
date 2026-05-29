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
  activeTagIds?: Set<string>; // tags active in the current conversation
  selectedTagId?: string | null; // tag the user has clicked (tag→conv direction)
  onTagClick: (tag: Tag) => void;
}

export function TagsPanel({
  tags,
  activeTagIds,
  selectedTagId,
  onTagClick,
}: TagsPanelProps) {
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
          {tags.map((tag) => {
            const isActive = activeTagIds?.has(tag.id) ?? false;
            const isSelected = selectedTagId === tag.id;

            return (
              <button
                key={tag.id}
                onClick={() => onTagClick(tag)}
                className={cn(
                  'w-full rounded-xl p-3 text-left transition-all duration-200',
                  'border hover:border-primary/30',
                  'hover:shadow-[0_0_15px_var(--glow)]',
                  'group',
                  isSelected
                    ? 'border-primary/60 bg-primary/10 shadow-[0_0_12px_var(--glow)]'
                    : isActive
                      ? 'border-primary/30 bg-secondary'
                      : 'border-transparent bg-secondary/50 hover:bg-secondary',
                )}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'text-sm font-medium transition-colors',
                      isSelected
                        ? 'text-primary'
                        : isActive
                          ? 'text-primary/80'
                          : 'text-foreground group-hover:text-primary',
                    )}
                  >
                    {tag.label}
                  </span>
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{
                      opacity: isActive || isSelected ? 1 : tag.relevance,
                      backgroundColor: isSelected
                        ? 'var(--primary)'
                        : 'color-mix(in srgb, var(--primary) 50%, transparent)',
                      boxShadow:
                        isActive || isSelected
                          ? `0 0 ${tag.relevance * 14}px var(--glow)`
                          : `0 0 ${tag.relevance * 10}px var(--glow)`,
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

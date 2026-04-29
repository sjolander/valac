"use client";

import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, Network } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Topic {
  id: string;
  label: string;
  connections: string[];
  relevance: number;
}

interface TopicsPanelProps {
  topics: Topic[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onTopicClick: (topic: Topic) => void;
}

export function TopicsPanel({
  topics,
  isExpanded,
  onToggleExpand,
  onTopicClick,
}: TopicsPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleExpand}
            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            {isExpanded ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Topics
          </h2>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <Network className="h-3 w-3" />
          <span>{topics.length}</span>
        </div>
      </div>

      {/* Topics List */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {topics.map((topic) => (
            <button
              key={topic.id}
              onClick={() => onTopicClick(topic)}
              className={cn(
                "w-full rounded-xl p-3 text-left transition-all duration-200",
                "border border-transparent hover:border-primary/30",
                "bg-secondary/50 hover:bg-secondary",
                "hover:shadow-[0_0_15px_var(--glow)]",
                "group"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                  {topic.label}
                </span>
                <div
                  className="h-2 w-2 rounded-full bg-primary/50"
                  style={{
                    opacity: topic.relevance,
                    boxShadow: `0 0 ${topic.relevance * 10}px var(--glow)`,
                  }}
                />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {topic.connections.slice(0, 3).map((conn, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {conn}
                  </span>
                ))}
                {topic.connections.length > 3 && (
                  <span className="inline-flex items-center rounded-md bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    +{topic.connections.length - 3}
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

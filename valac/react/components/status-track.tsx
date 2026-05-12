'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface StatusTrackProps {
  lines: string[];
  isLoading: boolean;
}

export function StatusTrack({ lines, isLoading }: StatusTrackProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Always scroll to show the latest node
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div
      className={cn(
        'mx-auto max-w-3xl mb-3 transition-opacity duration-500',
        !isLoading && 'opacity-40',
      )}
    >
      <div
        ref={scrollRef}
        className="flex items-center gap-0 overflow-x-auto scrollbar-none rounded-xl border border-primary/20 bg-primary/5 px-4 py-3"
        style={{ scrollbarWidth: 'none' }}
      >
        {lines.map((line, i) => {
          const isActive = i === lines.length - 1 && isLoading;
          const isPast = i < lines.length - 1;

          return (
            <div key={i} className="flex items-center shrink-0">
              {/* Node */}
              <div className="relative flex items-center">
                {/* Pulse ring on active node */}
                {isActive && (
                  <span className="absolute inset-0 rounded-full animate-ping bg-primary/30" />
                )}
                <div
                  className={cn(
                    'relative rounded-full px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-all duration-300',
                    isActive &&
                      'bg-primary/25 text-primary border border-primary/60 shadow-[0_0_12px_var(--glow)]',
                    isPast &&
                      'bg-primary/10 text-primary/50 border border-primary/20',
                    !isActive &&
                      !isPast &&
                      'bg-primary/15 text-primary/70 border border-primary/30',
                  )}
                >
                  {line}
                </div>
              </div>

              {/* Connector */}
              {i < lines.length - 1 && (
                <div className="relative mx-1 h-px w-6 shrink-0 overflow-hidden bg-primary/15">
                  <div
                    className="absolute inset-y-0 left-0 w-full bg-primary/40"
                    style={{
                      animation: 'signal-travel 1.2s ease-in-out infinite',
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes signal-travel {
          0% {
            transform: translateX(-100%);
            opacity: 0;
          }
          30% {
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translateX(100%);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

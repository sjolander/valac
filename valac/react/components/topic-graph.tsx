'use client';

import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Tag } from './topics-panel';
import React from 'react';
import { useRef, useEffect, useMemo, useState } from 'react';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonalFact {
  id: string;
  label: string; // the fact sentence
  category: string; // identity | occupation | skill | preference | relationship | goal | context
  canonical_key: string;
  version: number;
  previous_fact: string | null;
  confidence: number;
  times_seen: number;
}

interface TagGraphProps {
  tags: Tag[];
  personalFacts?: PersonalFact[];
  activeConversationTagIds?: Set<string>;
  onClose: () => void;
}

interface GraphNode {
  id: string;
  label: string;
  relevance: number;
  type: 'tag' | 'personal';
  category?: string;
  previousFact?: string | null;
  version?: number;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

// ---------------------------------------------------------------------------
// Hex geometry helpers
// ---------------------------------------------------------------------------

function hexVertices(cx: number, cy: number, r: number): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }) as [number, number][];
}

function drawRoundedHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  radius: number,
) {
  const verts = hexVertices(cx, cy, r);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x0, y0] = verts[i];
    const [x1, y1] = verts[(i + 1) % 6];
    const [x2, y2] = verts[(i + 2) % 6];
    const ex = x1 + (x0 - x1) * (radius / r);
    const ey = y1 + (y0 - y1) * (radius / r);
    const fx = x1 + (x2 - x1) * (radius / r);
    const fy = y1 + (y2 - y1) * (radius / r);
    if (i === 0) ctx.moveTo(ex, ey);
    else ctx.lineTo(ex, ey);
    ctx.quadraticCurveTo(x1, y1, fx, fy);
  }
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TagGraph = React.memo(function TagGraph({
  tags,
  personalFacts = [],
  activeConversationTagIds,
  onClose,
}: TagGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 500, height: 600 });

  // ── Graph data ─────────────────────────────────────────────────────────────
  const data = useMemo(() => {
    // Tag nodes
    const nodes: GraphNode[] = tags.map((t) => ({
      id: t.id,
      label: t.label,
      relevance: t.relevance,
      type: 'tag',
    }));

    // Personal fact nodes — fixed relevance so they're a consistent size
    for (const f of personalFacts) {
      nodes.push({
        id: `pf:${f.id}`,
        label: f.label,
        relevance: 0.75,
        type: 'personal',
        category: f.category,
        previousFact: f.previous_fact,
        version: f.version,
      });
    }

    // Tag ↔ tag links (existing logic)
    const links: GraphLink[] = [];
    const byLabel = new Map(tags.map((t) => [t.label.toLowerCase(), t.id]));

    tags.forEach((tag) => {
      tag.connections.forEach((conn) => {
        const targetId = byLabel.get(conn.toLowerCase());
        if (!targetId) return;
        const exists = links.some(
          (l) =>
            (l.source === tag.id && l.target === targetId) ||
            (l.source === targetId && l.target === tag.id),
        );
        if (!exists) links.push({ source: tag.id, target: targetId });
      });
    });

    // Personal fact intra-category links — cluster facts of the same category
    const byCategory = new Map<string, string[]>();
    for (const f of personalFacts) {
      const nodeId = `pf:${f.id}`;
      const arr = byCategory.get(f.category) ?? [];
      arr.push(nodeId);
      byCategory.set(f.category, arr);
    }
    for (const members of byCategory.values()) {
      // Connect each pair within category (chain for large groups, full mesh for small)
      if (members.length <= 4) {
        for (let i = 0; i < members.length; i++)
          for (let j = i + 1; j < members.length; j++)
            links.push({ source: members[i], target: members[j] });
      } else {
        // Chain to avoid hairball
        for (let i = 0; i < members.length - 1; i++)
          links.push({ source: members[i], target: members[i + 1] });
      }
    }

    return { nodes, links };
  }, [tags, personalFacts]);

  useEffect(() => {
    const t = setTimeout(() => graphRef.current?.zoomToFit(400), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleZoomIn = () => {
    const z = graphRef.current?.zoom();
    graphRef.current?.zoom(z * 1.5, 300);
  };
  const handleZoomOut = () => {
    const z = graphRef.current?.zoom();
    graphRef.current?.zoom(z / 1.5, 300);
  };

  // ── Colour constants ───────────────────────────────────────────────────────
  const GREEN_DIM = 'rgba(74, 222, 128, 0.55)';
  const GREEN_BRIGHT = 'rgba(74, 222, 128, 1.0)';
  const GREEN_TEXT = 'rgba(74, 222, 128, 0.85)';
  const BLACK_FILL = 'rgba(0, 0, 0, 0.92)';
  const LINK_COLOR = 'rgba(74, 222, 128, 0.15)';
  const LINK_PARTICLE = 'rgba(74, 222, 128, 0.5)';

  // Gold palette — amber-400 family
  const GOLD_FILL = 'rgba(251, 191, 36, 0.12)';
  const GOLD_BORDER = 'rgba(251, 191, 36, 0.9)';
  const GOLD_GLOW = 'rgba(251, 191, 36, 0.6)';
  const GOLD_TEXT = 'rgba(251, 191, 36, 0.95)';
  const GOLD_LINK = 'rgba(251, 191, 36, 0.12)';
  const GOLD_PARTICLE = 'rgba(251, 191, 36, 0.45)';

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {tags.length} tags
            {personalFacts.length > 0 && (
              <>
                {' '}
                ·{' '}
                <span className="text-amber-400">
                  {personalFacts.length} known facts
                </span>
              </>
            )}
            · {data.links.length} connections
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Graph */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <ForceGraph2D
          ref={graphRef}
          graphData={data}
          // Tooltip — shows version arc for personal facts
          nodeLabel={(rawNode) => {
            const node = rawNode as GraphNode;
            if (node.type !== 'personal') return node.label;
            const arc = node.previousFact
              ? `${node.label}\n↑ previously: ${node.previousFact}`
              : node.label;
            return arc;
          }}
          // Link styling — gold for personal fact links, green for tag links
          linkColor={(link) => {
            const src =
              typeof link.source === 'object'
                ? (link.source as GraphNode).id
                : String(link.source);
            return src.startsWith('pf:') ? GOLD_LINK : LINK_COLOR;
          }}
          linkWidth={1}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={(link) => {
            const src =
              typeof link.source === 'object'
                ? (link.source as GraphNode).id
                : String(link.source);
            return src.startsWith('pf:') ? GOLD_PARTICLE : LINK_PARTICLE;
          }}
          backgroundColor="transparent"
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(rawNode, ctx, globalScale) => {
            const node = rawNode as GraphNode;
            const isPersonal = node.type === 'personal';
            const active =
              !isPersonal && (activeConversationTagIds?.has(node.id) ?? false);

            const r = (6 + node.relevance * 4) / globalScale;
            const corner = r * 0.18;
            const cx = node.x ?? 0;
            const cy = node.y ?? 0;

            // ── Personal fact node ──────────────────────────────────────
            if (isPersonal) {
              // Always-on glow
              ctx.save();
              ctx.shadowColor = GOLD_GLOW;
              ctx.shadowBlur = 14 / globalScale;

              // Gold-tinted fill
              drawRoundedHex(ctx, cx, cy, r, corner);
              ctx.fillStyle = GOLD_FILL;
              ctx.fill();

              // Gold border
              drawRoundedHex(ctx, cx, cy, r, corner);
              ctx.strokeStyle = GOLD_BORDER;
              ctx.lineWidth = 1.8 / globalScale;
              ctx.stroke();

              // Version pip — small dot in upper-right vertex if versioned
              if ((node.version ?? 1) > 1) {
                const angle = -Math.PI / 6; // upper-right hex vertex
                const px = cx + r * 0.72 * Math.cos(angle);
                const py = cy + r * 0.72 * Math.sin(angle);
                ctx.beginPath();
                ctx.arc(px, py, 2 / globalScale, 0, Math.PI * 2);
                ctx.fillStyle = GOLD_BORDER;
                ctx.fill();
              }

              ctx.restore();

              // Label
              const fontSize = Math.max(10, 10) / globalScale;
              ctx.font = `500 ${fontSize}px ui-monospace, monospace`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.fillStyle = GOLD_TEXT;

              // Truncate long fact sentences for the graph label
              const maxChars = Math.floor(28 * globalScale);
              const display =
                node.label.length > maxChars
                  ? node.label.slice(0, maxChars) + '…'
                  : node.label;
              ctx.fillText(display, cx, cy + r + 3 / globalScale);
              return;
            }

            // ── Regular tag node (unchanged) ────────────────────────────
            if (active) {
              ctx.save();
              ctx.shadowColor = GREEN_BRIGHT;
              ctx.shadowBlur = 18 / globalScale;
            }

            drawRoundedHex(ctx, cx, cy, r, corner);
            ctx.fillStyle = BLACK_FILL;
            ctx.fill();

            drawRoundedHex(ctx, cx, cy, r, corner);
            ctx.strokeStyle = active ? GREEN_BRIGHT : GREEN_DIM;
            ctx.lineWidth = (active ? 1.8 : 1.2) / globalScale;
            ctx.stroke();

            if (active) ctx.restore();

            const fontSize = Math.max(10, 11) / globalScale;
            ctx.font = `${active ? 600 : 400} ${fontSize}px ui-monospace, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = active ? GREEN_BRIGHT : GREEN_TEXT;
            ctx.fillText(node.label, cx, cy + r + 3 / globalScale);
          }}
          nodeRelSize={6}
          nodeVal={(node) => (node as GraphNode).relevance * 4 + 1}
          width={dims.width}
          height={dims.height}
          cooldownTicks={120}
          onEngineStop={() => graphRef.current?.zoomToFit(400)}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_100%)] opacity-25" />
      </div>

      {/* Legend */}
      {personalFacts.length > 0 && (
        <div className="flex items-center gap-4 border-t border-border/30 px-4 py-2">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-sm border border-green-400/60 bg-black/90" />
            <span className="text-[10px] text-muted-foreground">
              memory tag
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-sm border border-amber-400/90 bg-amber-400/10" />
            <span className="text-[10px] text-amber-400/80">
              known about you
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

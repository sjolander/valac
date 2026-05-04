'use client';

import { useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Tag } from './topics-panel';
import React from 'react';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

interface TagGraphProps {
  tags: Tag[];
  activeConversationTagIds?: Set<string>;
  onClose: () => void;
}

interface GraphNode {
  id: string;
  label: string;
  relevance: number;
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
    const angle = (Math.PI / 3) * i - Math.PI / 6; // flat-top orientation
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }) as [number, number][];
}

function drawRoundedHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  radius: number, // corner rounding radius
) {
  const verts = hexVertices(cx, cy, r);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const [x0, y0] = verts[i];
    const [x1, y1] = verts[(i + 1) % 6];
    const [x2, y2] = verts[(i + 2) % 6];

    // Entry point on edge i→i+1 (near end)
    const ex = x1 + (x0 - x1) * (radius / r);
    const ey = y1 + (y0 - y1) * (radius / r);

    // Exit point on edge i+1→i+2 (near start)
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
  activeConversationTagIds,
  onClose,
}: TagGraphProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const data = useMemo(() => {
    const nodes: GraphNode[] = tags.map((t) => ({
      id: t.id,
      label: t.label,
      relevance: t.relevance,
    }));

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

    return { nodes, links };
  }, [tags]);

  useEffect(() => {
    const t = setTimeout(() => graphRef.current?.zoomToFit(400), 500);
    return () => clearTimeout(t);
  }, []);

  const handleZoomIn = () => {
    const z = graphRef.current?.zoom();
    graphRef.current?.zoom(z * 1.5, 300);
  };
  const handleZoomOut = () => {
    const z = graphRef.current?.zoom();
    graphRef.current?.zoom(z / 1.5, 300);
  };

  // ── Colour constants ──────────────────────────────────────────────────────
  const GREEN_DIM = 'rgba(74, 222, 128, 0.55)'; // inactive outline
  const GREEN_BRIGHT = 'rgba(74, 222, 128, 1.0)'; // active outline + text
  const GREEN_TEXT = 'rgba(74, 222, 128, 0.85)'; // inactive text
  const BLACK_FILL = 'rgba(0, 0, 0, 0.92)';
  const LINK_COLOR = 'rgba(74, 222, 128, 0.15)';
  const LINK_PARTICLE = 'rgba(74, 222, 128, 0.5)';

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium tracking-wide text-foreground">
            Tag Network
          </h2>
          <span className="text-xs text-muted-foreground">
            {data.nodes.length} tags · {data.links.length} connections
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
          nodeLabel={(node) => (node as GraphNode).label}
          linkColor={() => LINK_COLOR}
          linkWidth={1}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={1.5}
          linkDirectionalParticleColor={() => LINK_PARTICLE}
          backgroundColor="transparent"
          // Suppress default circle drawing entirely
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={(rawNode, ctx, globalScale) => {
            const node = rawNode as GraphNode;
            const active = activeConversationTagIds?.has(node.id) ?? false;
            const r = (6 + node.relevance * 4) / globalScale;
            const corner = r * 0.18;
            const cx = node.x ?? 0;
            const cy = node.y ?? 0;

            // Glow for active nodes
            if (active) {
              ctx.save();
              ctx.shadowColor = GREEN_BRIGHT;
              ctx.shadowBlur = 18 / globalScale;
            }

            // Fill
            drawRoundedHex(ctx, cx, cy, r, corner);
            ctx.fillStyle = BLACK_FILL;
            ctx.fill();

            // Outline
            drawRoundedHex(ctx, cx, cy, r, corner);
            ctx.strokeStyle = active ? GREEN_BRIGHT : GREEN_DIM;
            ctx.lineWidth = (active ? 1.8 : 1.2) / globalScale;
            ctx.stroke();

            if (active) ctx.restore();

            // Label — centred below hex
            const fontSize = Math.max(10, 11) / globalScale;
            ctx.font = `${active ? 600 : 400} ${fontSize}px ui-monospace, monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = active ? GREEN_BRIGHT : GREEN_TEXT;
            ctx.fillText(node.label, cx, cy + r + 3 / globalScale);
          }}
          // Give the force sim a pointer-size hint based on hex radius
          nodeRelSize={6}
          nodeVal={(node) => (node as GraphNode).relevance * 4 + 1}
          width={containerRef.current?.clientWidth || 800}
          height={containerRef.current?.clientHeight || 600}
          cooldownTicks={120}
          onEngineStop={() => graphRef.current?.zoomToFit(400)}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_100%)] opacity-25" />
      </div>
    </div>
  );
});

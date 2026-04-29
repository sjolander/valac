'use client';

import { useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Topic } from './topics-panel';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

interface TopicGraphProps {
  topics: Topic[];
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

export function TopicGraph({ topics, onClose }: TopicGraphProps) {
  const graphRef =
    useRef<
      ReturnType<typeof ForceGraph2D> extends React.ComponentType<infer P>
        ? { zoomToFit: (duration: number) => void }
        : never
    >(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Build graph data from topics
  const graphData = useCallback(() => {
    const nodes: GraphNode[] = topics.map((topic) => ({
      id: topic.id,
      label: topic.label,
      relevance: topic.relevance,
    }));

    const links: GraphLink[] = [];
    const nodeIds = new Set(topics.map((t) => t.id));

    topics.forEach((topic) => {
      topic.connections.forEach((conn) => {
        const connectedTopic = topics.find(
          (t) => t.label.toLowerCase() === conn.toLowerCase(),
        );
        if (connectedTopic && nodeIds.has(connectedTopic.id)) {
          // Avoid duplicate links
          const linkExists = links.some(
            (l) =>
              (l.source === topic.id && l.target === connectedTopic.id) ||
              (l.source === connectedTopic.id && l.target === topic.id),
          );
          if (!linkExists) {
            links.push({
              source: topic.id,
              target: connectedTopic.id,
            });
          }
        }
      });
    });

    return { nodes, links };
  }, [topics]);

  useEffect(() => {
    // Zoom to fit after initial render
    const timeout = setTimeout(() => {
      if (graphRef.current) {
        graphRef.current.zoomToFit(400);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, []);

  const handleZoomIn = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fg = graphRef.current as any;
    if (fg) {
      const currentZoom = fg.zoom();
      fg.zoom(currentZoom * 1.5, 300);
    }
  };

  const handleZoomOut = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fg = graphRef.current as any;
    if (fg) {
      const currentZoom = fg.zoom();
      fg.zoom(currentZoom / 1.5, 300);
    }
  };

  const data = graphData();

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium tracking-wide text-foreground">
            Topic Network
          </h2>
          <span className="text-xs text-muted-foreground">
            {data.nodes.length} topics • {data.links.length} connections
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

      {/* Graph Container */}
      <div ref={containerRef} className="relative flex-1 overflow-hidden">
        <ForceGraph2D
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={graphRef as any}
          graphData={data}
          nodeLabel={(node: GraphNode) => node.label}
          nodeColor={() => 'rgba(56, 189, 248, 0.8)'}
          nodeRelSize={8}
          nodeVal={(node: GraphNode) => node.relevance * 3 + 1}
          linkColor={() => 'rgba(56, 189, 248, 0.2)'}
          linkWidth={1.5}
          linkDirectionalParticles={2}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={() => 'rgba(56, 189, 248, 0.6)'}
          backgroundColor="transparent"
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
            const label = node.label;
            const fontSize = 12 / globalScale;
            ctx.font = `500 ${fontSize}px Geist, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + 16 / globalScale);
          }}
          width={containerRef.current?.clientWidth || 800}
          height={containerRef.current?.clientHeight || 600}
          cooldownTicks={100}
          onEngineStop={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fg = graphRef.current as any;
            if (fg) fg.zoomToFit(400);
          }}
        />

        {/* Overlay gradient for depth */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_100%)] opacity-30" />
      </div>
    </div>
  );
}

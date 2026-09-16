import { useEffect, useRef } from "react";
import type { VaultGraph } from "@mental-lab/shared";

const TYPE_COLORS: Record<string, string> = {
  person: "#8aa0f4",
  org: "#d9973f",
  project: "#5bae7f",
  topic: "#f2aecb",
  paper: "#c7b2f2",
  other: "#9a9da8",
};

interface SimNode {
  id: string;
  type: string;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphViewProps {
  graph: VaultGraph;
  onOpenNote: (name: string) => void;
}

export default function GraphView({ graph, onOpenNote }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const parent = canvas.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    let width = parent.clientWidth;
    let height = parent.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    const nodes: SimNode[] = graph.nodes.map((n, i) => {
      const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.3;
      return {
        id: n.id,
        type: n.type,
        degree: n.degree,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = graph.edges
      .map((e) => ({ from: byId.get(e.from), to: byId.get(e.to) }))
      .filter((e): e is { from: SimNode; to: SimNode } => !!e.from && !!e.to);

    let hovered: SimNode | null = null;
    let frame = 0;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const maxFrames = reduceMotion ? 0 : 300;
    let raf = 0;

    function nodeRadius(n: SimNode): number {
      return 5 + Math.min(9, n.degree * 1.5);
    }

    function step() {
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = Math.max(100, dx * dx + dy * dy);
          const force = 2600 / distSq;
          const dist = Math.sqrt(distSq);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      // Springs
      for (const edge of edges) {
        const dx = edge.to.x - edge.from.x;
        const dy = edge.to.y - edge.from.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - 110) * 0.004;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        edge.from.vx += fx;
        edge.from.vy += fy;
        edge.to.vx -= fx;
        edge.to.vy -= fy;
      }
      // Centering + integrate
      for (const n of nodes) {
        n.vx += (width / 2 - n.x) * 0.0015;
        n.vy += (height / 2 - n.y) * 0.0015;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    function draw() {
      const styles = getComputedStyle(document.documentElement);
      const lineColor = styles.getPropertyValue("--line").trim();
      const inkColor = styles.getPropertyValue("--ink").trim();

      ctx!.clearRect(0, 0, width, height);
      ctx!.strokeStyle = lineColor;
      ctx!.lineWidth = 1;
      for (const edge of edges) {
        ctx!.beginPath();
        ctx!.moveTo(edge.from.x, edge.from.y);
        ctx!.lineTo(edge.to.x, edge.to.y);
        ctx!.stroke();
      }
      for (const n of nodes) {
        ctx!.beginPath();
        ctx!.fillStyle = TYPE_COLORS[n.type] ?? TYPE_COLORS.other!;
        ctx!.arc(n.x, n.y, nodeRadius(n), 0, Math.PI * 2);
        ctx!.fill();
      }
      // Labels: hovered node, or all when the vault is small
      ctx!.fillStyle = inkColor;
      ctx!.font = "11px ui-monospace, monospace";
      ctx!.textAlign = "center";
      for (const n of nodes) {
        if (hovered === n || nodes.length <= 30) {
          ctx!.fillText(n.id, n.x, n.y - nodeRadius(n) - 5);
        }
      }
    }

    function loop() {
      if (frame < maxFrames) {
        step();
        frame++;
      }
      draw();
      raf = requestAnimationFrame(loop);
    }
    if (reduceMotion) {
      for (let i = 0; i < 300; i++) step();
    }
    loop();

    function findNode(x: number, y: number): SimNode | null {
      for (const n of nodes) {
        if (Math.hypot(n.x - x, n.y - y) <= nodeRadius(n) + 3) return n;
      }
      return null;
    }

    const onMove = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      hovered = findNode(e.clientX - rect.left, e.clientY - rect.top);
      canvas!.style.cursor = hovered ? "pointer" : "default";
    };
    const onClick = (e: MouseEvent) => {
      const rect = canvas!.getBoundingClientRect();
      const node = findNode(e.clientX - rect.left, e.clientY - rect.top);
      if (node) onOpenNote(node.id);
    };
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);

    const resize = new ResizeObserver(() => {
      width = parent.clientWidth;
      height = parent.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    });
    resize.observe(parent);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
      resize.disconnect();
    };
  }, [graph, onOpenNote]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}

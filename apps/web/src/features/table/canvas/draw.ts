import { hexCorners, hexRadius, type FogShape, type GridSettings } from "@vtt/rules";
import type { FogOpDto } from "../types";

export interface ViewBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Draws only the grid lines inside the visible area, so huge maps stay cheap. */
export function drawGrid(c: CanvasRenderingContext2D, g: GridSettings, w: number, h: number, view: ViewBounds, scale: number) {
  if (g.type === "none" || g.size < 4) return;
  const x0 = Math.max(0, view.x0);
  const y0 = Math.max(0, view.y0);
  const x1 = Math.min(w, view.x1);
  const y1 = Math.min(h, view.y1);
  if (x1 <= x0 || y1 <= y0) return;
  c.save();
  c.beginPath();
  c.rect(0, 0, w, h);
  c.clip();
  c.strokeStyle = g.color;
  c.globalAlpha = g.opacity;
  c.lineWidth = 1 / scale;
  c.beginPath();
  if (g.type === "square") {
    const startX = g.offsetX + Math.floor((x0 - g.offsetX) / g.size) * g.size;
    for (let x = startX; x <= x1; x += g.size) {
      c.moveTo(x, y0);
      c.lineTo(x, y1);
    }
    const startY = g.offsetY + Math.floor((y0 - g.offsetY) / g.size) * g.size;
    for (let y = startY; y <= y1; y += g.size) {
      c.moveTo(x0, y);
      c.lineTo(x1, y);
    }
  } else {
    const r = hexRadius(g.size);
    const rowH = r * 1.5;
    const rStart = Math.floor((y0 - g.offsetY) / rowH) - 1;
    const rEnd = Math.ceil((y1 - g.offsetY) / rowH) + 1;
    for (let row = rStart; row <= rEnd; row++) {
      const cy = g.offsetY + row * rowH;
      const shift = (row & 1) * (g.size / 2);
      const cStart = Math.floor((x0 - g.offsetX - shift) / g.size) - 1;
      const cEnd = Math.ceil((x1 - g.offsetX - shift) / g.size) + 1;
      for (let col = cStart; col <= cEnd; col++) {
        const pts = hexCorners({ x: g.offsetX + shift + col * g.size, y: cy }, g.size);
        // Three edges per hex are enough to draw the whole tiling once.
        c.moveTo(pts[5]!.x, pts[5]!.y);
        c.lineTo(pts[0]!.x, pts[0]!.y);
        c.lineTo(pts[1]!.x, pts[1]!.y);
        c.lineTo(pts[2]!.x, pts[2]!.y);
      }
    }
  }
  c.stroke();
  c.restore();
}

export function traceShape(c: CanvasRenderingContext2D, s: FogShape) {
  c.beginPath();
  if (s.kind === "rect") c.rect(s.x, s.y, s.width, s.height);
  else if (s.kind === "circle") c.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
  else {
    s.points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)));
    c.closePath();
  }
}

/**
 * Fog: start fully covered, then apply reveal (erase) / hide (paint) shapes in order.
 * Must be drawn on its own layer since reveals erase pixels.
 */
export function drawFog(c: CanvasRenderingContext2D, ops: FogOpDto[], w: number, h: number, color: string) {
  c.save();
  c.fillStyle = color;
  c.globalCompositeOperation = "source-over";
  c.fillRect(0, 0, w, h);
  for (const op of ops) {
    c.globalCompositeOperation = op.mode === "reveal" ? "destination-out" : "source-over";
    traceShape(c, op.shape);
    c.fill();
  }
  c.restore();
}

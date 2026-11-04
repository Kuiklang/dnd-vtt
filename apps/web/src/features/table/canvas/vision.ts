import { visibilityPolygon, type Point, type ViewerSight } from "@vtt/rules";

/** Pre-computed shapes for drawing one viewer's darkness (recomputed only when things move). */
export interface VisionShapes {
  ambient: ViewerSight["ambient"];
  eyes: Array<{ poly: Point[]; x: number; y: number; darkvisionPx: number }>;
  lights: Array<{ poly: Point[]; x: number; y: number; brightPx: number; dimPx: number }>;
}

export function visionShapes(s: ViewerSight, width: number, height: number): VisionShapes {
  const far = Math.hypot(width, height);
  const bounds = { width, height };
  return {
    ambient: s.ambient,
    eyes: s.eyes.map((e) => ({ ...e, poly: visibilityPolygon(e, s.walls, far, bounds) })),
    // Lights matter only in the dark (in bright/dim ambient light everything in sight is lit).
    lights: s.ambient === "dark" ? s.lights.map((l) => ({ ...l, poly: visibilityPolygon(l, s.walls, l.dimPx, bounds) })) : [],
  };
}

function trace(c: CanvasRenderingContext2D, poly: Point[]) {
  c.beginPath();
  poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

/**
 * Darkness over everything a viewer can't see. Drawn on its own layer: fill black, then
 * cut out (destination-out) what each eye sees: everything in its line of sight when the
 * scene is lit, otherwise only its darkvision range and the lit areas of lights it can see.
 * Dim light and darkvision leave a little shade, as they're "lightly obscured".
 */
export function drawDarkness(c: CanvasRenderingContext2D, v: VisionShapes, width: number, height: number, color: string) {
  c.save();
  c.fillStyle = color;
  c.fillRect(0, 0, width, height);
  c.globalCompositeOperation = "destination-out";
  for (const eye of v.eyes) {
    c.save();
    trace(c, eye.poly);
    c.clip();
    if (v.ambient !== "dark") {
      c.globalAlpha = v.ambient === "bright" ? 1 : 0.8;
      c.fillRect(0, 0, width, height);
    } else {
      if (eye.darkvisionPx > 0) {
        c.globalAlpha = 0.75;
        c.beginPath();
        c.arc(eye.x, eye.y, eye.darkvisionPx, 0, Math.PI * 2);
        c.fill();
      }
      for (const l of v.lights) {
        c.save();
        trace(c, l.poly);
        c.clip();
        c.globalAlpha = 1;
        const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.dimPx);
        const edge = l.dimPx > 0 ? Math.min(1, l.brightPx / l.dimPx) : 1;
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(Math.max(0, edge - 0.001), "rgba(0,0,0,1)");
        g.addColorStop(Math.min(1, edge + 0.001), "rgba(0,0,0,0.78)");
        g.addColorStop(0.985, "rgba(0,0,0,0.7)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(l.x, l.y, l.dimPx, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
    c.restore();
  }
  c.restore();
}

import { InterferenceMapData } from "@/types/beamforming";
import { useRef, useEffect, useState } from "react";
import "./HeatmapView.css";

interface HeatmapViewProps {
  data: InterferenceMapData;
  title?: string;
}

function valueToColor(value: number, max: number): [number, number, number] {
  // Intensity heatmap: near-zero should be nearly black.
  const safeMax = Math.max(max, 1e-12);
  const v = Math.max(0, value);
  // Log compression + gamma darkens background.
  const tLog = Math.min(Math.log1p(v) / Math.log1p(safeMax), 1);
  const t = Math.pow(tLog, 2.2);
  // black → deep purple → magenta → pink → white
  if (t < 0.2) {
    const s = t / 0.2;
    return [Math.round(2 + s * 18), Math.round(1 + s * 6), Math.round(4 + s * 28)];
  } else if (t < 0.5) {
    const s = (t - 0.2) / 0.3;
    return [Math.round(20 + s * 90), Math.round(7 + s * 18), Math.round(32 + s * 90)];
  } else if (t < 0.8) {
    const s = (t - 0.5) / 0.3;
    return [Math.round(110 + s * 95), Math.round(25 + s * 55), Math.round(122 + s * 50)];
  } else {
    const s = (t - 0.8) / 0.2;
    return [Math.round(205 + s * 50), Math.round(80 + s * 175), Math.round(172 + s * 83)];
  }
}

export default function HeatmapView({ data, title = "Interference Heatmap" }: HeatmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 320 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gridSize = data.grid.length;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(size.width * dpr));
    canvas.height = Math.max(1, Math.floor(size.height * dpr));
    const ctx = canvas.getContext("2d")!;
    const offscreen = document.createElement("canvas");
    // Show the top 58% of the displayed field.
    const TOP_FRACTION = 0.50;
    const sourceH = Math.max(1, Math.floor(gridSize * TOP_FRACTION));
    offscreen.width = gridSize;
    offscreen.height = sourceH;
    const offCtx = offscreen.getContext("2d")!;
    const imageData = offCtx.createImageData(offscreen.width, offscreen.height);

    for (let y = 0; y < offscreen.height; y++) {
      for (let x = 0; x < offscreen.width; x++) {
        // Keep map orientation consistent with previous full-view render:
        // screen-top corresponds to highest Y rows in the source grid.
        const sourceGridY = Math.max(0, Math.min(gridSize - 1, (gridSize - 1) - y));
        const [r, g, b] = valueToColor(data.grid[sourceGridY][x], data.maxVal);
        const idx = (y * offscreen.width + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
    offCtx.putImageData(imageData, 0, 0);

    // Smooth the field by upsampling once before final draw.
    const smoothCanvas = document.createElement("canvas");
    const UPSCALE = 4;
    smoothCanvas.width = Math.max(1, offscreen.width * UPSCALE);
    smoothCanvas.height = Math.max(1, offscreen.height * UPSCALE);
    const smoothCtx = smoothCanvas.getContext("2d")!;
    smoothCtx.imageSmoothingEnabled = true;
    smoothCtx.imageSmoothingQuality = "high";
    smoothCtx.drawImage(offscreen, 0, 0, smoothCanvas.width, smoothCanvas.height);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Render supersampled top-half field into full panel.
    ctx.drawImage(
      smoothCanvas,
      0,
      0,
      smoothCanvas.width,
      smoothCanvas.height,
      0,
      0,
      size.width,
      size.height
    );
  }, [data, size.width, size.height]);

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      {title ? (
        <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      ) : null}
      <div ref={hostRef} className="flex-1 relative min-h-0">
        <canvas
          ref={canvasRef}
          className="heatmap-canvas w-full h-full rounded-lg"
        />
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-mono text-muted-foreground/60">X Position</div>
        <div className="absolute top-1/2 left-1 -translate-y-1/2 text-[9px] font-mono text-muted-foreground/60 -rotate-90">Y Position</div>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-muted-foreground">Low</span>
        <div className="heatmap-gradient flex-1 h-1.5 rounded-full" />
        <span className="text-[9px] font-mono text-muted-foreground">High</span>
      </div>
    </div>
  );
}

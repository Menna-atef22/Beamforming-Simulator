import { InterferenceMapData } from "@/types/beamforming";
import { useMemo, useRef, useEffect } from "react";
import "./HeatmapView.css";

interface HeatmapViewProps {
  data: InterferenceMapData;
  title?: string;
}

function valueToColor(value: number, max: number): [number, number, number] {
  const t = Math.min(value / Math.max(max, 0.001), 1);
  // dark → deep purple → magenta → pink → white
  if (t < 0.2) {
    const s = t / 0.2;
    return [Math.round(15 + s * 25), Math.round(8 + s * 8), Math.round(30 + s * 40)];
  } else if (t < 0.45) {
    const s = (t - 0.2) / 0.25;
    return [Math.round(40 + s * 80), Math.round(16 + s * 10), Math.round(70 + s * 50)];
  } else if (t < 0.7) {
    const s = (t - 0.45) / 0.25;
    return [Math.round(120 + s * 80), Math.round(26 + s * 40), Math.round(120 + s * 20)];
  } else {
    const s = (t - 0.7) / 0.3;
    return [Math.round(200 + s * 55), Math.round(66 + s * 140), Math.round(140 + s * 115)];
  }
}

export default function HeatmapView({ data, title = "Interference Heatmap" }: HeatmapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = data.grid.length;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, g, b] = valueToColor(data.grid[size - 1 - y][x], data.maxVal);
        const idx = (y * size + x) * 4;
        imageData.data[idx] = r;
        imageData.data[idx + 1] = g;
        imageData.data[idx + 2] = b;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [data]);

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="flex-1 relative min-h-0">
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

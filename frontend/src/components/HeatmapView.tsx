import { InterferenceMapData, ArrayElement } from "@/types/beamforming";
import { useRef, useEffect, useState } from "react";
import "./HeatmapView.css";

interface HeatmapViewProps {
  data: InterferenceMapData;
  title?: string;
}

interface HeatmapViewPropsExtended extends HeatmapViewProps {
  array?: ArrayElement[];
  profileDepth?: number;
}

function valueToColor(value: number, max: number): [number, number, number] {
  // Enhanced contrast palette: Black (0.0) -> Dark Purple (0.3) -> Bright Purple (0.7) -> White (1.0)
  const t = Math.max(0, Math.min(1, value / (max || 1)));
  
  if (t < 0.3) {
    // 0.0 to 0.3: Black [0,0,0] to Dark Purple [60,0,80]
    const s = t / 0.3;
    return [
      Math.round(s * 60),
      0,
      Math.round(s * 80)
    ];
  } else if (t < 0.7) {
    // 0.3 to 0.7: Dark Purple [60,0,80] to Bright Purple [180,0,220]
    const s = (t - 0.3) / 0.4;
    return [
      Math.round(60 + s * 120),
      0,
      Math.round(80 + s * 140)
    ];
  } else {
    // 0.7 to 1.0: Bright Purple [180,0,220] to White [255,255,255]
    const s = (t - 0.7) / 0.3;
    return [
      Math.round(180 + s * 75),
      Math.round(s * 255),
      Math.round(220 + s * 35)
    ];
  }
}

export default function HeatmapView({ data, title = "Interference Heatmap", array, profileDepth }: HeatmapViewPropsExtended) {
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
    offscreen.width = gridSize;
    offscreen.height = gridSize;
    const offCtx = offscreen.getContext("2d")!;
    const imageData = offCtx.createImageData(offscreen.width, offscreen.height);

    // Determine brightness scaling from amplitude: use `maxValPerAmp` if available.
    // IMPORTANT: use a fixed color mapping vmax to avoid per-frame normalization
    // which cancels amplitude changes. We map values to [0, vmax_fixed].
    const maxPerAmp = data.maxValPerAmp ?? 1.0;
    const amplitudeScale = (typeof (data as any).amplitude === 'number' ? (data as any).amplitude : 1.0);
    const FIXED_REF_AMPLITUDE = 2.0; // reference amplitude for color mapping vmax

    for (let y = 0; y < offscreen.height; y++) {
      for (let x = 0; x < offscreen.width; x++) {
        // Keep map orientation consistent with previous full-view render:
        // screen-top corresponds to highest Y rows in the source grid.
        const sourceGridY = Math.max(0, Math.min(gridSize - 1, (gridSize - 1) - y));
        const rawVal = data.grid[sourceGridY][x];

        // Map raw grid value (absolute) to a scaled value reflecting current amplitude.
        const scaledVal = rawVal; // rawVal already includes amplitude in backend

        // To color map relative to fixed reference amplitude (vmax), avoid
        // normalizing by the current amplitude. This makes the visual brightness
        // respond to changes in `signal.amplitude`.
        const peak = Math.max(1e-12, maxPerAmp * FIXED_REF_AMPLITUDE);
        const [r, g, b] = valueToColor(scaledVal, peak);
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

    // Overlay array element markers and profile depth dashed line
    try {
      const xRange = data.xRange || [];
      const yRange = data.yRange || [];
      if (xRange.length >= 2 && yRange.length >= 2) {
        const xmin = xRange[0];
        const xmax = xRange[xRange.length - 1];
        const ymin = yRange[0];
        const ymax = yRange[yRange.length - 1];
        const width = size.width;
        const height = size.height;

        ctx.save();
        // Keep same transform as image draw (CSS pixels)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Draw dashed horizontal line for profile depth (if provided)
        if (typeof profileDepth === "number" && isFinite(profileDepth)) {
          const clamped = Math.max(ymin, Math.min(ymax, profileDepth));
          const py = ((ymax - clamped) / (ymax - ymin)) * height;
          ctx.beginPath();
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = "rgba(255,200,200,0.95)";
          ctx.lineWidth = 1.5;
          ctx.moveTo(0, py);
          ctx.lineTo(width, py);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw element markers
        if (Array.isArray(array) && array.length > 0) {
          for (const elem of array) {
            const ex = Number(elem.x || 0);
            const ey = Number(elem.y || 0);
            if (!isFinite(ex) || !isFinite(ey)) continue;
            // Map to CSS pixel coordinates
            const px = ((ex - xmin) / (xmax - xmin || 1)) * width;
            const py = ((ymax - ey) / (ymax - ymin || 1)) * height;

            ctx.beginPath();
            ctx.fillStyle = "rgba(255,192,255,0.95)";
            ctx.strokeStyle = "rgba(150,50,180,0.95)";
            ctx.lineWidth = 1.2;
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }

        ctx.restore();
      }
    } catch (e) {
      // Non-fatal overlay error - continue silently
      console.warn("Heatmap overlay draw error:", e);
    }
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

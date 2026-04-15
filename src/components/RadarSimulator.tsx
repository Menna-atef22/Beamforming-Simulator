/**
 * Radar Simulator Module
 *
 * - 360° rotating phased array beam
 * - Up to 5 draggable/resizable objects
 * - Beam width and scan speed controls
 * - Object detection when beam intersects
 * - PPI (Plan Position Indicator) display
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ParameterSlider } from "@/components/ParameterSlider";

interface RadarObject {
  id: number;
  x: number; // relative to center, in pixels
  y: number;
  size: number; // radius in pixels
}

const CANVAS_SIZE = 500;
const CENTER = CANVAS_SIZE / 2;
const MAX_RANGE = CENTER - 20;

let nextId = 1;

export function RadarSimulator() {
  const [objects, setObjects] = useState<RadarObject[]>([
    { id: nextId++, x: 100, y: -80, size: 15 },
    { id: nextId++, x: -120, y: 50, size: 20 },
  ]);
  const [beamAngle, setBeamAngle] = useState(0); // current scan angle in degrees
  const [beamWidth, setBeamWidth] = useState(10); // degrees
  const [scanSpeed, setScanSpeed] = useState(2); // degrees per frame
  const [snr, setSnr] = useState(200);
  const [isScanning, setIsScanning] = useState(true);
  const [detections, setDetections] = useState<
    Map<number, { angle: number; distance: number; strength: number }>
  >(new Map());
  const [trailData, setTrailData] = useState<Float32Array>(() => new Float32Array(360 * 200));
  const [dragging, setDragging] = useState<number | null>(null);
  const [selectedObject, setSelectedObject] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const angleRef = useRef(0);

  // Add object
  const addObject = () => {
    if (objects.length >= 5) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 50 + Math.random() * 150;
    setObjects((prev) => [
      ...prev,
      {
        id: nextId++,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        size: 10 + Math.random() * 15,
      },
    ]);
  };

  // Remove selected object
  const removeObject = () => {
    if (selectedObject === null) return;
    setObjects((prev) => prev.filter((o) => o.id !== selectedObject));
    setSelectedObject(null);
  };

  // Mouse handlers for dragging
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - CENTER;
    const my = e.clientY - rect.top - CENTER;

    for (const obj of objects) {
      const dx = mx - obj.x;
      const dy = my - obj.y;
      if (Math.sqrt(dx * dx + dy * dy) < obj.size + 5) {
        setDragging(obj.id);
        setSelectedObject(obj.id);
        return;
      }
    }
    setSelectedObject(null);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragging === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - CENTER;
    const my = e.clientY - rect.top - CENTER;
    setObjects((prev) => prev.map((o) => (o.id === dragging ? { ...o, x: mx, y: my } : o)));
  };

  const handleMouseUp = () => setDragging(null);

  // Animation loop
  useEffect(() => {
    if (!isScanning) return;

    const animate = () => {
      angleRef.current = (angleRef.current + scanSpeed) % 360;
      setBeamAngle(angleRef.current);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [isScanning, scanSpeed]);

  // Detect objects and render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const angleRad = (beamAngle * Math.PI) / 180;
    const halfBeam = (beamWidth * Math.PI) / 360;

    // Update trail data (fade older data)
    setTrailData((prev) => {
      const next = new Float32Array(prev);
      // Fade all by a small amount
      for (let i = 0; i < next.length; i++) {
        next[i] *= 0.997;
      }

      // Check object intersections for current beam angle
      const angleIdx = Math.floor(beamAngle) % 360;
      for (const obj of objects) {
        const objAngle = Math.atan2(obj.y, obj.x);
        const objDist = Math.sqrt(obj.x * obj.x + obj.y * obj.y);
        const normalizedAngle = ((((objAngle * 180) / Math.PI) % 360) + 360) % 360;
        const beamNorm = ((beamAngle % 360) + 360) % 360;

        let angleDiff = Math.abs(normalizedAngle - beamNorm);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        if (angleDiff < beamWidth / 2 && objDist < MAX_RANGE) {
          // Object detected
          const angularSize = (Math.atan2(obj.size, objDist) * 180) / Math.PI;
          const distIdx = Math.floor((objDist / MAX_RANGE) * 200);
          const strength = (1 - objDist / MAX_RANGE) * (snr / (snr + 10));

          for (let a = -Math.ceil(angularSize); a <= Math.ceil(angularSize); a++) {
            const ai = (((angleIdx + a) % 360) + 360) % 360;
            for (let d = Math.max(0, distIdx - 3); d < Math.min(200, distIdx + 3); d++) {
              next[ai * 200 + d] = Math.min(1, strength + Math.random() * 0.1);
            }
          }
        }
      }

      return next;
    });

    // Render PPI display
    ctx.fillStyle = "rgba(0, 10, 5, 0.15)";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw full background once in a while
    ctx.fillStyle = "#000a05";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Range rings
    ctx.strokeStyle = "#0a2a15";
    ctx.lineWidth = 1;
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, (r / 4) * MAX_RANGE, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross hairs
    ctx.beginPath();
    ctx.moveTo(CENTER, 20);
    ctx.lineTo(CENTER, CANVAS_SIZE - 20);
    ctx.moveTo(20, CENTER);
    ctx.lineTo(CANVAS_SIZE - 20, CENTER);
    ctx.stroke();

    // Draw trail data (radar returns)
    for (let a = 0; a < 360; a++) {
      const aRad = (a * Math.PI) / 180;
      for (let d = 0; d < 200; d++) {
        const val = trailData[a * 200 + d];
        if (val < 0.05) continue;
        const r = (d / 200) * MAX_RANGE;
        const x = CENTER + Math.cos(aRad) * r;
        const y = CENTER + Math.sin(aRad) * r;
        const green = Math.floor(val * 255);
        ctx.fillStyle = `rgb(0, ${green}, ${Math.floor(green * 0.3)})`;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    // Draw beam sweep
    const gradient = ctx.createLinearGradient(
      CENTER,
      CENTER,
      CENTER + Math.cos(angleRad) * MAX_RANGE,
      CENTER + Math.sin(angleRad) * MAX_RANGE,
    );
    gradient.addColorStop(0, "rgba(0, 255, 100, 0.3)");
    gradient.addColorStop(1, "rgba(0, 255, 100, 0.02)");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(CENTER, CENTER);
    ctx.arc(CENTER, CENTER, MAX_RANGE, angleRad - halfBeam, angleRad + halfBeam);
    ctx.closePath();
    ctx.fill();

    // Draw objects (as faint circles for reference)
    objects.forEach((obj) => {
      const isSelected = obj.id === selectedObject;
      ctx.strokeStyle = isSelected ? "#ffaa44" : "rgba(100, 150, 100, 0.3)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.arc(CENTER + obj.x, CENTER + obj.y, obj.size, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Center dot
    ctx.fillStyle = "#00ff66";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, 3, 0, Math.PI * 2);
    ctx.fill();

    // Beam angle label
    ctx.fillStyle = "#00cc55";
    ctx.font = "11px monospace";
    ctx.fillText(`Beam: ${beamAngle.toFixed(0)}°`, 10, 18);
    ctx.fillText(`Width: ${beamWidth}°`, 10, 32);
    ctx.fillText(`Objects: ${objects.length}/5`, 10, 46);
  }, [beamAngle, objects, beamWidth, snr, selectedObject, trailData]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="sim-control-panel p-4 space-y-4 lg:w-64 shrink-0 overflow-y-auto">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Radar Controls
        </h3>

        <ParameterSlider
          label="Beam Width"
          value={beamWidth}
          min={2}
          max={45}
          step={1}
          unit="°"
          onChange={setBeamWidth}
        />
        <ParameterSlider
          label="Scan Speed"
          value={scanSpeed}
          min={0.5}
          max={10}
          step={0.5}
          unit="°/frame"
          onChange={setScanSpeed}
        />
        <ParameterSlider label="SNR" value={snr} min={0} max={1000} step={1} onChange={setSnr} />

        <div className="flex gap-2">
          <button
            onClick={() => setIsScanning((p) => !p)}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            {isScanning ? "Pause" : "Resume"}
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={addObject}
            disabled={objects.length >= 5}
            className="flex-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/80 disabled:opacity-50"
          >
            Add Object
          </button>
          <button
            onClick={removeObject}
            disabled={selectedObject === null}
            className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            Remove
          </button>
        </div>

        {selectedObject !== null && (
          <div className="border-t border-border pt-3 space-y-3">
            <span className="sim-param-label">Selected Object</span>
            <ParameterSlider
              label="Size"
              value={objects.find((o) => o.id === selectedObject)?.size ?? 10}
              min={5}
              max={40}
              step={1}
              onChange={(v) =>
                setObjects((prev) =>
                  prev.map((o) => (o.id === selectedObject ? { ...o, size: v } : o)),
                )
              }
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Click objects to select. Drag to move. Wider beam = faster scan but less precise size
          estimation.
        </p>
      </div>

      <div className="flex-1 sim-canvas-container p-3 flex flex-col items-center">
        <h4 className="sim-param-label mb-2">PPI Radar Display</h4>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="rounded cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
    </div>
  );
}

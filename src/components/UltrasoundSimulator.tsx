/**
 * Ultrasound Simulator Module
 *
 * - Shepp-Logan phantom with editable tissue properties
 * - Movable probe on phantom boundary
 * - A-mode (signal vs depth), B-mode (image from scans), Doppler mode
 * - Beam direction control
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ParameterSlider } from "@/components/ParameterSlider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// Shepp-Logan phantom ellipses: [centerX, centerY, semiA, semiB, rotation, density, attenuation, speedOfSound, name]
interface PhantomEllipse {
  cx: number;
  cy: number;
  a: number;
  b: number;
  rotation: number; // degrees
  density: number; // relative 0-1
  attenuation: number; // dB/cm/MHz
  speedOfSound: number; // m/s
  name: string;
}

const INITIAL_PHANTOM: PhantomEllipse[] = [
  {
    cx: 0,
    cy: 0,
    a: 0.92,
    b: 0.69,
    rotation: 0,
    density: 1.0,
    attenuation: 0.5,
    speedOfSound: 1540,
    name: "Outer Skull",
  },
  {
    cx: 0,
    cy: -0.0184,
    a: 0.874,
    b: 0.6624,
    rotation: 0,
    density: 0.98,
    attenuation: 0.7,
    speedOfSound: 1560,
    name: "Brain",
  },
  {
    cx: 0.22,
    cy: 0,
    a: 0.31,
    b: 0.11,
    rotation: -18,
    density: 0.8,
    attenuation: 1.0,
    speedOfSound: 1500,
    name: "Left Ventricle",
  },
  {
    cx: -0.22,
    cy: 0,
    a: 0.41,
    b: 0.16,
    rotation: 18,
    density: 0.8,
    attenuation: 1.0,
    speedOfSound: 1500,
    name: "Right Ventricle",
  },
  {
    cx: 0,
    cy: 0.35,
    a: 0.25,
    b: 0.21,
    rotation: 0,
    density: 0.6,
    attenuation: 0.3,
    speedOfSound: 1520,
    name: "Tumor Mass",
  },
  {
    cx: 0,
    cy: 0.1,
    a: 0.046,
    b: 0.046,
    rotation: 0,
    density: 0.4,
    attenuation: 0.2,
    speedOfSound: 1510,
    name: "Lesion",
  },
];

const CANVAS_SIZE = 400;
const PHANTOM_SCALE = CANVAS_SIZE / 2.2;

function toCanvas(px: number, py: number): [number, number] {
  return [CANVAS_SIZE / 2 + px * PHANTOM_SCALE, CANVAS_SIZE / 2 - py * PHANTOM_SCALE];
}

function fromCanvas(cx: number, cy: number): [number, number] {
  return [(cx - CANVAS_SIZE / 2) / PHANTOM_SCALE, -(cy - CANVAS_SIZE / 2) / PHANTOM_SCALE];
}

function pointInEllipse(px: number, py: number, e: PhantomEllipse): boolean {
  const cosR = Math.cos((-e.rotation * Math.PI) / 180);
  const sinR = Math.sin((-e.rotation * Math.PI) / 180);
  const dx = px - e.cx;
  const dy = py - e.cy;
  const rx = cosR * dx + sinR * dy;
  const ry = -sinR * dx + cosR * dy;
  return (rx * rx) / (e.a * e.a) + (ry * ry) / (e.b * e.b) <= 1;
}

export function UltrasoundSimulator() {
  const [phantom, setPhantom] = useState<PhantomEllipse[]>(INITIAL_PHANTOM);
  const [probeAngle, setProbeAngle] = useState(0); // angle on phantom surface (degrees)
  const [beamDirection, setBeamDirection] = useState(180); // beam direction (degrees, inward)
  const [snr, setSnr] = useState(100);
  const [frequency, setFrequency] = useState(5); // MHz
  const [hoveredEllipse, setHoveredEllipse] = useState<number | null>(null);
  const [editingEllipse, setEditingEllipse] = useState<number | null>(null);
  const [bModeData, setBModeData] = useState<number[][]>([]);
  const [mode, setMode] = useState<"a-mode" | "b-mode" | "doppler">("a-mode");

  // Blood vessel for Doppler
  const [vesselAngle, setVesselAngle] = useState(45);
  const [bloodVelocity, setBloodVelocity] = useState(0.5); // m/s

  const phantomCanvasRef = useRef<HTMLCanvasElement>(null);
  const aModCanvasRef = useRef<HTMLCanvasElement>(null);
  const bModeCanvasRef = useRef<HTMLCanvasElement>(null);
  const dopplerCanvasRef = useRef<HTMLCanvasElement>(null);

  // Compute probe position on phantom boundary
  const probeRad = (probeAngle * Math.PI) / 180;
  const outerE = phantom[0];
  const probeX = outerE.cx + outerE.a * Math.cos(probeRad);
  const probeY = outerE.cy + outerE.b * Math.sin(probeRad);

  // Compute A-mode scan line
  const computeAMode = useCallback(() => {
    const dirRad = (beamDirection * Math.PI) / 180;
    const dx = Math.cos(dirRad);
    const dy = Math.sin(dirRad);
    const numSamples = 200;
    const maxDepth = 2.0; // in phantom units
    const stepSize = maxDepth / numSamples;
    const aLine: number[] = [];

    let cumulativeAttenuation = 0;
    for (let i = 0; i < numSamples; i++) {
      const sx = probeX + dx * stepSize * i;
      const sy = probeY + dy * stepSize * i;

      // Find which ellipse contains this point (innermost first)
      let sampleDensity = 0;
      let sampleAtten = 0;
      for (let e = phantom.length - 1; e >= 0; e--) {
        if (pointInEllipse(sx, sy, phantom[e])) {
          // Reflection at boundary
          sampleDensity = phantom[e].density;
          sampleAtten = phantom[e].attenuation;
          break;
        }
      }

      cumulativeAttenuation += sampleAtten * frequency * stepSize * 10; // dB
      const attenuationFactor = Math.pow(10, -cumulativeAttenuation / 20);

      // Echo strength: proportional to density changes (impedance mismatch)
      let echo = sampleDensity * attenuationFactor;

      // Add noise
      if (snr > 0) {
        echo += (Math.random() - 0.5) * 2 * (1 / (snr + 1));
      }
      aLine.push(Math.max(0, echo));
    }

    return aLine;
  }, [probeX, probeY, beamDirection, phantom, frequency, snr]);

  // Draw phantom
  useEffect(() => {
    const canvas = phantomCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Draw ellipses
    phantom.forEach((e, idx) => {
      const [cx, cy] = toCanvas(e.cx, e.cy);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-e.rotation * Math.PI) / 180);

      const brightness = Math.floor(e.density * 200 + 30);
      ctx.fillStyle =
        hoveredEllipse === idx
          ? `rgba(255, 180, 100, 0.6)`
          : `rgba(${brightness}, ${brightness}, ${brightness + 20}, 0.8)`;
      ctx.strokeStyle = editingEllipse === idx ? "#ff6b6b" : "rgba(100, 140, 180, 0.3)";
      ctx.lineWidth = editingEllipse === idx ? 2 : 1;

      ctx.beginPath();
      ctx.ellipse(0, 0, e.a * PHANTOM_SCALE, e.b * PHANTOM_SCALE, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    // Draw blood vessel
    const vRad = (vesselAngle * Math.PI) / 180;
    const vx1 = 0.1 * Math.cos(vRad);
    const vy1 = 0.1 * Math.sin(vRad);
    const [vsx1, vsy1] = toCanvas(vx1 - 0.15 * Math.cos(vRad), vy1 - 0.15 * Math.sin(vRad));
    const [vsx2, vsy2] = toCanvas(vx1 + 0.15 * Math.cos(vRad), vy1 + 0.15 * Math.sin(vRad));
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(vsx1, vsy1);
    ctx.lineTo(vsx2, vsy2);
    ctx.stroke();
    ctx.fillStyle = "#ff6666";
    ctx.font = "10px monospace";
    ctx.fillText("vessel", vsx2 + 5, vsy2);

    // Draw probe
    const [px, py] = toCanvas(probeX, probeY);
    ctx.fillStyle = "#00ff88";
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();

    // Draw beam line
    const dirRad = (beamDirection * Math.PI) / 180;
    const beamEndX = probeX + Math.cos(dirRad) * 1.5;
    const beamEndY = probeY + Math.sin(dirRad) * 1.5;
    const [bex, bey] = toCanvas(beamEndX, beamEndY);
    ctx.strokeStyle = "rgba(0, 255, 136, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(bex, bey);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tooltip for hovered ellipse
    if (hoveredEllipse !== null) {
      const e = phantom[hoveredEllipse];
      const [tx, ty] = toCanvas(e.cx, e.cy);
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(tx + 10, ty - 60, 160, 55);
      ctx.fillStyle = "#ccddff";
      ctx.font = "10px monospace";
      ctx.fillText(e.name, tx + 15, ty - 45);
      ctx.fillText(`Density: ${e.density.toFixed(2)}`, tx + 15, ty - 33);
      ctx.fillText(`Atten: ${e.attenuation.toFixed(2)} dB/cm/MHz`, tx + 15, ty - 21);
      ctx.fillText(`SoS: ${e.speedOfSound} m/s`, tx + 15, ty - 9);
    }
  }, [
    phantom,
    probeAngle,
    beamDirection,
    hoveredEllipse,
    editingEllipse,
    vesselAngle,
    probeX,
    probeY,
  ]);

  // A-mode plot
  useEffect(() => {
    if (mode !== "a-mode") return;
    const canvas = aModCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, w, h);

    const aLine = computeAMode();

    // Grid
    ctx.strokeStyle = "#1e2740";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Plot
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < aLine.length; i++) {
      const x = (i / aLine.length) * w;
      const y = h - aLine[i] * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#8899bb";
    ctx.font = "10px monospace";
    ctx.fillText("Depth →", w - 60, h - 5);
    ctx.fillText("Echo ↑", 5, 14);
  }, [mode, computeAMode]);

  // B-mode: accumulate scans
  const addBModeScan = useCallback(() => {
    const aLine = computeAMode();
    setBModeData((prev) => {
      const next = [...prev, aLine];
      if (next.length > 200) next.shift();
      return next;
    });
  }, [computeAMode]);

  // Auto-add B-mode scan when probe moves
  useEffect(() => {
    if (mode === "b-mode") {
      addBModeScan();
    }
  }, [mode, probeAngle, beamDirection, addBModeScan]);

  // Draw B-mode
  useEffect(() => {
    if (mode !== "b-mode") return;
    const canvas = bModeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    if (bModeData.length === 0) return;

    const scanWidth = w / bModeData.length;
    for (let s = 0; s < bModeData.length; s++) {
      const line = bModeData[s];
      for (let d = 0; d < line.length; d++) {
        const brightness = Math.min(255, Math.floor(line[d] * 255));
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        ctx.fillRect(
          s * scanWidth,
          (d / line.length) * h,
          Math.ceil(scanWidth),
          Math.ceil(h / line.length),
        );
      }
    }
  }, [mode, bModeData]);

  // Doppler mode
  useEffect(() => {
    if (mode !== "doppler") return;
    const canvas = dopplerCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, w, h);

    // Doppler shift calculation
    const soundSpeed = 1540; // m/s in tissue
    const probeFreqHz = frequency * 1e6;
    const dopplerAngleRad = ((beamDirection - vesselAngle) * Math.PI) / 180;
    const dopplerShift = (2 * probeFreqHz * bloodVelocity * Math.cos(dopplerAngleRad)) / soundSpeed;

    // Draw Doppler spectrum (simplified)
    const midY = h / 2;

    // Zero line
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    // Doppler signal
    const normalizedShift = dopplerShift / (probeFreqHz * 0.01); // normalize
    const signalY = midY - normalizedShift * (h / 4);

    // Draw time-varying signal
    ctx.strokeStyle = dopplerShift > 0 ? "#ff4444" : "#4444ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const t = x / w;
      const noise = snr > 0 ? (Math.random() - 0.5) * (20 / (snr + 1)) : 0;
      const pulsatile = Math.sin(t * Math.PI * 6) * 10; // heartbeat-like
      const y = signalY + noise + pulsatile;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = "#8899bb";
    ctx.font = "10px monospace";
    ctx.fillText(`Doppler Shift: ${(dopplerShift / 1000).toFixed(1)} kHz`, 10, 16);
    ctx.fillText(`Blood Vel: ${bloodVelocity.toFixed(2)} m/s`, 10, 30);
    ctx.fillText(`Angle: ${((dopplerAngleRad * 180) / Math.PI).toFixed(1)}°`, 10, 44);
    ctx.fillText("+", 5, midY - h / 4);
    ctx.fillText("−", 5, midY + h / 4);
    ctx.fillText("Time →", w - 60, h - 5);
  }, [mode, beamDirection, vesselAngle, bloodVelocity, frequency, snr]);

  // Mouse handlers for phantom
  const handlePhantomMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const [px, py] = fromCanvas(mx, my);

    let found: number | null = null;
    for (let i = phantom.length - 1; i >= 0; i--) {
      if (pointInEllipse(px, py, phantom[i])) {
        found = i;
        break;
      }
    }
    setHoveredEllipse(found);
  };

  const handlePhantomClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const [px, py] = fromCanvas(mx, my);

    for (let i = phantom.length - 1; i >= 0; i--) {
      if (pointInEllipse(px, py, phantom[i])) {
        setEditingEllipse(i === editingEllipse ? null : i);
        return;
      }
    }
    setEditingEllipse(null);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="sim-control-panel p-4 space-y-3 lg:w-72 shrink-0 overflow-y-auto">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Ultrasound Controls
        </h3>

        <ParameterSlider
          label="Probe Position"
          value={probeAngle}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={setProbeAngle}
        />
        <ParameterSlider
          label="Beam Direction"
          value={beamDirection}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={setBeamDirection}
        />
        <ParameterSlider
          label="Frequency"
          value={frequency}
          min={1}
          max={15}
          step={0.5}
          unit="MHz"
          onChange={setFrequency}
        />
        <ParameterSlider label="SNR" value={snr} min={0} max={1000} step={1} onChange={setSnr} />

        <div className="border-t border-border pt-3 space-y-3">
          <span className="sim-param-label">Doppler Settings</span>
          <ParameterSlider
            label="Vessel Angle"
            value={vesselAngle}
            min={0}
            max={360}
            step={1}
            unit="°"
            onChange={setVesselAngle}
          />
          <ParameterSlider
            label="Blood Velocity"
            value={bloodVelocity}
            min={0}
            max={3}
            step={0.05}
            unit="m/s"
            onChange={setBloodVelocity}
          />
        </div>

        {editingEllipse !== null && (
          <div className="border-t border-border pt-3 space-y-3">
            <span className="sim-param-label">Edit: {phantom[editingEllipse].name}</span>
            <ParameterSlider
              label="Density"
              value={phantom[editingEllipse].density}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) =>
                setPhantom((prev) =>
                  prev.map((e, i) => (i === editingEllipse ? { ...e, density: v } : e)),
                )
              }
            />
            <ParameterSlider
              label="Attenuation"
              value={phantom[editingEllipse].attenuation}
              min={0}
              max={3}
              step={0.05}
              unit="dB/cm/MHz"
              onChange={(v) =>
                setPhantom((prev) =>
                  prev.map((e, i) => (i === editingEllipse ? { ...e, attenuation: v } : e)),
                )
              }
            />
            <ParameterSlider
              label="Speed of Sound"
              value={phantom[editingEllipse].speedOfSound}
              min={1400}
              max={1700}
              step={10}
              unit="m/s"
              onChange={(v) =>
                setPhantom((prev) =>
                  prev.map((e, i) => (i === editingEllipse ? { ...e, speedOfSound: v } : e)),
                )
              }
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Hover ellipses to see properties. Click to edit.
        </p>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="sim-canvas-container p-3 flex flex-col items-center">
            <h4 className="sim-param-label mb-2">Shepp-Logan Phantom</h4>
            <canvas
              ref={phantomCanvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="rounded cursor-crosshair"
              onMouseMove={handlePhantomMouseMove}
              onClick={handlePhantomClick}
              onMouseLeave={() => setHoveredEllipse(null)}
            />
          </div>

          <div className="flex-1 sim-canvas-container p-3 flex flex-col items-center">
            <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="a-mode" className="flex-1">
                  A-Mode
                </TabsTrigger>
                <TabsTrigger value="b-mode" className="flex-1">
                  B-Mode
                </TabsTrigger>
                <TabsTrigger value="doppler" className="flex-1">
                  Doppler
                </TabsTrigger>
              </TabsList>
              <TabsContent value="a-mode" className="flex justify-center">
                <canvas ref={aModCanvasRef} width={400} height={250} className="rounded" />
              </TabsContent>
              <TabsContent value="b-mode" className="flex justify-center">
                <canvas ref={bModeCanvasRef} width={400} height={250} className="rounded" />
              </TabsContent>
              <TabsContent value="doppler" className="flex justify-center">
                <canvas ref={dopplerCanvasRef} width={400} height={250} className="rounded" />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}

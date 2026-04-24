import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import { BeamformingParams, PhantomEllipse, WindowType } from "@/types/beamforming";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import "./SimulatorUltrasound.css";

type UltrasoundUIParams = BeamformingParams & {
  maxDepthMm: number;
  numSamples: number;
  phaseShiftDeg: number;
};

type VesselState = {
  x: number;
  y: number;
  radius: number;
  velocityCms: number;
  flowAngleDeg: number;
};

type HoverInfo = {
  regionIndex: number;
};

type ProcessedEllipse = PhantomEllipse & {
  phiRad: number;
  cosPhi: number;
  sinPhi: number;
  a2: number;
  b2: number;
  area: number;
};

type ProbePose = {
  x: number;
  y: number;
  inwardX: number;
  inwardY: number;
};

type AModeData = {
  depthsMm: Float32Array;
  amplitudes: Float32Array;
  spikesMm: number[];
};

type DopplerPoint = {
  fd: number;
};

type ProbePathMode = "ellipse" | "rectangle";

const PHANTOM_SIZE = 380;
const BEAM_W = 320;
const BEAM_H = 220;
const BMODE_VIEW_W = 440;
const BMODE_HISTORY_W = 1024;
const TRACE_LEN = 260;
const AUTO_SCAN_STEP = 0.002;
const PROBE_RECT_HALF = 0.96;
const PANEL_BG = "#0d0b18";
const PANEL_BG_ALT = "#0a0a14";
const GRID_COLOR = "rgba(184, 156, 233, 0.22)";
const TEXT_COLOR = "#efe6fb";
const MUTED_COLOR = "#c6b7df";
const PRIMARY_COLOR = "rgba(181, 98, 255, 0.95)";
const PRIMARY_SOFT = "rgba(181, 98, 255, 0.28)";
const PRIMARY_GLOW = "rgba(181, 98, 255, 0.16)";
const ACCENT_COLOR = "rgba(255, 104, 181, 0.95)";
const ACCENT_SOFT = "rgba(255, 104, 181, 0.28)";

const defaultParams: UltrasoundUIParams = {
  numElements: 64,
  spacing: 0.3,
  frequency: 5e6,
  wavelength: 1,
  steeringAngleDeg: 0,
  amplitude: 1,
  snrDb: 80,
  windowType: "hamming",
  noiseEnabled: true,
  apodizationEnabled: true,
  maxDepthMm: 140,
  numSamples: 512,
  phaseShiftDeg: 0,
  geometry: "linear",
  radius: 5,
};

const defaultPhantom: PhantomEllipse[] = [
  { regionId: 1, label: "Background Tissue", intensity: 0.75, a: 0.69, b: 0.92, x0: 0, y0: 0, phiDeg: 0, acousticImpedanceMrayl: 1.63, attenuationDbCmMhz: 0.5, backscatterCoeff: 0.28, speedOfSoundMps: 1540, scatterDensity: 0.55, boundaryRoughness: 0.35 },
  { regionId: 2, label: "CSF Region", intensity: 0.2, a: 0.6624, b: 0.874, x0: 0, y0: -0.0184, phiDeg: 0, acousticImpedanceMrayl: 1.51, attenuationDbCmMhz: 0.02, backscatterCoeff: 0.07, speedOfSoundMps: 1505, scatterDensity: 0.1, boundaryRoughness: 0.1 },
  { regionId: 3, label: "Dense Inclusion A", intensity: 0.1, a: 0.11, b: 0.31, x0: 0.22, y0: 0, phiDeg: -18, acousticImpedanceMrayl: 1.72, attenuationDbCmMhz: 0.85, backscatterCoeff: 0.44, speedOfSoundMps: 1570, scatterDensity: 0.62, boundaryRoughness: 0.48 },
  { regionId: 4, label: "Dense Inclusion B", intensity: 0.1, a: 0.16, b: 0.41, x0: -0.22, y0: 0, phiDeg: 18, acousticImpedanceMrayl: 1.68, attenuationDbCmMhz: 0.78, backscatterCoeff: 0.4, speedOfSoundMps: 1560, scatterDensity: 0.58, boundaryRoughness: 0.46 },
  { regionId: 5, label: "Inner Tissue", intensity: 0.55, a: 0.21, b: 0.25, x0: 0, y0: 0.35, phiDeg: 0, acousticImpedanceMrayl: 1.65, attenuationDbCmMhz: 0.6, backscatterCoeff: 0.3, speedOfSoundMps: 1545, scatterDensity: 0.5, boundaryRoughness: 0.4 },
  { regionId: 6, label: "Calcification 1", intensity: 0.9, a: 0.046, b: 0.046, x0: -0.08, y0: -0.62, phiDeg: 0, acousticImpedanceMrayl: 5.2, attenuationDbCmMhz: 5.4, backscatterCoeff: 0.83, speedOfSoundMps: 3000, scatterDensity: 0.25, boundaryRoughness: 0.82 },
  { regionId: 7, label: "Calcification 2", intensity: 0.95, a: 0.03, b: 0.03, x0: 0, y0: -0.62, phiDeg: 0, acousticImpedanceMrayl: 5.5, attenuationDbCmMhz: 6, backscatterCoeff: 0.88, speedOfSoundMps: 3200, scatterDensity: 0.2, boundaryRoughness: 0.85 },
  { regionId: 8, label: "Calcification 3", intensity: 0.9, a: 0.03, b: 0.05, x0: 0.07, y0: -0.62, phiDeg: 0, acousticImpedanceMrayl: 5.3, attenuationDbCmMhz: 5.7, backscatterCoeff: 0.84, speedOfSoundMps: 3100, scatterDensity: 0.22, boundaryRoughness: 0.8 },
];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function gaussianNoise(std: number) {
  const u = Math.max(Math.random(), 1e-12);
  const v = Math.max(Math.random(), 1e-12);
  return std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function windowWeights(windowType: WindowType, n: number) {
  const N = Math.max(1, Math.floor(n));
  if (N === 1) return [1];
  const out: number[] = new Array(N).fill(1);
  const denom = N - 1;
  for (let i = 0; i < N; i += 1) {
    const p = (2 * Math.PI * i) / denom;
    if (windowType === "hamming") out[i] = 0.54 - 0.46 * Math.cos(p);
    else if (windowType === "hanning") out[i] = 0.5 - 0.5 * Math.cos(p);
    else if (windowType === "blackman") out[i] = 0.42 - 0.5 * Math.cos(p) + 0.08 * Math.cos(2 * p);
  }
  const sum = out.reduce((acc, v) => acc + Math.abs(v), 0) || 1;
  return out.map((v) => v / sum);
}

function ellipseContains(x: number, y: number, e: ProcessedEllipse) {
  const dx = x - e.x0;
  const dy = y - e.y0;
  const xr = dx * e.cosPhi + dy * e.sinPhi;
  const yr = -dx * e.sinPhi + dy * e.cosPhi;
  return (xr * xr) / e.a2 + (yr * yr) / e.b2 <= 1;
}

function rayEllipseIntersections(ox: number, oy: number, dx: number, dy: number, e: ProcessedEllipse) {
  const rx = ox - e.x0;
  const ry = oy - e.y0;
  const oX = rx * e.cosPhi + ry * e.sinPhi;
  const oY = -rx * e.sinPhi + ry * e.cosPhi;
  const dX = dx * e.cosPhi + dy * e.sinPhi;
  const dY = -dx * e.sinPhi + dy * e.cosPhi;

  const A = (dX * dX) / e.a2 + (dY * dY) / e.b2;
  const B = 2 * ((oX * dX) / e.a2 + (oY * dY) / e.b2);
  const C = (oX * oX) / e.a2 + (oY * oY) / e.b2 - 1;
  const D = B * B - 4 * A * C;

  if (D < 0 || Math.abs(A) < 1e-12) return [] as number[];
  const sqrtD = Math.sqrt(D);
  const t1 = (-B - sqrtD) / (2 * A);
  const t2 = (-B + sqrtD) / (2 * A);
  const out: number[] = [];
  if (t1 > 0) out.push(t1);
  if (t2 > 0) out.push(t2);
  return out;
}

function getTissueAtPoint(x: number, y: number, ellipses: ProcessedEllipse[]) {
  let matched: ProcessedEllipse | null = null;
  for (let i = 0; i < ellipses.length; i += 1) {
    if (ellipseContains(x, y, ellipses[i])) matched = ellipses[i];
  }
  return matched;
}

const AModeCanvas = memo(function AModeCanvas({ data }: { data: AModeData }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 560;
    canvas.height = 240;

    const left = 40;
    const right = 548;
    const top = 12;
    const bottom = 214;

    ctx.fillStyle = PANEL_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i += 1) {
      const y = top + ((bottom - top) * i) / 6;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    let maxAmp = 0;
    for (let i = 0; i < data.amplitudes.length; i += 1) {
      if (data.amplitudes[i] > maxAmp) maxAmp = data.amplitudes[i];
    }
    const ampNorm = Math.max(maxAmp, 0.001);

    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < data.amplitudes.length; i += 1) {
      const x = left + (i / Math.max(data.amplitudes.length - 1, 1)) * (right - left);
      const y = bottom - (data.amplitudes[i] / ampNorm) * (bottom - top);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 104, 181, 0.5)";
    ctx.setLineDash([4, 4]);
    const maxDepth = Math.max(data.depthsMm[data.depthsMm.length - 1], 1);
    for (let i = 0; i < data.spikesMm.length; i += 1) {
      const x = left + (clamp(data.spikesMm[i] / maxDepth, 0, 1) * (right - left));
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = MUTED_COLOR;
    ctx.font = "11px JetBrains Mono";
    ctx.fillText("Depth (mm)", 258, 234);
    ctx.save();
    ctx.translate(13, 126);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Amplitude", -27, 0);
    ctx.restore();
  }, [data]);

  return <canvas ref={ref} className="ultra-chart-canvas" />;
});

const DopplerCanvas = memo(function DopplerCanvas({ points }: { points: DopplerPoint[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cssWidth = Math.max(560, Math.floor(canvas.clientWidth || 560));
    const cssHeight = Math.max(220, Math.floor(canvas.clientHeight || 220));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const left = 34;
    const right = cssWidth - 12;
    const top = 12;
    const bottom = cssHeight - 24;
    const mid = Math.round((top + bottom) / 2);

    ctx.fillStyle = PANEL_BG_ALT;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    ctx.strokeStyle = GRID_COLOR;
    for (let i = 0; i <= 8; i += 1) {
      const y = top + ((bottom - top) * i) / 8;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(206, 188, 235, 0.55)";
    ctx.beginPath();
    ctx.moveTo(left, mid);
    ctx.lineTo(right, mid);
    ctx.stroke();

    let maxAbs = 1;
    for (let i = 0; i < points.length; i += 1) {
      const a = Math.abs(points[i].fd);
      if (a > maxAbs) maxAbs = a;
    }

    ctx.strokeStyle = "rgba(244, 230, 255, 0.95)";
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 1) {
      const x = left + (i / Math.max(points.length - 1, 1)) * (right - left);
      const y = mid - (points[i].fd / maxAbs) * ((bottom - top) * 0.45);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "11px JetBrains Mono";
    ctx.fillText("Time (s)", Math.max(left + 120, Math.round(cssWidth * 0.45)), cssHeight - 6);
    ctx.save();
    ctx.translate(12, Math.round(cssHeight / 2));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("fd (Hz)", -20, 0);
    ctx.restore();
  }, [points]);

  return <canvas ref={ref} className="ultra-chart-canvas" />;
});

function ControlDashboard({
  params,
  onParam,
  vessel,
  onVessel,
  probePathMode,
  onProbePathMode,
  autoScan,
  autoScanPaused,
  autoScanSpeed,
  onAutoScanSpeed,
  onStartAutoScan,
  onPauseResumeAutoScan,
  onStopAutoScan,
  onResetBmode,
}: {
  params: UltrasoundUIParams;
  onParam: <K extends keyof UltrasoundUIParams>(key: K, value: UltrasoundUIParams[K]) => void;
  vessel: VesselState;
  onVessel: (next: VesselState) => void;
  probePathMode: ProbePathMode;
  onProbePathMode: (mode: ProbePathMode) => void;
  autoScan: boolean;
  autoScanPaused: boolean;
  autoScanSpeed: number;
  onAutoScanSpeed: (value: number) => void;
  onStartAutoScan: () => void;
  onPauseResumeAutoScan: () => void;
  onStopAutoScan: () => void;
  onResetBmode: () => void;
}) {
  const autoScanStatus = !autoScan ? "Stopped" : autoScanPaused ? "Paused" : "Running";

  return (
    <div className="ultra-control-panel">
      <h2 className="ultra-panel-title">Control Dashboard</h2>

      <div className="ultra-control-row"><Label>Elements (N)</Label><span>{params.numElements.toFixed(0)}</span></div>
      <Slider value={[params.numElements]} min={4} max={128} step={1} onValueChange={([v]) => onParam("numElements", v)} />

      <div className="ultra-control-row"><Label>Spacing (d/lambda)</Label><span>{params.spacing.toFixed(2)}</span></div>
      <Slider value={[params.spacing]} min={0.1} max={1.2} step={0.01} onValueChange={([v]) => onParam("spacing", v)} />

      <div className="ultra-control-row"><Label>Frequency (MHz)</Label><span>{((params.frequency ?? 5e6) / 1e6).toFixed(2)}</span></div>
      <Slider value={[(params.frequency ?? 5e6) / 1e6]} min={1} max={15} step={0.1} onValueChange={([v]) => onParam("frequency", v * 1e6)} />

      <div className="ultra-control-row"><Label>Steering Angle</Label><span>{(params.steeringAngleDeg ?? 0).toFixed(0)} deg</span></div>
      <Slider value={[params.steeringAngleDeg ?? 0]} min={-60} max={60} step={1} onValueChange={([v]) => onParam("steeringAngleDeg", v)} />

      <div className="ultra-control-row"><Label>Amplitude</Label><span>{params.amplitude.toFixed(2)}</span></div>
      <Slider value={[params.amplitude]} min={0.1} max={2} step={0.01} onValueChange={([v]) => onParam("amplitude", v)} />

      <div className="ultra-control-row"><Label>SNR</Label><span>{params.snrDb.toFixed(0)}</span></div>
      <Slider value={[params.snrDb]} min={0} max={1000} step={1} onValueChange={([v]) => onParam("snrDb", v)} />

      <div className="ultra-control-row"><Label>Phase Shift</Label><span>{params.phaseShiftDeg.toFixed(0)} deg</span></div>
      <Slider value={[params.phaseShiftDeg]} min={-180} max={180} step={1} onValueChange={([v]) => onParam("phaseShiftDeg", v)} />

      <div className="ultra-control-row"><Label>Windowing / Apodization</Label></div>
      <Select value={params.windowType} onValueChange={(v) => onParam("windowType", v as WindowType)}>
        <SelectTrigger className="ultra-select-trigger"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="rectangular">Rectangular</SelectItem>
          <SelectItem value="hamming">Hamming</SelectItem>
          <SelectItem value="hanning">Hanning</SelectItem>
          <SelectItem value="blackman">Blackman</SelectItem>
          <SelectItem value="kaiser">Kaiser</SelectItem>
        </SelectContent>
      </Select>

      <div className="ultra-section-divider" />

      <div className="ultra-control-row"><Label>Blood Velocity</Label><span>{vessel.velocityCms.toFixed(1)} cm/s</span></div>
      <Slider value={[vessel.velocityCms]} min={0} max={150} step={0.5} onValueChange={([v]) => onVessel({ ...vessel, velocityCms: v })} />

      <div className="ultra-control-row"><Label>Flow Direction</Label><span>{vessel.flowAngleDeg.toFixed(0)} deg</span></div>
      <Slider value={[vessel.flowAngleDeg]} min={-180} max={180} step={1} onValueChange={([v]) => onVessel({ ...vessel, flowAngleDeg: v })} />

      <div className="ultra-control-row"><Label>Probe Path</Label></div>
      <Select value={probePathMode} onValueChange={(v) => onProbePathMode(v as ProbePathMode)}>
        <SelectTrigger className="ultra-select-trigger"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ellipse">Circle (Phantom Boundary)</SelectItem>
          <SelectItem value="rectangle">Rectangle (Outer Frame)</SelectItem>
        </SelectContent>
      </Select>

      <div className="ultra-section-divider" />

      <h3 className="ultra-subsection-title">Auto Scan</h3>

      <div className="ultra-control-row"><Label>Status</Label><span>{autoScanStatus}</span></div>

      <div className="ultra-control-row"><Label>Scan Speed</Label><span>{autoScanSpeed.toFixed(2)}x</span></div>
      <Slider value={[autoScanSpeed]} min={0.25} max={4} step={0.05} onValueChange={([v]) => onAutoScanSpeed(v)} />

      <div className="ultra-actions-row">
        <button type="button" className={`ultra-auto-btn ${autoScan && !autoScanPaused ? "active" : ""}`} onClick={onStartAutoScan}>
          {autoScan ? "Restart Auto Scan" : "Start Auto Scan"}
        </button>

        <button type="button" className="ultra-auto-btn" onClick={onPauseResumeAutoScan} disabled={!autoScan}>
          {autoScanPaused ? "Resume" : "Pause"}
        </button>

        <button type="button" className="ultra-auto-btn" onClick={onStopAutoScan} disabled={!autoScan}>
          Stop
        </button>

        <button type="button" className="ultra-auto-btn" onClick={onResetBmode}>
          Reset B-Mode
        </button>
      </div>
    </div>
  );
}

export default function SimulatorUltrasound() {
  const [params, setParams] = useState<UltrasoundUIParams>(defaultParams);
  const [regions, setRegions] = useState<PhantomEllipse[]>(defaultPhantom);
  const [probeParam, setProbeParam] = useState(0);
  const [probePathMode, setProbePathMode] = useState<ProbePathMode>("rectangle");
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<PhantomEllipse | null>(null);
  const [autoScan, setAutoScan] = useState(false);
  const [autoScanPaused, setAutoScanPaused] = useState(false);
  const [autoScanSpeed, setAutoScanSpeed] = useState(1);
  const [autoProgress, setAutoProgress] = useState(0);
  const [bmodeViewOffset, setBmodeViewOffset] = useState(0);

  const [vessel, setVessel] = useState<VesselState>({
    x: 0.16,
    y: -0.1,
    radius: 0.08,
    velocityCms: 24,
    flowAngleDeg: 30,
  });

  const [dragProbe, setDragProbe] = useState(false);
  const [dragVessel, setDragVessel] = useState(false);
  const vesselDragOffset = useRef({ dx: 0, dy: 0 });

  const phantomRef = useRef<HTMLCanvasElement>(null);
  const beamFieldRef = useRef<HTMLCanvasElement>(null);
  const bmodeRef = useRef<HTMLCanvasElement>(null);

  const bmodeAmpRef = useRef<Float32Array | null>(null);
  const bmodeWriteIndexRef = useRef(0);
  const bmodeTotalColumnsRef = useRef(0);
  const [bmodeColumns, setBmodeColumns] = useState(0);
  const [dopplerTrace, setDopplerTrace] = useState<DopplerPoint[]>(() => Array.from({ length: TRACE_LEN }, () => ({ fd: 0 })));

  const processed = useMemo<ProcessedEllipse[]>(
    () =>
      regions.map((r) => {
        const phiRad = (r.phiDeg * Math.PI) / 180;
        return {
          ...r,
          phiRad,
          cosPhi: Math.cos(phiRad),
          sinPhi: Math.sin(phiRad),
          a2: Math.max(r.a * r.a, 1e-9),
          b2: Math.max(r.b * r.b, 1e-9),
          area: r.a * r.b,
        };
      }),
    [regions],
  );

  const outerBoundary = useMemo(() => {
    if (!processed.length) return null;
    let best = processed[0];
    for (let i = 1; i < processed.length; i += 1) {
      if (processed[i].area > best.area) best = processed[i];
    }
    return best;
  }, [processed]);

  const probePose = useMemo<ProbePose | null>(() => {
    const t = ((probeParam % 1) + 1) % 1;

    if (probePathMode === "ellipse") {
      if (!outerBoundary) return null;

      const theta = t * Math.PI * 2;
      const localX = outerBoundary.a * Math.cos(theta);
      const localY = outerBoundary.b * Math.sin(theta);
      const x = outerBoundary.x0 + localX * outerBoundary.cosPhi - localY * outerBoundary.sinPhi;
      const y = outerBoundary.y0 + localX * outerBoundary.sinPhi + localY * outerBoundary.cosPhi;

      const normalLocalX = Math.cos(theta) / Math.max(outerBoundary.a, 1e-9);
      const normalLocalY = Math.sin(theta) / Math.max(outerBoundary.b, 1e-9);
      const normalX = normalLocalX * outerBoundary.cosPhi - normalLocalY * outerBoundary.sinPhi;
      const normalY = normalLocalX * outerBoundary.sinPhi + normalLocalY * outerBoundary.cosPhi;
      const norm = Math.hypot(normalX, normalY) || 1;

      return { x, y, inwardX: -normalX / norm, inwardY: -normalY / norm };
    }

    const b = PROBE_RECT_HALF;
    if (t < 0.25) {
      const s = t / 0.25;
      return { x: -b + 2 * b * s, y: b, inwardX: 0, inwardY: -1 };
    }
    if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return { x: b, y: b - 2 * b * s, inwardX: -1, inwardY: 0 };
    }
    if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return { x: b - 2 * b * s, y: -b, inwardX: 0, inwardY: 1 };
    }

    const s = (t - 0.75) / 0.25;
    return { x: -b, y: -b + 2 * b * s, inwardX: 1, inwardY: 0 };
  }, [outerBoundary, probeParam, probePathMode]);

  const beamDir = useMemo(() => {
    if (!probePose) return { x: 0, y: -1 };
    const steer = (((params.steeringAngleDeg ?? 0) + params.phaseShiftDeg) * Math.PI) / 180;
    const x = probePose.inwardX * Math.cos(steer) - probePose.inwardY * Math.sin(steer);
    const y = probePose.inwardX * Math.sin(steer) + probePose.inwardY * Math.cos(steer);
    const norm = Math.hypot(x, y) || 1;
    return { x: x / norm, y: y / norm };
  }, [params.phaseShiftDeg, params.steeringAngleDeg, probePose]);

  const amode = useMemo<AModeData>(() => {
    const samples = Math.max(128, Math.floor(params.numSamples));
    const depthsMm = new Float32Array(samples);
    const amplitudes = new Float32Array(samples);
    const spikesMm: number[] = [];

    if (!probePose) return { depthsMm, amplitudes, spikesMm };

    const mmPerNorm = params.maxDepthMm / 2.1;
    for (let i = 0; i < samples; i += 1) {
      depthsMm[i] = (i / Math.max(samples - 1, 1)) * params.maxDepthMm;
    }

    const intersections: number[] = [];
    for (let i = 0; i < processed.length; i += 1) {
      const hits = rayEllipseIntersections(probePose.x, probePose.y, beamDir.x, beamDir.y, processed[i]);
      for (let j = 0; j < hits.length; j += 1) intersections.push(hits[j]);
    }
    intersections.sort((a, b) => a - b);

    const unique: number[] = [];
    for (let i = 0; i < intersections.length; i += 1) {
      if (i === 0 || Math.abs(intersections[i] - intersections[i - 1]) > 1e-3) unique.push(intersections[i]);
    }

    for (let i = 0; i < unique.length; i += 1) {
      const t = unique[i];
      const px = probePose.x + beamDir.x * t;
      const py = probePose.y + beamDir.y * t;

      const eps = 2e-3;
      const before = getTissueAtPoint(px - beamDir.x * eps, py - beamDir.y * eps, processed);
      const after = getTissueAtPoint(px + beamDir.x * eps, py + beamDir.y * eps, processed);

      const z1 = before?.acousticImpedanceMrayl ?? 1.5;
      const z2 = after?.acousticImpedanceMrayl ?? 1.5;
      const r = Math.abs(z2 - z1) / Math.max(z2 + z1, 1e-6);

      const depthMm = t * mmPerNorm;
      if (depthMm <= 0 || depthMm > params.maxDepthMm) continue;
      spikesMm.push(depthMm);

      const idx = Math.round((depthMm / params.maxDepthMm) * (samples - 1));
      const spikeAmp = r * params.amplitude;
      for (let k = -2; k <= 2; k += 1) {
        const ii = idx + k;
        if (ii < 0 || ii >= samples) continue;
        amplitudes[ii] += spikeAmp * Math.exp(-(k * k) / 1.6);
      }
    }

    let signalPower = 0;
    for (let i = 0; i < samples; i += 1) signalPower += amplitudes[i] * amplitudes[i];
    signalPower /= samples;
    const signalRms = Math.sqrt(signalPower);

    const snr = Math.max(params.snrDb, 0);
    const noiseStd = snr <= 0 ? signalRms * 0.8 : signalRms / Math.max(snr, 1);
    for (let i = 0; i < samples; i += 1) {
      amplitudes[i] = Math.max(0, amplitudes[i] + gaussianNoise(noiseStd));
    }

    return { depthsMm, amplitudes, spikesMm };
  }, [beamDir.x, beamDir.y, params.amplitude, params.maxDepthMm, params.numSamples, params.snrDb, probePose, processed]);

  const vesselIntersects = useMemo(() => {
    if (!probePose) return false;
    const ox = probePose.x - vessel.x;
    const oy = probePose.y - vessel.y;
    const a = beamDir.x * beamDir.x + beamDir.y * beamDir.y;
    const b = 2 * (ox * beamDir.x + oy * beamDir.y);
    const c = ox * ox + oy * oy - vessel.radius * vessel.radius;
    const d = b * b - 4 * a * c;
    if (d < 0) return false;
    const s = Math.sqrt(d);
    const t1 = (-b - s) / (2 * a);
    const t2 = (-b + s) / (2 * a);
    return t1 >= 0 || t2 >= 0;
  }, [beamDir.x, beamDir.y, probePose, vessel.radius, vessel.x, vessel.y]);

  const dopplerBaseHz = useMemo(() => {
    if (!vesselIntersects) return 0;
    const f0 = params.frequency ?? 5e6;
    const v = vessel.velocityCms / 100;
    const c = getTissueAtPoint(vessel.x, vessel.y, processed)?.speedOfSoundMps ?? 1540;
    const beamAngle = Math.atan2(beamDir.y, beamDir.x);
    const flowAngle = (vessel.flowAngleDeg * Math.PI) / 180;
    const theta = flowAngle - beamAngle;
    return (2 * f0 * v * Math.cos(theta)) / c;
  }, [beamDir.x, beamDir.y, params.frequency, processed, vessel.flowAngleDeg, vessel.velocityCms, vessel.x, vessel.y, vesselIntersects]);

  const updateParam = useCallback(<K extends keyof UltrasoundUIParams>(key: K, value: UltrasoundUIParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const normToCanvas = useCallback((x: number, y: number) => {
    return { cx: ((x + 1) / 2) * PHANTOM_SIZE, cy: ((1 - y) / 2) * PHANTOM_SIZE };
  }, []);

  const canvasToNorm = useCallback((x: number, y: number) => {
    return { nx: (x / PHANTOM_SIZE) * 2 - 1, ny: 1 - (y / PHANTOM_SIZE) * 2 };
  }, []);

  const paramFromPoint = useCallback((x: number, y: number) => {
    if (probePathMode === "ellipse") {
      if (!outerBoundary) return 0;

      const dx = x - outerBoundary.x0;
      const dy = y - outerBoundary.y0;
      const localX = dx * outerBoundary.cosPhi + dy * outerBoundary.sinPhi;
      const localY = -dx * outerBoundary.sinPhi + dy * outerBoundary.cosPhi;
      const theta = Math.atan2(
        localY / Math.max(outerBoundary.b, 1e-9),
        localX / Math.max(outerBoundary.a, 1e-9),
      );
      return ((theta / (2 * Math.PI)) % 1 + 1) % 1;
    }

    const b = PROBE_RECT_HALF;
    const cx = clamp(x, -b, b);
    const cy = clamp(y, -b, b);

    const dTop = Math.abs(cy - b);
    const dRight = Math.abs(cx - b);
    const dBottom = Math.abs(cy + b);
    const dLeft = Math.abs(cx + b);

    const minD = Math.min(dTop, dRight, dBottom, dLeft);
    const span = Math.max(2 * b, 1e-6);

    if (minD === dTop) {
      const s = clamp((cx + b) / span, 0, 1);
      return 0 + 0.25 * s;
    }
    if (minD === dRight) {
      const s = clamp((b - cy) / span, 0, 1);
      return 0.25 + 0.25 * s;
    }
    if (minD === dBottom) {
      const s = clamp((b - cx) / span, 0, 1);
      return 0.5 + 0.25 * s;
    }

    const s = clamp((cy + b) / span, 0, 1);
    return 0.75 + 0.25 * s;
  }, [outerBoundary, probePathMode]);

  const bmodeResetKey = useMemo(
    () => JSON.stringify({
      regions,
      amplitude: params.amplitude,
      frequency: params.frequency,
      maxDepthMm: params.maxDepthMm,
      numSamples: params.numSamples,
      phaseShiftDeg: params.phaseShiftDeg,
      spacing: params.spacing,
      steeringAngleDeg: params.steeringAngleDeg,
      windowType: params.windowType,
    }),
    [params.amplitude, params.frequency, params.maxDepthMm, params.numSamples, params.phaseShiftDeg, params.spacing, params.steeringAngleDeg, params.windowType, regions],
  );

  const resetBmode = useCallback(() => {
    const h = Math.max(64, Math.floor(params.numSamples));
    bmodeAmpRef.current = new Float32Array(BMODE_HISTORY_W * h);
    bmodeWriteIndexRef.current = 0;
    bmodeTotalColumnsRef.current = 0;
    setBmodeColumns(0);
    setAutoProgress(0);
    setBmodeViewOffset(0);

    const canvas = bmodeRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = BMODE_VIEW_W;
        canvas.height = h;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, BMODE_VIEW_W, h);
      }
    }
  }, [params.numSamples]);

  useEffect(() => {
    resetBmode();
  }, [bmodeResetKey, resetBmode]);

  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = PHANTOM_SIZE;
    canvas.height = PHANTOM_SIZE;

    ctx.fillStyle = PANEL_BG_ALT;
    ctx.fillRect(0, 0, PHANTOM_SIZE, PHANTOM_SIZE);

    for (let i = 0; i < processed.length; i += 1) {
      const e = processed[i];
      const c = normToCanvas(e.x0, e.y0);
      const rx = Math.max(1, (e.a / 2) * PHANTOM_SIZE);
      const ry = Math.max(1, (e.b / 2) * PHANTOM_SIZE);
      const gray = Math.round(18 + clamp(e.intensity, 0, 1) * 220);
      ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
      ctx.beginPath();
      ctx.ellipse(c.cx, c.cy, rx, ry, -e.phiRad, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hover) {
      const e = processed[hover.regionIndex];
      if (e) {
        const c = normToCanvas(e.x0, e.y0);
        const rx = Math.max(1, (e.a / 2) * PHANTOM_SIZE);
        const ry = Math.max(1, (e.b / 2) * PHANTOM_SIZE);
        ctx.strokeStyle = ACCENT_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(c.cx, c.cy, rx, ry, -e.phiRad, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (probePose) {
      const p = normToCanvas(probePose.x, probePose.y);
      const end = normToCanvas(probePose.x + beamDir.x * 1.8, probePose.y + beamDir.y * 1.8);
      const nX = -beamDir.y;
      const nY = beamDir.x;
      const bw = 0.035;
      const p1 = normToCanvas(probePose.x + nX * bw, probePose.y + nY * bw);
      const p2 = normToCanvas(probePose.x - nX * bw, probePose.y - nY * bw);
      const p3 = normToCanvas(probePose.x + beamDir.x * 1.45 - nX * bw * 0.35, probePose.y + beamDir.y * 1.45 - nY * bw * 0.35);
      const p4 = normToCanvas(probePose.x + beamDir.x * 1.45 + nX * bw * 0.35, probePose.y + beamDir.y * 1.45 + nY * bw * 0.35);

      ctx.fillStyle = PRIMARY_GLOW;
      ctx.beginPath();
      ctx.moveTo(p1.cx, p1.cy);
      ctx.lineTo(p2.cx, p2.cy);
      ctx.lineTo(p3.cx, p3.cy);
      ctx.lineTo(p4.cx, p4.cy);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = PRIMARY_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.cx, p.cy);
      ctx.lineTo(end.cx, end.cy);
      ctx.stroke();

      ctx.fillStyle = ACCENT_COLOR;
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    const vc = normToCanvas(vessel.x, vessel.y);
    const vr = (vessel.radius / 2) * PHANTOM_SIZE;
    ctx.fillStyle = vesselIntersects ? ACCENT_SOFT : PRIMARY_SOFT;
    ctx.strokeStyle = vesselIntersects ? ACCENT_COLOR : PRIMARY_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(vc.cx, vc.cy, vr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const flowRad = (vessel.flowAngleDeg * Math.PI) / 180;
    const fx = Math.cos(flowRad) * vr * 0.9;
    const fy = -Math.sin(flowRad) * vr * 0.9;
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.beginPath();
    ctx.moveTo(vc.cx - fx, vc.cy - fy);
    ctx.lineTo(vc.cx + fx, vc.cy + fy);
    ctx.stroke();

    ctx.strokeStyle = "rgba(189, 173, 220, 0.35)";
    ctx.strokeRect(0.5, 0.5, PHANTOM_SIZE - 1, PHANTOM_SIZE - 1);
  }, [beamDir.x, beamDir.y, hover, normToCanvas, probePose, processed, vessel.flowAngleDeg, vessel.radius, vessel.x, vessel.y, vesselIntersects]);

  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas) return;

    const onDown = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * PHANTOM_SIZE) / Math.max(rect.width, 1);
      const y = ((event.clientY - rect.top) * PHANTOM_SIZE) / Math.max(rect.height, 1);
      const p = canvasToNorm(x, y);

      if (probePose) {
        const pc = normToCanvas(probePose.x, probePose.y);
        if (Math.hypot(x - pc.cx, y - pc.cy) <= 14) {
          const next = paramFromPoint(p.nx, p.ny);
          if (next !== null) setProbeParam(next);
          setDragProbe(true);
          return;
        }
      }

      if (Math.hypot(p.nx - vessel.x, p.ny - vessel.y) <= vessel.radius) {
        vesselDragOffset.current = { dx: p.nx - vessel.x, dy: p.ny - vessel.y };
        setDragVessel(true);
      }
    };

    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const x = (localX * PHANTOM_SIZE) / Math.max(rect.width, 1);
      const y = (localY * PHANTOM_SIZE) / Math.max(rect.height, 1);
      const p = canvasToNorm(x, y);

      if (dragProbe) {
        const next = paramFromPoint(p.nx, p.ny);
        if (next !== null) setProbeParam(next);
        return;
      }

      if (dragVessel) {
        const tx = p.nx - vesselDragOffset.current.dx;
        const ty = p.ny - vesselDragOffset.current.dy;
        if (outerBoundary && ellipseContains(tx, ty, outerBoundary)) {
          setVessel((prev) => ({ ...prev, x: tx, y: ty }));
        }
        return;
      }

      let regionIndex = -1;
      for (let i = processed.length - 1; i >= 0; i -= 1) {
        if (ellipseContains(p.nx, p.ny, processed[i])) {
          regionIndex = i;
          break;
        }
      }

      if (regionIndex >= 0) setHover({ regionIndex });
      else setHover(null);
    };

    const onUp = () => {
      setDragProbe(false);
      setDragVessel(false);
    };

    const onClick = (event: MouseEvent) => {
      if (dragProbe || dragVessel) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) * PHANTOM_SIZE) / Math.max(rect.width, 1);
      const y = ((event.clientY - rect.top) * PHANTOM_SIZE) / Math.max(rect.height, 1);
      const p = canvasToNorm(x, y);
      for (let i = processed.length - 1; i >= 0; i -= 1) {
        if (ellipseContains(p.nx, p.ny, processed[i])) {
          setEditIndex(i);
          setEditDraft({ ...regions[i] });
          break;
        }
      }
    };

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    window.addEventListener("mouseup", onUp);

    return () => {
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
      window.removeEventListener("mouseup", onUp);
    };
  }, [canvasToNorm, dragProbe, dragVessel, normToCanvas, outerBoundary, paramFromPoint, probePose, processed, regions, vessel.radius, vessel.x, vessel.y]);

  useEffect(() => {
    const ampBuf = bmodeAmpRef.current;
    const canvas = bmodeRef.current;
    if (!ampBuf || !canvas) return;

    const h = Math.max(64, Math.floor(params.numSamples));
    const writeCol = bmodeWriteIndexRef.current;

    for (let i = 0; i < h; i += 1) {
      const srcIdx = Math.round((i / Math.max(h - 1, 1)) * (amode.amplitudes.length - 1));
      ampBuf[i * BMODE_HISTORY_W + writeCol] = amode.amplitudes[srcIdx];
    }

    bmodeWriteIndexRef.current = (writeCol + 1) % BMODE_HISTORY_W;
    bmodeTotalColumnsRef.current = Math.min(bmodeTotalColumnsRef.current + 1, BMODE_HISTORY_W);
    setBmodeColumns(bmodeTotalColumnsRef.current);

    const totalColumns = bmodeTotalColumnsRef.current;
    const startColumn = totalColumns < BMODE_HISTORY_W ? 0 : bmodeWriteIndexRef.current;
    const maxViewStart = Math.max(totalColumns - BMODE_VIEW_W, 0);
    const viewStart = clamp(bmodeViewOffset, 0, maxViewStart);
    const renderColumns = Math.min(BMODE_VIEW_W, Math.max(totalColumns - viewStart, 0));

    let maxAmp = 0;
    for (let x = 0; x < renderColumns; x += 1) {
      const srcCol = (startColumn + viewStart + x) % BMODE_HISTORY_W;
      for (let y = 0; y < h; y += 1) {
        const amp = ampBuf[y * BMODE_HISTORY_W + srcCol];
        if (amp > maxAmp) maxAmp = amp;
      }
    }
    maxAmp = Math.max(maxAmp, 1e-6);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = BMODE_VIEW_W;
    canvas.height = h;

    const image = ctx.createImageData(BMODE_VIEW_W, h);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    for (let x = 0; x < renderColumns; x += 1) {
      const srcCol = (startColumn + viewStart + x) % BMODE_HISTORY_W;
      for (let y = 0; y < h; y += 1) {
        const amp = ampBuf[y * BMODE_HISTORY_W + srcCol];
        const n = Math.log1p(amp) / Math.log1p(maxAmp);
        const g = Math.round(Math.pow(clamp(n, 0, 1), 0.42) * 255);
        const p = (y * BMODE_VIEW_W + x) * 4;
        data[p] = g;
        data[p + 1] = g;
        data[p + 2] = g;
      }
    }

    ctx.putImageData(image, 0, 0);
  }, [amode.amplitudes, bmodeViewOffset, params.numSamples]);

  useEffect(() => {
    if (!autoScan) return;
    setBmodeViewOffset(Math.max(bmodeColumns - BMODE_VIEW_W, 0));
  }, [autoScan, bmodeColumns]);

  useEffect(() => {
    if (!autoScan || autoScanPaused) return;
    let raf = 0;
    let current = probeParam;

    const tick = () => {
      current += AUTO_SCAN_STEP * autoScanSpeed;
      setProbeParam(current);
      const progress = clamp(current, 0, 1);
      setAutoProgress(progress);
      if (current >= 1) {
        setProbeParam(1);
        setAutoScan(false);
        setAutoScanPaused(false);
        setAutoProgress(1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoScan, autoScanPaused, autoScanSpeed, probeParam]);

  useEffect(() => {
    const canvas = beamFieldRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = BEAM_W;
    canvas.height = BEAM_H;

    const n = Math.max(1, Math.floor(params.numElements));
    const weights = windowWeights(params.windowType, n);
    const spacing = params.spacing;
    const steer = (((params.steeringAngleDeg ?? 0) + params.phaseShiftDeg) * Math.PI) / 180;
    const xSpan = n * spacing * 1.45;
    const ySpan = n * spacing * 4.3;
    const wave = 2 * Math.PI;

    const field = new Float32Array(BEAM_W * BEAM_H);
    let maxAbs = 0;

    for (let py = 0; py < BEAM_H; py += 1) {
      const y = (py / Math.max(BEAM_H - 1, 1)) * ySpan;
      for (let px = 0; px < BEAM_W; px += 1) {
        const x = (px / Math.max(BEAM_W - 1, 1) - 0.5) * xSpan;
        let re = 0;
        for (let k = 0; k < n; k += 1) {
          const ex = (k - (n - 1) / 2) * spacing;
          const r = Math.hypot(x - ex, y);
          const phase = wave * r - wave * ex * Math.sin(steer);
          re += weights[k] * Math.cos(phase);
        }
        const idx = py * BEAM_W + px;
        field[idx] = re;
        maxAbs = Math.max(maxAbs, Math.abs(re));
      }
    }

    const img = ctx.createImageData(BEAM_W, BEAM_H);
    const norm = Math.max(maxAbs, 1e-6);
    for (let i = 0; i < field.length; i += 1) {
      const c = Math.tanh((field[i] / norm) * 2.2);
      const p = i * 4;
      if (c >= 0) {
        img.data[p] = Math.round(10 + 18 * c);
        img.data[p + 1] = Math.round(70 + 170 * c);
        img.data[p + 2] = Math.round(90 + 150 * c);
      } else {
        const a = -c;
        img.data[p] = Math.round(70 + 170 * a);
        img.data[p + 1] = Math.round(14 + 40 * a);
        img.data[p + 2] = Math.round(30 + 60 * a);
      }
      img.data[p + 3] = 255;
    }

    ctx.putImageData(img, 0, 0);

    const cx = BEAM_W / 2;
    const ex = cx + Math.sin(steer) * BEAM_H * 0.95;
    const ey = Math.cos(steer) * BEAM_H * 0.95;
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [params.numElements, params.phaseShiftDeg, params.spacing, params.steeringAngleDeg, params.windowType]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const snr = Math.max(params.snrDb, 0);
      const noiseStd = snr <= 0 ? 40 : 40 / Math.sqrt(snr + 1);
      const phase = performance.now() * 0.001;
      const pulse = 0.62 + 0.28 * Math.sin(2 * Math.PI * 1.2 * phase) + 0.1 * Math.sin(2 * Math.PI * 2.4 * phase + 0.7);
      const fd = vesselIntersects
        ? dopplerBaseHz * pulse + gaussianNoise(noiseStd)
        : gaussianNoise(noiseStd * 1.6);

      setDopplerTrace((prev) => {
        const next = prev.slice(1);
        next.push({ fd });
        return next;
      });
    }, 40);

    return () => window.clearInterval(timer);
  }, [dopplerBaseHz, params.snrDb, vesselIntersects]);

  const applyRegionEdit = () => {
    if (editIndex === null || !editDraft) return;
    setRegions((prev) => prev.map((r, i) => (i === editIndex ? { ...editDraft } : r)));
    setEditIndex(null);
    setEditDraft(null);
  };

  const hoverRegion = hover ? processed[hover.regionIndex] : null;

  return (
    <MainLayout
      controlPanel={
        <ControlDashboard
          params={params}
          onParam={updateParam}
          vessel={vessel}
          onVessel={setVessel}
          probePathMode={probePathMode}
          onProbePathMode={(mode) => {
            setProbePathMode(mode);
            setAutoScan(false);
            setAutoScanPaused(false);
            setProbeParam(0);
            setAutoProgress(0);
          }}
          autoScan={autoScan}
          autoScanPaused={autoScanPaused}
          autoScanSpeed={autoScanSpeed}
          onAutoScanSpeed={setAutoScanSpeed}
          onStartAutoScan={() => {
            setProbeParam(0);
            setAutoProgress(0);
            resetBmode();
            setAutoScan(true);
            setAutoScanPaused(false);
          }}
          onPauseResumeAutoScan={() => setAutoScanPaused((v) => !v)}
          onStopAutoScan={() => {
            setAutoScan(false);
            setAutoScanPaused(false);
          }}
          onResetBmode={resetBmode}
        />
      }
    >
      <div className="ultra-layout-grid">
        <section className="glass-panel ultra-panel phantom-panel">
          <header className="ultra-panel-header phantom-header">
            <span>Phantom View</span>
            <span className="ultra-hint-inline">Drag probe on perimeter, drag vessel inside phantom, hover tissue, click tissue to edit.</span>
          </header>
          <div className="ultra-panel-body phantom-body">
            <canvas ref={phantomRef} className="ultra-phantom-canvas" />
            {hoverRegion && (
              <div className="ultra-tooltip">
                <div className="ultra-tooltip-title">{hoverRegion.label}</div>
                <div>Z: {hoverRegion.acousticImpedanceMrayl.toFixed(2)} MRayl</div>
                <div>c: {hoverRegion.speedOfSoundMps.toFixed(0)} m/s</div>
                <div>a: {hoverRegion.attenuationDbCmMhz.toFixed(2)} dB/cm/MHz</div>
                <div>Backscatter: {hoverRegion.backscatterCoeff.toFixed(2)}</div>
              </div>
            )}
          </div>
        </section>

        <section className="glass-panel ultra-panel amode-panel">
          <header className="ultra-panel-header">A-Mode (Amplitude vs Depth)</header>
          <div className="ultra-panel-body"><AModeCanvas data={amode} /></div>
        </section>

        <section className="glass-panel ultra-panel beam-panel">
          <header className="ultra-panel-header">Beam Field</header>
          <div className="ultra-panel-body beam-body"><canvas ref={beamFieldRef} className="ultra-beam-canvas" /></div>
        </section>

        <section className="glass-panel ultra-panel bottom-panel bmode-panel">
          <header className="ultra-panel-header">B-Mode Image</header>
          <progress className="ultra-progress" max={100} value={Math.round(autoProgress * 100)} />
          <div className="ultra-doppler-readout">
            <span>A-Mode columns stack left to right</span>
            <span>{bmodeColumns} cols</span>
          </div>
          <div className="ultra-control-row">
            <Label>B-Mode View</Label>
            <span>{bmodeViewOffset}</span>
          </div>
          <Slider
            value={[bmodeViewOffset]}
            min={0}
            max={Math.max(bmodeColumns - BMODE_VIEW_W, 0)}
            step={1}
            onValueChange={([v]) => setBmodeViewOffset(v)}
          />
          <div className="ultra-bmode-wrap"><canvas ref={bmodeRef} className="ultra-bmode-canvas" /></div>
        </section>

        <section className="glass-panel ultra-panel bottom-panel doppler-panel">
          <header className="ultra-panel-header">Doppler Mode</header>
          <div className="ultra-doppler-readout">
            <span>{vesselIntersects ? "Beam intersects vessel" : "Beam misses vessel"}</span>
            <span>fd = {dopplerBaseHz.toFixed(1)} Hz</span>
          </div>
          <div className="ultra-panel-body"><DopplerCanvas points={dopplerTrace} /></div>
        </section>
      </div>

      {editDraft && editIndex !== null && (
        <div className="ultra-modal-backdrop">
          <div className="ultra-modal">
            <h3>Edit Tissue Properties</h3>
            <label>
              Label
              <input value={editDraft.label} onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })} />
            </label>
            <label>
              Acoustic Impedance
              <input
                type="number"
                step="0.01"
                value={editDraft.acousticImpedanceMrayl}
                onChange={(e) => setEditDraft({ ...editDraft, acousticImpedanceMrayl: Number(e.target.value) })}
              />
            </label>
            <label>
              Speed of Sound
              <input
                type="number"
                step="1"
                value={editDraft.speedOfSoundMps}
                onChange={(e) => setEditDraft({ ...editDraft, speedOfSoundMps: Number(e.target.value) })}
              />
            </label>
            <label>
              Attenuation
              <input
                type="number"
                step="0.01"
                value={editDraft.attenuationDbCmMhz}
                onChange={(e) => setEditDraft({ ...editDraft, attenuationDbCmMhz: Number(e.target.value) })}
              />
            </label>
            <div className="ultra-modal-actions">
              <button type="button" onClick={applyRegionEdit}>Apply</button>
              <button type="button" onClick={() => { setEditDraft(null); setEditIndex(null); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
}

import { memo, useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
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
const BMODE_VIEW_W = 440;
const BMODE_LOG_EPSILON = 1e-3;
const BMODE_FIXED_FOV_DEG = 72;
const BMODE_APEX_Y_PX = 18;
const BMODE_EDGE_DERIV_SCALE = 36;
const BMODE_AMP_NORM_REF = 1.2;
const DOPPLER_AXIS_RANGE_HZ = 500;
const DOPPLER_DT_SEC = 0.04;
const DOPPLER_FADE_TO_ZERO_SEC = 0.1;
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
  { regionId: 1, label: "Background Soft Tissue", intensity: 1.0, a: 0.69, b: 0.92, x0: 0.0, y0: 0.0, phiDeg: 0.0, acousticImpedanceMrayl: 1.54, attenuationDbCmMhz: 0.42, backscatterCoeff: 0.14, speedOfSoundMps: 1540, scatterDensity: 0.30, boundaryRoughness: 0.22 },
  { regionId: 2, label: "CSF/Ventricle-like Region", intensity: -0.8, a: 0.6624, b: 0.874, x0: 0.0, y0: -0.0184, phiDeg: 0.0, acousticImpedanceMrayl: 1.51, attenuationDbCmMhz: 0.02, backscatterCoeff: 0.06, speedOfSoundMps: 1505, scatterDensity: 0.10, boundaryRoughness: 0.10 },
  { regionId: 3, label: "Dense Lesion A", intensity: -0.2, a: 0.11, b: 0.31, x0: 0.22, y0: 0.0, phiDeg: -18.0, acousticImpedanceMrayl: 1.72, attenuationDbCmMhz: 0.85, backscatterCoeff: 0.44, speedOfSoundMps: 1570, scatterDensity: 0.62, boundaryRoughness: 0.48 },
  { regionId: 4, label: "Dense Lesion B", intensity: -0.2, a: 0.16, b: 0.41, x0: -0.22, y0: 0.0, phiDeg: 18.0, acousticImpedanceMrayl: 1.68, attenuationDbCmMhz: 0.78, backscatterCoeff: 0.40, speedOfSoundMps: 1560, scatterDensity: 0.58, boundaryRoughness: 0.46 },
  { regionId: 5, label: "Parenchyma-like Region", intensity: 0.1, a: 0.21, b: 0.25, x0: 0.0, y0: 0.35, phiDeg: 0.0, acousticImpedanceMrayl: 1.65, attenuationDbCmMhz: 0.60, backscatterCoeff: 0.32, speedOfSoundMps: 1545, scatterDensity: 0.50, boundaryRoughness: 0.40 },
  { regionId: 6, label: "Calcification 1", intensity: 0.1, a: 0.046, b: 0.046, x0: 0.0, y0: 0.1, phiDeg: 0.0, acousticImpedanceMrayl: 5.50, attenuationDbCmMhz: 6.00, backscatterCoeff: 0.85, speedOfSoundMps: 3200, scatterDensity: 0.25, boundaryRoughness: 0.82 },
  { regionId: 7, label: "Calcification 2", intensity: 0.1, a: 0.046, b: 0.046, x0: 0.0, y0: -0.1, phiDeg: 0.0, acousticImpedanceMrayl: 5.20, attenuationDbCmMhz: 5.40, backscatterCoeff: 0.80, speedOfSoundMps: 3000, scatterDensity: 0.22, boundaryRoughness: 0.78 },
  { regionId: 8, label: "Cystic Node 1", intensity: 0.1, a: 0.046, b: 0.023, x0: -0.08, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.49, attenuationDbCmMhz: 0.04, backscatterCoeff: 0.04, speedOfSoundMps: 1490, scatterDensity: 0.08, boundaryRoughness: 0.08 },
  { regionId: 9, label: "Cystic Node 2", intensity: 0.1, a: 0.023, b: 0.023, x0: 0.0, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.50, attenuationDbCmMhz: 0.05, backscatterCoeff: 0.05, speedOfSoundMps: 1495, scatterDensity: 0.09, boundaryRoughness: 0.09 },
  { regionId: 10, label: "Cystic Node 3", intensity: 0.1, a: 0.023, b: 0.046, x0: 0.06, y0: -0.605, phiDeg: 0.0, acousticImpedanceMrayl: 1.52, attenuationDbCmMhz: 0.05, backscatterCoeff: 0.05, speedOfSoundMps: 1500, scatterDensity: 0.09, boundaryRoughness: 0.09 },
];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function normalizeAngle(angleRad: number): number {
  let a = angleRad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function stableNoise2D(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return s - Math.floor(s);
}

function windowBroadeningFactor(windowType: WindowType): number {
  if (windowType === "hamming") return 1.18;
  if (windowType === "hanning") return 1.24;
  if (windowType === "blackman") return 1.36;
  if (windowType === "kaiser") return 1.32;
  return 1.0;
}

// Cached Box-Muller: generates two independent Gaussian samples per call;
// the spare is stored and returned on the next invocation, halving cost.
let _spareGaussian: number | null = null;
function gaussianNoise(std: number): number {
  if (std <= 0) return 0;
  if (_spareGaussian !== null) {
    const val = _spareGaussian * std;
    _spareGaussian = null;
    return val;
  }
  const u = Math.max(Math.random(), 1e-12);
  const v = Math.random();
  const mag = Math.sqrt(-2 * Math.log(u));
  _spareGaussian = mag * Math.sin(2 * Math.PI * v);
  return mag * Math.cos(2 * Math.PI * v) * std;
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
    const dtSec = 0.04;

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

    // fd = 0 reference line
    ctx.strokeStyle = "rgba(206, 188, 235, 0.7)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(left, mid);
    ctx.lineTo(right, mid);
    ctx.stroke();
    ctx.setLineDash([]);

    const axisRangeHz = DOPPLER_AXIS_RANGE_HZ;

    const xAt = (i: number) => right - (i / Math.max(points.length - 1, 1)) * (right - left);
    const yAt = (fd: number) => mid - (fd / axisRangeHz) * ((bottom - top) * 0.45);

    // Positive fd (toward probe) in red, negative fd (away) in blue.
    ctx.lineWidth = 1.35;
    for (let i = 1; i < points.length; i += 1) {
      const fd0Raw = points[i - 1].fd;
      const fd1Raw = points[i].fd;
      const fd0 = Number.isFinite(fd0Raw) ? clamp(fd0Raw, -axisRangeHz, axisRangeHz) : 0;
      const fd1 = Number.isFinite(fd1Raw) ? clamp(fd1Raw, -axisRangeHz, axisRangeHz) : 0;
      const x0 = xAt(i - 1);
      const x1 = xAt(i);
      const y0 = yAt(fd0);
      const y1 = yAt(fd1);
      const segFd = (fd0 + fd1) * 0.5;

      ctx.strokeStyle = segFd >= 0 ? "rgba(255, 96, 96, 0.95)" : "rgba(96, 170, 255, 0.95)";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Y-axis labels in Hz
    ctx.fillStyle = "rgba(230, 221, 250, 0.95)";
    ctx.font = "10px JetBrains Mono";
    const yLabels = [-500, -250, 0, 250, 500];
    for (let i = 0; i < yLabels.length; i += 1) {
      const v = yLabels[i];
      const y = yAt(v);
      if (y < top - 2 || y > bottom + 2) continue;
      const sign = v > 0 ? "+" : "";
      ctx.fillText(`${sign}${v}`, 2, y + 3);
    }

    // X-axis labels (latest sample at right = 0 s)
    const totalSec = (points.length - 1) * dtSec;
    const xTicks = 5;
    for (let i = 0; i <= xTicks; i += 1) {
      const frac = i / xTicks;
      const x = left + frac * (right - left);
      const t = -totalSec * (1 - frac);
      ctx.fillText(`${t.toFixed(1)}s`, x - 12, cssHeight - 6);
    }

    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "11px JetBrains Mono";
    ctx.fillText("Time (s)", Math.max(left + 120, Math.round(cssWidth * 0.45)), cssHeight - 18);
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
  const bmodeRef = useRef<HTMLCanvasElement>(null);

  const [dopplerTrace, setDopplerTrace] = useState<DopplerPoint[]>(() => Array.from({ length: TRACE_LEN }, () => ({ fd: 0 })));
  const dopplerBaseHzRef = useRef(0);
  const vesselIntersectsRef = useRef(false);
  const dopplerFdRef = useRef(0);
  const dopplerGainRef = useRef(1);
  const dopplerNoiseHzRef = useRef(0);

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

  const beamModel = useMemo(() => {
    const n = Math.max(4, params.numElements);
    const spacing = Math.max(0.1, params.spacing);
    const freqMHz = Math.max((params.frequency ?? 5e6) / 1e6, 0.1);
    const broadening = windowBroadeningFactor(params.windowType);
    const apodizationFactor = params.apodizationEnabled === false ? 0.9 : 1.0;

    const angularSigmaRad = clamp((0.5 / Math.sqrt(n * spacing)) * broadening * apodizationFactor, 0.04, 0.55);
    const axialResolutionMm = clamp((1.9 * (5 / freqMHz)) * Math.pow(64 / n, 0.28) * Math.pow(spacing / 0.3, 0.18), 0.35, 6.0);
    const beamGain = clamp((Math.sqrt(n / 64) * Math.sqrt(0.3 / spacing)) / broadening * (params.apodizationEnabled === false ? 1.1 : 1.0), 0.45, 2.4);
    const dopplerGain = clamp(beamGain * Math.sqrt(Math.max(params.amplitude, 0.1)), 0.4, 2.6);

    return {
      angularSigmaRad,
      axialResolutionMm,
      beamGain,
      dopplerGain,
    };
  }, [params.amplitude, params.apodizationEnabled, params.frequency, params.numElements, params.spacing, params.windowType]);

  const amode = useMemo<AModeData>(() => {
    const samples = Math.max(128, Math.floor(params.numSamples));
    const depthsMm = new Float32Array(samples);
    const amplitudes = new Float32Array(samples);
    const spikesMm: number[] = [];
    const sampleTissue: Array<ProcessedEllipse | null> = new Array(samples).fill(null);
    const sampleAttenuation = new Float32Array(samples);

    if (!probePose) return { depthsMm, amplitudes, spikesMm };

    const phantomHalfSpanNorm = outerBoundary ? Math.max(outerBoundary.a, outerBoundary.b) : 1;
    const phantomAxialSpanNorm = Math.max(2 * phantomHalfSpanNorm, 1e-6);
    const mmPerNorm = params.maxDepthMm / phantomAxialSpanNorm;
    const freqMHz = Math.max((params.frequency ?? 5e6) / 1e6, 0.1);
    const sampleStepMm = params.maxDepthMm / Math.max(samples - 1, 1);
    const kernelHalf = clamp(Math.round(beamModel.axialResolutionMm / Math.max(sampleStepMm, 1e-6)), 1, 6);
    const kernelSigma = Math.max(0.75, kernelHalf * 0.55);
    const snrLinear = Math.pow(10, Math.max(params.snrDb, 0) / 20);
    const noiseStd = params.noiseEnabled === false ? 0 : (Math.max(params.amplitude, 0.05) / Math.max(snrLinear, 1e-9));

    for (let i = 0; i < samples; i += 1) {
      const depthMm = (i / Math.max(samples - 1, 1)) * params.maxDepthMm;
      depthsMm[i] = depthMm;

      const rayDistanceNorm = depthMm / Math.max(mmPerNorm, 1e-9);
      const px = probePose.x + beamDir.x * rayDistanceNorm;
      const py = probePose.y + beamDir.y * rayDistanceNorm;
      const tissue = getTissueAtPoint(px, py, processed);
      sampleTissue[i] = tissue;

      const medium = tissue ?? (i > 0 ? sampleTissue[i - 1] : null);
      if (!medium) {
        sampleAttenuation[i] = i > 0 ? sampleAttenuation[i - 1] : 1;
        amplitudes[i] = 0;
        continue;
      }

      const depthCm = depthMm / 10;
      const attenuationDb = medium.attenuationDbCmMhz * freqMHz * depthCm;
      sampleAttenuation[i] = Math.pow(10, -attenuationDb / 20);
      amplitudes[i] = 0;
    }

    // Boundary-only echoes from impedance discontinuities.
    const couplingImpedanceMrayl = 0.2;
    for (let i = 1; i < samples; i += 1) {
      const prev = sampleTissue[i - 1];
      const curr = sampleTissue[i];
      const prevRegion = prev?.regionId ?? -1;
      const currRegion = curr?.regionId ?? -1;
      if (prevRegion === currRegion) continue;

      const zPrev = prev?.acousticImpedanceMrayl ?? couplingImpedanceMrayl;
      const zCurr = curr?.acousticImpedanceMrayl ?? couplingImpedanceMrayl;
      const r = Math.abs(zCurr - zPrev) / Math.max(zCurr + zPrev, 1e-6);
      if (r < 1e-3) continue;

      spikesMm.push(depthsMm[i]);

      const attenuationLinear = sampleAttenuation[i] || 1;
      const enteringOrLeavingBody = !prev || !curr;
      const regionBoundary = !!prev && !!curr && prev.regionId !== curr.regionId;
      let reflectionGain = enteringOrLeavingBody ? 9.0 : 2.6;
      if (regionBoundary) reflectionGain *= 0.9;
      const interfaceEcho = clamp(params.amplitude * beamModel.beamGain * attenuationLinear * r * reflectionGain, 0, 3);

      for (let k = -kernelHalf; k <= kernelHalf; k += 1) {
        const ii = i + k;
        if (ii < 0 || ii >= samples) continue;
        const kernel = Math.exp(-(k * k) / (2 * kernelSigma * kernelSigma));
        amplitudes[ii] = clamp(amplitudes[ii] + interfaceEcho * kernel, 0, 3);
      }
    }

    if (noiseStd > 0) {
      for (let i = 0; i < samples; i += 1) {
        const n = (stableNoise2D(probePose.x * 131.1 + i * 0.37, probePose.y * 173.3 + i * 0.19) - 0.5) * 2;
        amplitudes[i] = clamp(amplitudes[i] + n * noiseStd * 0.7, 0, 3);
      }
    }

    return { depthsMm, amplitudes, spikesMm };
  }, [beamDir.x, beamDir.y, beamModel.axialResolutionMm, beamModel.beamGain, outerBoundary, params.amplitude, params.frequency, params.maxDepthMm, params.noiseEnabled, params.numSamples, params.snrDb, probePose, processed]);

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
    const frequencyMHz = (params.frequency ?? 5e6) / 1e6;
    const velocityCms = vessel.velocityCms;
    const beamAngleDeg = (Math.atan2(beamDir.y, beamDir.x) * 180) / Math.PI;
    const flowDirectionDeg = vessel.flowAngleDeg;
    const thetaDeg = Math.abs(normalizeAngle(((beamAngleDeg - flowDirectionDeg) * Math.PI) / 180)) * (180 / Math.PI);
    const fd = (2 * frequencyMHz * 1e6 * velocityCms * 0.01 * Math.cos((thetaDeg * Math.PI) / 180)) / 1540;
    return fd;
  }, [beamDir.x, beamDir.y, params.frequency, vessel.flowAngleDeg, vessel.velocityCms, vesselIntersects]);

  const currentFdHz = dopplerTrace[0]?.fd ?? 0;

  useEffect(() => {
    dopplerBaseHzRef.current = dopplerBaseHz;
    vesselIntersectsRef.current = vesselIntersects;
    dopplerGainRef.current = beamModel.dopplerGain;
    const snrLinear = Math.pow(10, Math.max(params.snrDb, 0) / 20);
    dopplerNoiseHzRef.current = params.noiseEnabled === false ? 0 : DOPPLER_AXIS_RANGE_HZ / Math.max(snrLinear, 1e-9) * 0.16;
  }, [beamModel.dopplerGain, dopplerBaseHz, params.noiseEnabled, params.snrDb, vesselIntersects]);

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
    const h = Math.max(220, Math.floor(params.numSamples));
    setAutoProgress(0);

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
      // Preserve negative Shepp-Logan intensities so dark brain regions remain visible.
      const intensityMapped = clamp((e.intensity + 0.8) / 1.8, 0, 1);
      const gray = Math.round(14 + intensityMapped * 226);
      ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
      ctx.beginPath();
      ctx.ellipse(c.cx, c.cy, rx, ry, -e.phiRad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Phantom spatial grid overlay (semi-transparent) with depth labels.
    const gridDivisions = 7;
    const mmPerDivision = params.maxDepthMm / gridDivisions;
    ctx.strokeStyle = "rgba(210, 228, 255, 0.20)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridDivisions; i += 1) {
      const x = (i / gridDivisions) * PHANTOM_SIZE;
      const y = (i / gridDivisions) * PHANTOM_SIZE;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, PHANTOM_SIZE);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(PHANTOM_SIZE, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(232, 241, 255, 0.75)";
    ctx.font = "10px JetBrains Mono";
    for (let i = 1; i <= gridDivisions; i += 1) {
      const mm = i * mmPerDivision;
      const cm = mm / 10;
      const x = (i / gridDivisions) * PHANTOM_SIZE;
      const y = (i / gridDivisions) * PHANTOM_SIZE;
      ctx.fillText(`${mm.toFixed(0)}mm`, x + 2, 12);
      ctx.fillText(`${cm.toFixed(1)}cm`, 4, Math.max(12, y - 3));
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
  }, [beamDir.x, beamDir.y, hover, normToCanvas, params.maxDepthMm, probePose, processed, vessel.flowAngleDeg, vessel.radius, vessel.x, vessel.y, vesselIntersects]);

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
    const canvas = bmodeRef.current;
    if (!canvas || !probePose) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const samples = Math.max(128, Math.floor(params.numSamples));
    const cssW = Math.max(260, Math.floor(canvas.clientWidth || BMODE_VIEW_W));
    const cssH = Math.max(260, Math.floor(canvas.clientHeight || cssW));
    const canvasSize = Math.max(260, Math.min(cssW, cssH));
    const canvasW = canvasSize;
    const canvasH = canvasSize;
    canvas.width = canvasW;
    canvas.height = canvasH;

    // Fixed display window: apex/angle/depth range stay constant.
    const apexX = (canvasW - 1) * 0.5;
    const apexY = BMODE_APEX_Y_PX;

    const lineCount = 220;
    const halfFovRad = (BMODE_FIXED_FOV_DEG * Math.PI) / 360;
    const centerAngleRad = Math.PI / 2;

    const phantomHalfSpanNorm = outerBoundary ? Math.max(outerBoundary.a, outerBoundary.b) : 1;
    const phantomAxialSpanNorm = Math.max(2 * phantomHalfSpanNorm, 1e-6);
    const mmPerNorm = params.maxDepthMm / phantomAxialSpanNorm;
    const freqMHz = Math.max((params.frequency ?? 5e6) / 1e6, 0.1);

    const maxSectorRadius = Math.max(1, canvasH - apexY - 10);

    const sectorAmplitudes = new Float32Array(lineCount * samples);
    const couplingImpedanceMrayl = 0.2;
    const snrLinear = Math.pow(10, Math.max(params.snrDb, 0) / 20);
    const noiseStdBase = params.noiseEnabled === false ? 0 : (Math.max(params.amplitude, 0.05) / Math.max(snrLinear, 1e-9));

    for (let line = 0; line < lineCount; line += 1) {
      const t = lineCount <= 1 ? 0.5 : line / (lineCount - 1);
      const localOffsetRad = (t - 0.5) * (2 * halfFovRad);
      const beamWeight = Math.exp(-(localOffsetRad * localOffsetRad) / (2 * beamModel.angularSigmaRad * beamModel.angularSigmaRad));

      // World-space ray for phantom sampling follows the actual beam direction.
      const worldRayX = beamDir.x * Math.cos(localOffsetRad) - beamDir.y * Math.sin(localOffsetRad);
      const worldRayY = beamDir.x * Math.sin(localOffsetRad) + beamDir.y * Math.cos(localOffsetRad);

      let prevTissue: ProcessedEllipse | null = null;
      for (let i = 0; i < samples; i += 1) {
        const depthMm = (i / Math.max(samples - 1, 1)) * params.maxDepthMm;
        const rayDistanceNorm = depthMm / Math.max(mmPerNorm, 1e-9);
        const px = probePose.x + worldRayX * rayDistanceNorm;
        const py = probePose.y + worldRayY * rayDistanceNorm;
        const tissue = getTissueAtPoint(px, py, processed);

        let amp = 0;
        const medium = tissue ?? prevTissue;
        let attenuationLinear = 1;
        if (medium) {
          const depthCm = depthMm / 10;
          const attenuationDb = medium.attenuationDbCmMhz * freqMHz * depthCm;
          attenuationLinear = Math.pow(10, -attenuationDb / 20);
        }

        const prevRegion = prevTissue?.regionId ?? -1;
        const currRegion = tissue?.regionId ?? -1;
        const zPrev = prevTissue?.acousticImpedanceMrayl ?? couplingImpedanceMrayl;
        const zCurr = tissue?.acousticImpedanceMrayl ?? couplingImpedanceMrayl;
        const r = Math.abs(zCurr - zPrev) / Math.max(zCurr + zPrev, 1e-6);
        if (prevRegion !== currRegion && r > 1e-3) {
          const enteringOrLeavingBody = !prevTissue || !tissue;
          const regionBoundary = !!prevTissue && !!tissue && prevTissue.regionId !== tissue.regionId;
          let reflectionGain = enteringOrLeavingBody ? 9.0 : 2.6;
          if (regionBoundary) reflectionGain *= 0.9;
          amp += params.amplitude * beamModel.beamGain * beamWeight * attenuationLinear * r * reflectionGain;
        }

        if (noiseStdBase > 0) {
          const n = (stableNoise2D(px * 53.2 + line * 0.31, py * 37.9 + i * 0.17) - 0.5) * 2;
          amp += n * noiseStdBase * 0.18;
        }

        // Keep dynamic headroom for log mapping so bright boundaries can emerge.
        sectorAmplitudes[line * samples + i] = clamp(amp, 0, 5);
        prevTissue = tissue;
      }
    }

    const image = ctx.createImageData(canvasW, canvasH);
    const data = image.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }

    const invFov = 1 / Math.max(2 * halfFovRad, 1e-9);
    const invRadius = 1 / Math.max(maxSectorRadius, 1e-9);

    for (let y = 0; y < canvasH; y += 1) {
      for (let x = 0; x < canvasW; x += 1) {
        const dx = x - apexX;
        const dy = y - apexY;
        const radius = Math.hypot(dx, dy);
        if (radius > maxSectorRadius) continue;

        const pixelAngleRad = Math.atan2(dy, dx);
        const delta = normalizeAngle(pixelAngleRad - centerAngleRad);
        if (Math.abs(delta) > halfFovRad) continue;

        const u = clamp((delta + halfFovRad) * invFov, 0, 1);
        const v = clamp(radius * invRadius, 0, 1);

        const lineIdx = Math.round(u * (lineCount - 1));
        const depthIdx = Math.round(v * (samples - 1));
        const idx = lineIdx * samples + depthIdx;
        const amp = sectorAmplitudes[idx];
        const prevAmp = depthIdx > 0 ? sectorAmplitudes[idx - 1] : amp;
        const nextAmp = depthIdx < samples - 1 ? sectorAmplitudes[idx + 1] : amp;
        const amplitudeDerivative = 0.5 * Math.abs(amp - prevAmp) + 0.5 * Math.abs(nextAmp - amp);

        // Mixed boundary mapping: strong reflectors + boundary transitions.
        const ampNorm = clamp(amp / BMODE_AMP_NORM_REF, 0, 1);
        const derivNorm = clamp(amplitudeDerivative * BMODE_EDGE_DERIV_SCALE, 0, 1);
        const mix = clamp(ampNorm * 0.3 + derivNorm * 0.7, 0, 1);
        const g = Math.round(mix * 255);

        const p = (y * canvasW + x) * 4;
        data[p] = g;
        data[p + 1] = g;
        data[p + 2] = g;
      }
    }

    ctx.putImageData(image, 0, 0);

    // Sector grid overlay: radial depth lines (mm) + angular lines (deg).
    ctx.save();
    ctx.strokeStyle = "rgba(210, 228, 255, 0.14)";
    ctx.lineWidth = 1;

    const radialTicks = 6;
    for (let i = 1; i <= radialTicks; i += 1) {
      const depthMm = (i / radialTicks) * params.maxDepthMm;
      const r = (depthMm / Math.max(params.maxDepthMm, 1e-9)) * maxSectorRadius;
      ctx.beginPath();
      ctx.arc(apexX, apexY, r, centerAngleRad - halfFovRad, centerAngleRad + halfFovRad);
      ctx.stroke();

      const lx = apexX + Math.cos(centerAngleRad) * r;
      const ly = apexY + Math.sin(centerAngleRad) * r;
      ctx.fillStyle = "rgba(232, 241, 255, 0.58)";
      ctx.font = "10px JetBrains Mono";
      ctx.fillText(`${depthMm.toFixed(0)} mm`, lx + 5, ly - 3);
    }

    const halfFovDeg = BMODE_FIXED_FOV_DEG / 2;
    const startDeg = -Math.floor(halfFovDeg / 10) * 10;
    const endDeg = Math.floor(halfFovDeg / 10) * 10;
    for (let aDeg = startDeg; aDeg <= endDeg; aDeg += 10) {
      const aRad = centerAngleRad + (aDeg * Math.PI) / 180;
      const x2 = apexX + Math.cos(aRad) * maxSectorRadius;
      const y2 = apexY + Math.sin(aRad) * maxSectorRadius;
      ctx.beginPath();
      ctx.moveTo(apexX, apexY);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      const labelR = maxSectorRadius * 0.92;
      const lx = apexX + Math.cos(aRad) * labelR;
      const ly = apexY + Math.sin(aRad) * labelR;
      const sign = aDeg > 0 ? "+" : "";
      ctx.fillStyle = "rgba(232, 241, 255, 0.58)";
      ctx.font = "10px JetBrains Mono";
      ctx.fillText(`${sign}${aDeg.toFixed(0)} deg`, lx + 3, ly - 2);
    }
    ctx.restore();
  }, [beamDir.x, beamDir.y, beamModel.angularSigmaRad, beamModel.beamGain, outerBoundary, params.amplitude, params.frequency, params.maxDepthMm, params.noiseEnabled, params.numSamples, params.snrDb, probePose, processed]);

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
    const timer = window.setInterval(() => {
      const phase = performance.now() * 0.001;
      const pulse = 0.78 + 0.22 * Math.sin(2 * Math.PI * 1.15 * phase) + 0.08 * Math.sin(2 * Math.PI * 2.3 * phase + 0.7);
      const targetFd = vesselIntersectsRef.current
        ? dopplerBaseHzRef.current * dopplerGainRef.current * pulse
        : 0;

      let fd = targetFd;
      if (!vesselIntersectsRef.current) {
        const alpha = clamp(DOPPLER_DT_SEC / DOPPLER_FADE_TO_ZERO_SEC, 0, 1);
        fd = dopplerFdRef.current + (targetFd - dopplerFdRef.current) * alpha;
        if (Math.abs(fd) < 0.5) fd = 0;
      }
      if (vesselIntersectsRef.current && dopplerNoiseHzRef.current > 0) {
        fd += gaussianNoise(dopplerNoiseHzRef.current);
      }
      dopplerFdRef.current = fd;

      setDopplerTrace((prev) => {
        // Newest sample at index 0 -> plotted at right edge, older samples scroll left.
        const next = prev.slice(0, TRACE_LEN - 1);
        next.unshift({ fd });
        return next;
      });
    }, DOPPLER_DT_SEC * 1000);

    return () => window.clearInterval(timer);
  }, []);

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

        <section className="glass-panel ultra-panel bottom-panel bmode-panel">
          <header className="ultra-panel-header">B-Mode Sector Image</header>
          <progress className="ultra-progress" max={100} value={Math.round(autoProgress * 100)} />
          <div className="ultra-doppler-readout">
            <span>Fixed sector window; content updates with current probe position</span>
            <span>FOV {BMODE_FIXED_FOV_DEG.toFixed(0)} deg</span>
          </div>
          <div className="ultra-bmode-wrap"><canvas ref={bmodeRef} className="ultra-bmode-canvas" /></div>
        </section>

        <section className="glass-panel ultra-panel bottom-panel doppler-panel">
          <header className="ultra-panel-header">Doppler Mode</header>
          <div className="ultra-doppler-readout">
            <span>{vesselIntersects ? "Beam intersects vessel" : "Beam misses vessel"}</span>
            <span className="ultra-fd-live">fd = {currentFdHz.toFixed(1)} Hz</span>
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

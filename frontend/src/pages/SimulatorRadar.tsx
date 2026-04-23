import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import {
  useRadarSimulatorAPI,
  SimulatorRadarResponse,
  RadarTarget,
} from "@/hooks/useRadarSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./SimulatorRadar.css";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

// ─── Math helpers ─────────────────────────────────────────────────────────────

function sincNorm(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function clampAngleDeg360(a: number): number {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function makeWindowWeights(type: string, n: number): number[] {
  const N = Math.max(1, Math.floor(n));
  if (N === 1) return [1];
  const w = new Array<number>(N).fill(1);
  const twoPi = 2 * Math.PI;
  switch (type) {
    case "hamming":
      for (let i = 0; i < N; i++)
        w[i] = 0.54 - 0.46 * Math.cos((twoPi * i) / (N - 1));
      break;
    case "hanning":
    case "hann":
      for (let i = 0; i < N; i++)
        w[i] = 0.5 - 0.5 * Math.cos((twoPi * i) / (N - 1));
      break;
    case "blackman":
      for (let i = 0; i < N; i++) {
        const a = (twoPi * i) / (N - 1);
        w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
      }
      break;
    default:
      break;
  }
  const norm = Math.max(
    1e-9,
    w.reduce((s, x) => s + Math.abs(x), 0),
  );
  return w.map((x) => x / norm);
}

/**
 * ULA (linear) array factor magnitude.
 * spacingOverLambda = d/λ
 * thetaRelRad = angle relative to boresight (radians)
 * phaseOffsetRad = extra per-element phase from steering
 */
function computeAF_Linear(
  n: number,
  spacingOverLambda: number,
  thetaRelRad: number,
  weights: number[],
  phaseOffsetRad = 0,
): number {
  const N = Math.max(1, Math.floor(n));
  if (N === 1) return 1;
  const psi = Math.PI * spacingOverLambda * Math.sin(thetaRelRad);
  const w0 = weights[0] ?? 1;
  const isRect =
    weights.every((w) => Math.abs(w - w0) < 1e-6) &&
    Math.abs(phaseOffsetRad) < 1e-9;
  if (isRect) {
    if (Math.abs(psi) < 1e-9) return 1;
    const num = Math.sin(N * psi);
    const den = N * Math.sin(psi);
    return Math.abs(den) < 1e-15 ? 1 : Math.abs(num / den);
  }
  let re = 0,
    im = 0;
  const center = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    const phase = (i - center) * 2 * psi + phaseOffsetRad;
    const wi = weights[i] ?? 0;
    re += wi * Math.cos(phase);
    im += wi * Math.sin(phase);
  }
  return Math.sqrt(re * re + im * im);
}

/**
 * Curved (circular arc) array factor magnitude.
 * Elements are placed on a circular arc of radius R (in wavelengths).
 * The arc spans from -arcHalfSpan to +arcHalfSpan around the boresight.
 * steeringRad = steering angle in radians
 */
function computeAF_Curved(
  n: number,
  spacingOverLambda: number,
  thetaObsRad: number,
  weights: number[],
  radiusOverLambda: number,
  steeringRad = 0,
): number {
  const N = Math.max(1, Math.floor(n));
  if (N === 1) return 1;

  // Arc spans N elements with spacing d/λ → total arc length = (N-1)*d/λ
  // Angular span = (N-1)*d/λ / R (arc length / radius, in radians)
  const arcHalfSpan = ((N - 1) * spacingOverLambda) / (2 * radiusOverLambda);

  let re = 0,
    im = 0;
  for (let i = 0; i < N; i++) {
    // Angle of this element on the arc
    const elemAngle = -arcHalfSpan + (i / (N - 1)) * 2 * arcHalfSpan;
    // Element x,y position (in wavelengths)
    const ex = radiusOverLambda * Math.sin(elemAngle);
    const ey = radiusOverLambda * (Math.cos(elemAngle) - 1); // offset from centre

    // Phase = k * (x*sin(theta) + y*cos(theta)) — 2D phase contribution
    const k = 2 * Math.PI;
    const elemPhase =
      k * (ex * Math.sin(thetaObsRad) + ey * Math.cos(thetaObsRad));

    // Steering phase: phase delay to steer main lobe to steeringRad
    const steerPhase =
      k * (ex * Math.sin(steeringRad) + ey * Math.cos(steeringRad));

    const wi = weights[i] ?? 1 / N;
    const totalPhase = elemPhase - steerPhase;
    re += wi * Math.cos(totalPhase);
    im += wi * Math.sin(totalPhase);
  }
  return Math.sqrt(re * re + im * im);
}

/** Dispatch to the right AF function based on geometry string. */
function computeArrayFactor(
  n: number,
  spacingOverLambda: number,
  thetaRelRad: number,
  weights: number[],
  phaseOffsetRad = 0,
  geometry = "linear",
  radiusOverLambda = 5,
): number {
  if (geometry === "curved") {
    return computeAF_Curved(
      n,
      spacingOverLambda,
      thetaRelRad,
      weights,
      Math.max(0.5, radiusOverLambda),
      phaseOffsetRad,
    );
  }
  return computeAF_Linear(
    n,
    spacingOverLambda,
    thetaRelRad,
    weights,
    phaseOffsetRad,
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DETECTION_RANGE_M = 10;
const FLASH_DURATION_MS = 500;
const PPI_FADE_MS = 8000; // how long PPI dots stay visible

const TARGET_COLORS = [
  "hsl(200,90%,60%)",
  "hsl(130,80%,55%)",
  "hsl(40,100%,60%)",
  "hsl(300,80%,65%)",
  "hsl(10,90%,60%)",
];

// ─── Default params ───────────────────────────────────────────────────────────

const defaultParams: BeamformingParams & Record<string, any> = {
  numElements: 32,
  spacing: 0.5,
  wavelength: 1.0,
  steeringAngleDeg: 0,
  amplitude: 1.0,
  snrDb: 15,
  windowType: "rectangular",
  noiseEnabled: true,
  apodizationEnabled: false,
  frequency: 10e9,
  scanRangeDeg: 360,
  gridSize: 360,
  computeDoppler: true,
  geometry: "linear",
  radius: 5,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type PlacedTarget = {
  id: string;
  angleDeg: number;
  distanceM: number;
  sizeM: number;
  lastHitMs: number;
};

/** One recorded detection event. */
type DetectionPoint = {
  /** Wall-clock ms when detection occurred (for PPI fade). */
  detectedAtMs: number;
  /** Elapsed seconds since sim start (for Distance-vs-Time X axis). */
  elapsedS: number;
  /** Euclidean distance from radar centre in metres. */
  distanceM: number;
  /** Beam angle when detected (degrees). */
  angleDeg: number;
  targetId: string;
  colorIdx: number;
};

/** One angle-intensity sample for the Angle Detection chart. */
type AngleSample = {
  angle: number;
  intensity: number;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function SimulatorRadar() {
  const [params, setParams] = useState<BeamformingParams & Record<string, any>>(
    defaultParams,
  );
  const debouncedParams = useDebounce(params, 300);
  const [result, setResult] = useState<SimulatorRadarResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = useRadarSimulatorAPI();

  // ── Scan controls ────────────────────────────────────────────────────────────
  const [beamWidth, setBeamWidth] = useState(10);
  const [scanSpeed, setScanSpeed] = useState(5);
  const [radarMode, setRadarMode] = useState<"mechanical" | "beamforming">(
    "beamforming",
  );
  const radarModeRef = useRef<"mechanical" | "beamforming">("beamforming");

  // ── Scan angle ───────────────────────────────────────────────────────────────
  const [scanAngleDeg, setScanAngleDeg] = useState(0);
  const scanAngleRef = useRef(0);

  // ── Targets ──────────────────────────────────────────────────────────────────
  const [placedTargets, setPlacedTargets] = useState<PlacedTarget[]>([]);
  const placedTargetsRef = useRef<PlacedTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<
    "custom" | "quick" | "precision" | "multi"
  >("custom");

  // ── Drag ─────────────────────────────────────────────────────────────────────
  const dragRef = useRef<{
    id: string;
    active: boolean;
    moved: boolean;
  } | null>(null);

  // ── Canvas refs ───────────────────────────────────────────────────────────────
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const ppiCanvasRef = useRef<HTMLCanvasElement>(null);

  // ── Chart / detection data ────────────────────────────────────────────────────

  const simStartMs = useRef(performance.now());

  /** All detection events — accumulated forever, never cleared except on reset. */
  const detectionHistoryRef = useRef<DetectionPoint[]>([]);
  const [detectionHistory, setDetectionHistory] = useState<DetectionPoint[]>(
    [],
  );

  const ANGLE_SLOTS = 720;
  const angleChartBufRef = useRef<Float32Array>(new Float32Array(ANGLE_SLOTS));
  const [angleSamples, setAngleSamples] = useState<AngleSample[]>([]);

  const beamInsideRef = useRef<Map<string, boolean>>(new Map());
  const lastChartFlushMs = useRef(0);

  // ── Detection params ref (read by RAF without stale closure) ──────────────────
  type DetParams = {
    numElements: number;
    spacingOverLambda: number;
    windowType: string;
    apodizationEnabled: boolean;
    radarMode: "mechanical" | "beamforming";
    beamWidthDeg: number;
    steeringOffsetDeg: number;
    amplitude: number;
    snrDb: number;
    phaseOffsetRad: number;
    geometry: string;
    radiusOverLambda: number;
  };

  const detParamsRef = useRef<DetParams>({
    numElements: 32,
    spacingOverLambda: 0.5,
    windowType: "rectangular",
    apodizationEnabled: false,
    radarMode: "beamforming",
    beamWidthDeg: 10,
    steeringOffsetDeg: 0,
    amplitude: 1,
    snrDb: 15,
    phaseOffsetRad: 0,
    geometry: "linear",
    radiusOverLambda: 5,
  });

  const runDetectionRef = useRef<(sweepDeg: number, nowMs: number) => void>(
    () => {},
  );
  const scanSpeedRef = useRef(scanSpeed);

  // ─── Keep refs current ────────────────────────────────────────────────────────

  useEffect(() => {
    placedTargetsRef.current = placedTargets;
  }, [placedTargets]);
  useEffect(() => {
    scanSpeedRef.current = scanSpeed;
  }, [scanSpeed]);

  useEffect(() => {
    radarModeRef.current = radarMode;
    beamInsideRef.current.clear();
  }, [radarMode]);

  useEffect(() => {
    const wavelength = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const spacingOverLambda = Number(params.spacing ?? 0.5) / wavelength;
    const steeringOffsetDeg = Number(params.steeringAngleDeg ?? 0);
    const radiusOverLambda = Math.max(0.5, Number(params.radius ?? 5));
    const phaseOffsetRad =
      2 * Math.PI * spacingOverLambda * Math.sin(degToRad(steeringOffsetDeg));

    detParamsRef.current = {
      numElements: Math.max(
        2,
        Math.min(128, Math.round(Number(params.numElements ?? 32))),
      ),
      spacingOverLambda,
      windowType:
        (params.apodizationEnabled ? params.windowType : "rectangular") ??
        "rectangular",
      apodizationEnabled: !!params.apodizationEnabled,
      radarMode,
      beamWidthDeg: beamWidth,
      steeringOffsetDeg,
      amplitude: Math.max(0.01, Number(params.amplitude ?? 1.0)),
      snrDb: Number(params.snrDb ?? 15),
      phaseOffsetRad,
      geometry: params.geometry ?? "linear",
      radiusOverLambda,
    };
  }, [
    params.numElements,
    params.spacing,
    params.wavelength,
    params.windowType,
    params.apodizationEnabled,
    params.steeringAngleDeg,
    params.amplitude,
    params.snrDb,
    params.geometry,
    params.radius,
    radarMode,
    beamWidth,
  ]);

  // ─── Backend simulation ───────────────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;
    const runSim = async () => {
      setIsLoading(true);
      try {
        const res = await simulate(debouncedParams, isInitialLoadRef.current);
        if (isMounted && res?.success) {
          setResult(res);
          isInitialLoadRef.current = false;
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    runSim();
    return () => {
      isMounted = false;
    };
  }, [debouncedParams, simulate]);

  const updateParam = <K extends keyof BeamformingParams>(
    key: K,
    value: BeamformingParams[K],
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const radar = useMemo(() => {
    if (!result?.data) return null;
    return {
      angles: result.data.anglesDeg?.filter(Number.isFinite) || [],
      magnitudes: result.data.magnitudes || [],
      targets: (result.data.targets || []).filter(
        (t: RadarTarget) =>
          t &&
          Number.isFinite(t.angleDeg) &&
          Number.isFinite(t.distanceM) &&
          Number.isFinite(t.rcsDbsm),
      ),
      metrics: result.data.metrics || {},
    };
  }, [result]);

  // ─── Detection hot path ───────────────────────────────────────────────────────

  const runDetection = useCallback((sweepDeg: number, nowMs: number) => {
    const targets = placedTargetsRef.current;
    const dp = detParamsRef.current;
    const currentMode = radarModeRef.current;
    const beamWidthDeg = Math.max(1, dp.beamWidthDeg);
    const halfBeam = beamWidthDeg / 2;

    const effectiveSweepDeg = clampAngleDeg360(sweepDeg + dp.steeringOffsetDeg);

    // ── SNR model ─────────────────────────────────────────────────────────────
    // Linear SNR: snrLinear = 10^(SNR_dB/20)  (voltage / field ratio)
    // noise_amplitude = reference_signal / snrLinear
    // reference_signal = dp.amplitude (peak signal at 1 m, normalised distance)
    // At SNR=0 dB  → noise = signal   (very noisy)
    // At SNR=40 dB → noise = signal/100 (essentially clean)
    const snrLinear = Math.pow(10, dp.snrDb / 20);
    // Noise floor amplitude (added to every slot, including empty ones)
    const noiseFloor = dp.amplitude / snrLinear;
    // Detection threshold: a target must produce intensity > threshold to register.
    // We set threshold at 3× the noise floor (≈ 10 dB above noise).
    const detectionThreshold = 3 * noiseFloor;

    // Gaussian noise sample via Box-Muller — always safe (u1 clamped away from 0)
    const gaussNoise = (): number => {
      const u1 = Math.max(1e-15, Math.random());
      return (
        Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random())
      );
    };

    // Shortest-arc angular difference (degrees)
    const wrapDiff = (a: number, b: number): number => {
      let d = (((a - b) % 360) + 360) % 360;
      if (d > 180) d -= 360;
      return d;
    };

    // ── Angle Detection chart — written every frame ───────────────────────────
    // Every slot gets a noise sample so there is always a noise floor visible.
    // Signal is added on top when the beam is over a target.
    const slotIdx =
      Math.round((((effectiveSweepDeg % 360) + 360) % 360) * 2) % ANGLE_SLOTS;

    // Start from the noise floor for this slot (always present)
    let slotSignal = 0;
    let slotHasTarget = false;

    for (const t of targets) {
      const targetAngleDeg = clampAngleDeg360(t.angleDeg);
      const deltaDeg = Math.abs(wrapDiff(effectiveSweepDeg, targetAngleDeg));
      if (deltaDeg >= halfBeam) continue;

      const distM = Math.max(0.1, t.distanceM);
      // Clean signal: sinc²(Δθ/bw)/d²  or  cosine taper/d²
      let cleanSignal: number;
      if (currentMode === "mechanical") {
        const frac = deltaDeg / halfBeam;
        cleanSignal =
          (dp.amplitude * Math.cos((frac * Math.PI) / 2)) / (distM * distM);
      } else {
        const sv = sincNorm(deltaDeg / beamWidthDeg);
        cleanSignal = (dp.amplitude * sv * sv) / (distM * distM);
      }
      if (!Number.isFinite(cleanSignal)) cleanSignal = 0;
      if (cleanSignal > slotSignal) slotSignal = cleanSignal;
      if (cleanSignal > 0) slotHasTarget = true;
    }

    // Add Gaussian noise to the slot — noise floor always present.
    // At low SNR the noise is comparable to the signal; at high SNR negligible.
    const noise = noiseFloor * Math.abs(gaussNoise());
    const slotIntensity = Math.max(0, slotSignal + noise);
    angleChartBufRef.current[slotIdx] = Number.isFinite(slotIntensity)
      ? slotIntensity
      : 0;

    // ── False detections at low SNR ───────────────────────────────────────────
    // Randomly write noise spikes into a few nearby slots so the chart shows
    // a noisy, blurry baseline rather than a clean flat line at low SNR.
    // The number and magnitude of false spikes scales inversely with SNR.
    if (dp.snrDb < 20 && Math.random() < 0.35) {
      // Scatter 1-3 noise bumps within ±15° of current beam angle
      const nFalse = Math.floor(Math.random() * 3) + 1;
      for (let f = 0; f < nFalse; f++) {
        const offsetDeg = (Math.random() - 0.5) * 30;
        const falseAngle = clampAngleDeg360(effectiveSweepDeg + offsetDeg);
        const fi = Math.round(falseAngle * 2) % ANGLE_SLOTS;
        // False spike amplitude: noise floor × random (0..1), stronger at lower SNR
        const falseAmp =
          noiseFloor * Math.random() * Math.max(0, (20 - dp.snrDb) / 20);
        const prev = angleChartBufRef.current[fi];
        angleChartBufRef.current[fi] = Math.max(prev, falseAmp);
      }
    }

    // ── Flash + detection recording ───────────────────────────────────────────
    if (targets.length === 0) {
      if (nowMs - lastChartFlushMs.current >= 125) {
        lastChartFlushMs.current = nowMs;
        const buf = angleChartBufRef.current;
        const snap: AngleSample[] = [];
        for (let i = 0; i < ANGLE_SLOTS; i++)
          snap.push({ angle: i * 0.5, intensity: buf[i] });
        setAngleSamples(snap);
      }
      return;
    }

    const hitIds = new Set<string>();
    const frameDetections: DetectionPoint[] = [];
    const effectiveHalf =
      currentMode === "mechanical" ? halfBeam * 1.1 : halfBeam;

    for (let ti = 0; ti < targets.length; ti++) {
      const t = targets[ti];
      const targetAngleDeg = clampAngleDeg360(t.angleDeg);
      const deltaDeg = Math.abs(wrapDiff(effectiveSweepDeg, targetAngleDeg));
      const inBeam = deltaDeg < effectiveHalf;

      const wasInside = beamInsideRef.current.get(t.id) ?? false;
      beamInsideRef.current.set(t.id, inBeam);

      if (!inBeam) continue;

      // Compute clean signal for this target to check against detection threshold.
      // Targets that are too weak (far away at low SNR) are missed.
      const distM = Math.max(0.1, t.distanceM);
      let cleanSignal: number;
      if (currentMode === "mechanical") {
        const frac = deltaDeg / effectiveHalf;
        cleanSignal =
          (dp.amplitude * Math.max(0, Math.cos((frac * Math.PI) / 2))) /
          (distM * distM);
      } else {
        const sv = sincNorm(deltaDeg / beamWidthDeg);
        cleanSignal = (dp.amplitude * sv * sv) / (distM * distM);
      }

      // SNR-weighted detection gate: the noisy received power must exceed threshold.
      // noisySNR adds a random noise sample to determine if this particular
      // detection attempt succeeds (models pulse-to-pulse fading).
      const noisySNR = cleanSignal + noiseFloor * gaussNoise();
      const detected = noisySNR >= detectionThreshold;

      if (detected) hitIds.add(t.id);

      // Leading-edge recording: record when beam first enters AND detection succeeds
      if (!wasInside && detected) {
        const elapsedS = (nowMs - simStartMs.current) / 1000;
        const pt: DetectionPoint = {
          detectedAtMs: nowMs,
          elapsedS: parseFloat(elapsedS.toFixed(3)),
          distanceM: parseFloat(Math.max(0, t.distanceM).toFixed(3)),
          angleDeg: parseFloat(targetAngleDeg.toFixed(1)),
          targetId: t.id,
          colorIdx: ti,
        };
        frameDetections.push(pt);
        console.log(
          `[Det] ti=${ti} dist=${t.distanceM.toFixed(2)}m angle=${targetAngleDeg.toFixed(1)}° SNR=${dp.snrDb}dB detected=true`,
        );
      } else if (!wasInside && !detected) {
        console.log(
          `[Det] ti=${ti} dist=${t.distanceM.toFixed(2)}m angle=${targetAngleDeg.toFixed(1)}° SNR=${dp.snrDb}dB detected=MISSED (below threshold)`,
        );
      }
    }

    // Remove stale entries for deleted targets
    for (const [id] of beamInsideRef.current) {
      if (!targets.find((t) => t.id === id)) beamInsideRef.current.delete(id);
    }

    // Stamp lastHitMs for flash animation only on detected targets
    if (hitIds.size > 0) {
      setPlacedTargets((prev) => {
        const next = prev.map((p) =>
          hitIds.has(p.id) ? { ...p, lastHitMs: nowMs } : p,
        );
        placedTargetsRef.current = next;
        return next;
      });
    }

    if (frameDetections.length > 0) {
      detectionHistoryRef.current = [
        ...detectionHistoryRef.current,
        ...frameDetections,
      ];
      setDetectionHistory([...detectionHistoryRef.current]);
    }

    // Flush angle chart at ~8 Hz
    if (nowMs - lastChartFlushMs.current >= 125) {
      lastChartFlushMs.current = nowMs;
      const buf = angleChartBufRef.current;
      const snap: AngleSample[] = [];
      for (let i = 0; i < ANGLE_SLOTS; i++)
        snap.push({ angle: i * 0.5, intensity: buf[i] });
      setAngleSamples(snap);
    }
  }, []);

  useEffect(() => {
    runDetectionRef.current = runDetection;
  });

  // ─── Constant-speed RAF scan loop ─────────────────────────────────────────────

  useEffect(() => {
    let raf = 0;
    let lastMs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - lastMs) / 1000, 0.1);
      lastMs = now;
      const nextAngle = clampAngleDeg360(
        scanAngleRef.current + scanSpeedRef.current * dt,
      );
      scanAngleRef.current = nextAngle;
      setScanAngleDeg(nextAngle);
      runDetectionRef.current(nextAngle, now);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ─── PPI canvas draw ──────────────────────────────────────────────────────────
  // Draws a real radar PPI screen: dark bg, range rings, glowing dots at
  // detection positions that fade over PPI_FADE_MS milliseconds.

  useEffect(() => {
    const canvas = ppiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const size = (canvas.width = canvas.height = 380);
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 20;

    // Dark radar background
    ctx.fillStyle = "#010d05";
    ctx.fillRect(0, 0, size, size);

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // Subtle grid background gradient
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    bgGrad.addColorStop(0, "rgba(0,40,15,0.6)");
    bgGrad.addColorStop(1, "rgba(0,10,5,0)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, size, size);

    // Range rings
    const numRings = 4;
    for (let r = 1; r <= numRings; r++) {
      const rPx = (R * r) / numRings;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,200,80,0.18)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Range label
      const rangeLabelM = ((DETECTION_RANGE_M * r) / numRings).toFixed(1);
      ctx.fillStyle = "rgba(0,220,80,0.45)";
      ctx.font = "8px JetBrains Mono";
      ctx.textAlign = "left";
      ctx.fillText(`${rangeLabelM}m`, cx + 3, cy - rPx + 10);
    }

    // Angle spokes every 30°
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = degToRad(deg);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
      ctx.strokeStyle = "rgba(0,200,80,0.10)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      // Degree label
      const lx = cx + Math.cos(rad) * (R + 10);
      const ly = cy + Math.sin(rad) * (R + 10);
      ctx.fillStyle = "rgba(0,200,80,0.35)";
      ctx.font = "8px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${deg}°`, lx, ly);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const nowMs = performance.now();

    // Draw all detection history dots — fade from bright green to invisible
    for (const d of detectionHistory) {
      const age = nowMs - d.detectedAtMs;
      if (age > PPI_FADE_MS) continue;
      const alpha = Math.max(0, 1 - age / PPI_FADE_MS);

      const angleRad = degToRad(d.angleDeg);
      const rPx = (d.distanceM / DETECTION_RANGE_M) * R;
      const x = cx + Math.cos(angleRad) * rPx;
      const y = cy + Math.sin(angleRad) * rPx;

      // Use the target's assigned color with fading alpha
      const baseColor = TARGET_COLORS[d.colorIdx % TARGET_COLORS.length];
      // Glow halo
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 12);
      halo.addColorStop(0, `hsla(130,100%,60%,${alpha * 0.5})`);
      halo.addColorStop(1, "hsla(130,100%,60%,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fill();

      // Bright dot — colour fades green over time
      const freshness = Math.max(0, 1 - age / (PPI_FADE_MS * 0.3));
      // Mix between base target color (fresh) and green (older)
      ctx.fillStyle =
        freshness > 0.5
          ? `hsla(130,100%,65%,${alpha})`
          : baseColor.replace(")", `,${alpha})`).replace("hsl(", "hsla(");
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, 4 * alpha), 0, Math.PI * 2);
      ctx.fill();
    }

    // Sweep line (ghosted green ray showing current beam position)
    const sweepRad = degToRad(scanAngleDeg);
    const sweepGrad = ctx.createLinearGradient(
      cx,
      cy,
      cx + Math.cos(sweepRad) * R,
      cy + Math.sin(sweepRad) * R,
    );
    sweepGrad.addColorStop(0, "rgba(0,255,80,0.12)");
    sweepGrad.addColorStop(1, "rgba(0,255,80,0)");
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepRad) * R, cy + Math.sin(sweepRad) * R);
    ctx.stroke();

    ctx.restore(); // end clip

    // Border circle
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,200,80,0.30)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,255,80,0.8)";
    ctx.fill();

    // Info overlay
    ctx.fillStyle = "rgba(0,220,80,0.6)";
    ctx.font = "9px JetBrains Mono";
    ctx.textAlign = "left";
    ctx.fillText(`${detectionHistory.length} detections`, 10, 16);
    ctx.fillText(`beam: ${scanAngleDeg.toFixed(1)}°`, 10, 28);
  }, [detectionHistory, scanAngleDeg]);

  // ─── Radar scan canvas draw ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas || !radar) return;
    const ctx = canvas.getContext("2d")!;
    const size = (canvas.width = canvas.height = 380);
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 20;

    ctx.fillStyle = "hsl(240,10%,10%)";
    ctx.fillRect(0, 0, size, size);

    // Range rings
    ctx.strokeStyle = "hsl(240,10%,18%)";
    ctx.lineWidth = 0.5;
    for (let r = 1; r <= 4; r++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (radius * r) / 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "hsl(240,8%,40%)";
      ctx.font = "9px JetBrains Mono";
      ctx.fillText(`${r * 2.5}m`, cx + 3, cy - (radius * r) / 4 + 3);
    }

    // Crosshairs
    ctx.strokeStyle = "hsl(240,10%,18%)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, 10);
    ctx.lineTo(cx, size - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, cy);
    ctx.lineTo(size - 10, cy);
    ctx.stroke();

    // Backend API radar returns
    if (radar.angles.length > 0 && radar.magnitudes.length > 0) {
      const maxReturn = Math.max(...radar.magnitudes, 0.001);
      radar.angles.forEach((angleDeg: number, i: number) => {
        const intensity = (radar.magnitudes as number[])[i] ?? 0;
        if (intensity < 0.01) return;
        const angleRad = ((angleDeg - 90) * Math.PI) / 180;
        const r = (intensity / maxReturn) * radius * 0.8;
        const x = cx + Math.cos(angleRad) * r;
        const y = cy + Math.sin(angleRad) * r;
        ctx.fillStyle = `hsla(270,70%,50%,${Math.min(1, intensity / maxReturn) * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Backend API targets
    radar.targets.forEach((target: RadarTarget, i: number) => {
      const angleRad = ((target.angleDeg - 90) * Math.PI) / 180;
      const r = (target.distanceM / 10) * radius;
      const x = cx + Math.cos(angleRad) * r;
      const y = cy + Math.sin(angleRad) * r;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 15);
      glow.addColorStop(0, "hsla(320,70%,60%,0.5)");
      glow.addColorStop(1, "hsla(320,70%,60%,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "hsl(320,70%,60%)";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "hsl(320,70%,85%)";
      ctx.font = "9px JetBrains Mono";
      ctx.fillText(`T${i + 1}`, x + 8, y - 4);
    });

    // User-placed targets with flash animation
    const nowMs = performance.now();
    for (let ti = 0; ti < placedTargets.length; ti++) {
      const t = placedTargets[ti];
      const a = degToRad(t.angleDeg);
      const r = (t.distanceM / DETECTION_RANGE_M) * radius;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const pr = Math.max(4, (t.sizeM / DETECTION_RANGE_M) * radius);
      const isSelected = selectedTargetId === t.id;
      const tColor = TARGET_COLORS[ti % TARGET_COLORS.length];
      const age = t.lastHitMs > 0 ? nowMs - t.lastHitMs : FLASH_DURATION_MS + 1;
      const hitGlow =
        age >= 0 && age < FLASH_DURATION_MS ? 1 - age / FLASH_DURATION_MS : 0;

      if (hitGlow > 0) {
        const outerR = pr * 8;
        const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, outerR);
        glowGrad.addColorStop(0, `hsla(50,100%,70%,${0.55 * hitGlow})`);
        glowGrad.addColorStop(0.5, `hsla(50,100%,70%,${0.25 * hitGlow})`);
        glowGrad.addColorStop(1, "hsla(50,100%,70%,0)");
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(x, y, outerR, 0, Math.PI * 2);
        ctx.fill();

        for (let ring = 0; ring < 3; ring++) {
          const rp = hitGlow - ring * 0.22;
          if (rp <= 0) continue;
          const ringR = pr * 1.2 + (1 - rp) * pr * 6;
          ctx.save();
          ctx.strokeStyle = `hsla(50,100%,75%,${Math.max(0, rp * (0.85 - ring * 0.22))})`;
          ctx.lineWidth = Math.max(0.5, (3 - ring * 0.8) * rp);
          ctx.shadowBlur = 6 * rp;
          ctx.shadowColor = "hsla(50,100%,70%,0.8)";
          ctx.beginPath();
          ctx.arc(x, y, ringR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        const flashR = pr * 0.9 * hitGlow;
        const fg = ctx.createRadialGradient(x, y, 0, x, y, flashR + 2);
        fg.addColorStop(0, `rgba(255,255,230,${hitGlow})`);
        fg.addColorStop(0.5, `hsla(50,100%,75%,${hitGlow * 0.6})`);
        fg.addColorStop(1, "hsla(50,100%,70%,0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(x, y, flashR + 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = isSelected ? "hsl(45,90%,60%)" : tColor;
      ctx.strokeStyle = isSelected ? "hsl(45,90%,90%)" : "hsl(210,10%,85%)";
      ctx.lineWidth = isSelected ? 2.5 : 1;
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "hsla(240,10%,8%,0.9)";
      ctx.font = `bold ${Math.max(8, Math.round(pr * 0.7))}px JetBrains Mono`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${ti + 1}`, x, y);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    // Draw array elements to visualise geometry
    const nElem = Math.max(
      2,
      Math.min(128, Math.round(Number(params.numElements ?? 32))),
    );
    const spacingPx = 5; // pixels between elements for visualisation
    const geo = params.geometry ?? "linear";
    const radiusLambda = Math.max(0.5, Number(params.radius ?? 5));
    ctx.fillStyle = "hsla(270,60%,70%,0.55)";
    if (geo === "curved") {
      // Draw arc of elements at bottom of display
      const arcR = Math.min(radius * 0.18, nElem * spacingPx * 0.5);
      const arcHalf = ((nElem - 1) * spacingPx * 0.5) / arcR;
      for (let i = 0; i < nElem; i++) {
        const a = -arcHalf + (i / (nElem - 1)) * 2 * arcHalf;
        const ex = cx + arcR * Math.sin(a);
        const ey = cy + arcR + radius * 0.72;
        if (ey > size - 4 || ex < 4 || ex > size - 4) continue;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Linear array at bottom
      const totalW = (nElem - 1) * spacingPx;
      for (let i = 0; i < nElem; i++) {
        const ex = cx - totalW / 2 + i * spacingPx;
        const ey = cy + radius * 0.88;
        if (ey > size - 4) continue;
        ctx.beginPath();
        ctx.arc(ex, ey, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Central icon
    ctx.fillStyle = "hsla(270,70%,60%,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "hsla(270,70%,80%,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();

    const sweepRad = degToRad(scanAngleDeg);

    if (radarMode === "mechanical") {
      const trailDeg = 60;
      const trailStart = sweepRad - degToRad(trailDeg);
      for (let s = 0; s < 45; s++) {
        const t0 = trailStart + degToRad((s / 45) * trailDeg);
        const t1 = trailStart + degToRad(((s + 1) / 45) * trailDeg);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, t0, t1);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fillStyle = `hsla(120,100%,50%,${(s / 45) * 0.07})`;
        ctx.fill();
        ctx.restore();
      }
      const sg = ctx.createLinearGradient(
        cx,
        cy,
        cx + Math.cos(sweepRad) * radius,
        cy + Math.sin(sweepRad) * radius,
      );
      sg.addColorStop(0, "hsla(120,100%,65%,0.95)");
      sg.addColorStop(1, "hsla(120,100%,65%,0.05)");
      ctx.strokeStyle = sg;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(sweepRad) * radius,
        cy + Math.sin(sweepRad) * radius,
      );
      ctx.stroke();
    } else {
      // Beamforming: AF lobe with SNR-dependent noise on beam edges
      const nElemLobe = Math.max(
        2,
        Math.min(128, Math.round(Number(params.numElements ?? 32))),
      );
      const wavelength = Math.max(0.01, Number(params.wavelength ?? 1.0));
      const dOverLambda = Number(params.spacing ?? 0.5) / wavelength;
      const wType =
        (params.apodizationEnabled ? params.windowType : "rectangular") ??
        "rectangular";
      const weights = makeWindowWeights(wType, nElemLobe);
      const steeringDeg = Number(params.steeringAngleDeg ?? 0);
      const phaseOffsetRad =
        2 * Math.PI * dOverLambda * Math.sin(degToRad(steeringDeg));
      const amplitude = Math.max(0.01, Number(params.amplitude ?? 1.0));
      const geometry = params.geometry ?? "linear";
      const radiusOverLambda = Math.max(0.5, Number(params.radius ?? 5));
      const snrDb = Number(params.snrDb ?? 15);
      // Noise perturbation for beam edge fuzziness: larger at low SNR
      const snrLinearCanvas = Math.pow(10, snrDb / 20);
      const edgeNoiseFrac = Math.min(0.5, 1 / snrLinearCanvas);

      // Compute clean AF points
      const pts: { ang: number; r: number }[] = [];
      let peak = 1e-9;
      for (let i = 0; i < 241; i++) {
        const relDeg = -90 + (180 * i) / 240;
        const relRad = degToRad(relDeg);
        const af = computeArrayFactor(
          nElemLobe,
          dOverLambda,
          relRad,
          weights,
          phaseOffsetRad,
          geometry,
          radiusOverLambda,
        );
        if (af > peak) peak = af;
        pts.push({ ang: relRad, r: af });
      }
      const lobeScale = radius * 0.92;
      const lobeAlpha = Math.min(0.35, Math.max(0.03, 0.09 * amplitude));

      // ── Filled lobe (clean, no noise perturbation) ──────────────────────────
      ctx.fillStyle = `hsla(270,70%,55%,${lobeAlpha})`;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (const p of pts) {
        const rr = lobeScale * Math.pow(Math.max(0, p.r / peak), 0.65);
        const ang = sweepRad + p.ang;
        ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      ctx.closePath();
      ctx.fill();

      // ── Noisy outline — scatter individual points along the lobe edge ────────
      // At high SNR: draw a clean stroke.
      // At low SNR: skip the stroke and draw scattered dots instead, giving
      //             the appearance of a fuzzy, uncertain beam boundary.
      if (snrDb >= 25) {
        // Clean outline
        ctx.strokeStyle = `hsla(270,80%,72%,${Math.min(0.9, Math.max(0.2, 0.5 * amplitude))})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const rr = lobeScale * Math.pow(Math.max(0, pts[i].r / peak), 0.65);
          const ang = sweepRad + pts[i].ang;
          const px = cx + Math.cos(ang) * rr;
          const py = cy + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      } else {
        // Fuzzy scattered dots along lobe boundary — density drops with SNR
        const dotAlpha = Math.min(0.8, Math.max(0.15, 0.5 * amplitude));
        for (let i = 0; i < pts.length; i++) {
          // Skip some points randomly at very low SNR to thin the outline
          if (Math.random() > 0.4 + snrDb / 50) continue;
          const cleanR =
            lobeScale * Math.pow(Math.max(0, pts[i].r / peak), 0.65);
          // Add random radial perturbation proportional to noise level
          const perturbR =
            cleanR * (1 + edgeNoiseFrac * (Math.random() - 0.5) * 2);
          // Add small angular jitter
          const angJitter = edgeNoiseFrac * 0.04 * (Math.random() - 0.5);
          const ang = sweepRad + pts[i].ang + angJitter;
          const px = cx + Math.cos(ang) * perturbR;
          const py = cy + Math.sin(ang) * perturbR;
          ctx.fillStyle = `hsla(270,80%,72%,${dotAlpha * Math.random()})`;
          ctx.beginPath();
          ctx.arc(px, py, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // ── Sweep ray ────────────────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(
        cx,
        cy,
        cx + Math.cos(sweepRad) * radius,
        cy + Math.sin(sweepRad) * radius,
      );
      grad.addColorStop(0, "hsla(270,75%,65%,0.85)");
      grad.addColorStop(1, "hsla(270,75%,65%,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(
        cx + Math.cos(sweepRad) * radius,
        cy + Math.sin(sweepRad) * radius,
      );
      ctx.stroke();

      // ── Scatter noise particles around lobe edge at low SNR ─────────────────
      // These are independent random dots that simulate receiver noise appearing
      // in the displayed beam pattern.
      if (snrDb < 20) {
        const nParticles = Math.floor((20 - snrDb) * 3);
        for (let p = 0; p < nParticles; p++) {
          // Random point near the lobe boundary
          const ptIdx = Math.floor(Math.random() * pts.length);
          const baseR =
            lobeScale * Math.pow(Math.max(0, pts[ptIdx].r / peak), 0.65);
          const rr = baseR * (0.5 + Math.random() * 1.0);
          const ang = sweepRad + pts[ptIdx].ang + (Math.random() - 0.5) * 0.15;
          const px = cx + Math.cos(ang) * rr;
          const py = cy + Math.sin(ang) * rr;
          const pAlpha = Math.random() * edgeNoiseFrac * 0.6;
          ctx.fillStyle = `hsla(270,60%,80%,${pAlpha})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // HUD
    const wHUD = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const dHUD = Number(params.spacing ?? 0.5) / wHUD;
    const stHUD = Number(params.steeringAngleDeg ?? 0);
    const effHUD = scanAngleDeg + stHUD;
    const dPhi = 2 * Math.PI * dHUD * Math.sin(degToRad(effHUD));
    ctx.fillStyle = "hsla(240,8%,78%,0.75)";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(`θ: ${effHUD.toFixed(1)}°`, 14, 22);
    ctx.fillText(`Δφ: ${dPhi.toFixed(2)} rad`, 14, 38);
    ctx.fillText(
      `${scanSpeed}°/s  ${(params.geometry ?? "linear").toUpperCase()}`,
      14,
      54,
    );
    ctx.font = "bold 11px JetBrains Mono";
    ctx.fillStyle =
      radarMode === "mechanical"
        ? "hsla(120,100%,58%,0.9)"
        : "hsla(270,80%,72%,0.9)";
    ctx.textAlign = "right";
    ctx.fillText(radarMode === "mechanical" ? "MECH" : "BF", size - 14, 22);
    ctx.textAlign = "left";
  }, [
    radar,
    params,
    scanAngleDeg,
    placedTargets,
    selectedTargetId,
    radarMode,
    scanSpeed,
    // snrDb is read from params above, so params dep covers it.
    // Explicitly list it to make the dependency clear to React.
  ]);

  // ─── Canvas wheel ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radiusPx = canvas.width / 2 - 20;
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      for (const t of placedTargetsRef.current) {
        const ta = degToRad(t.angleDeg);
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(ta) * tr;
        const ty = cy + Math.sin(ta) * tr;
        const pr = Math.max(4, (t.sizeM / DETECTION_RANGE_M) * radiusPx);
        if (Math.hypot(mx - tx, my - ty) <= pr + 12) {
          const delta = e.deltaY * -0.0012;
          placedTargetsRef.current = placedTargetsRef.current.map((p) =>
            p.id === t.id
              ? { ...p, sizeM: Math.min(2.5, Math.max(0.1, p.sizeM + delta)) }
              : p,
          );
          setPlacedTargets(placedTargetsRef.current);
          break;
        }
      }
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ─── Canvas drag ──────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = radarCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radiusPx = canvas.width / 2 - 20;
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      for (const t of placedTargetsRef.current) {
        const ta = degToRad(t.angleDeg);
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(ta) * tr;
        const ty = cy + Math.sin(ta) * tr;
        const pr = Math.max(4, (t.sizeM / DETECTION_RANGE_M) * radiusPx);
        if (Math.hypot(mx - tx, my - ty) <= pr + 8) {
          dragRef.current = { id: t.id, active: true, moved: false };
          return;
        }
      }
      dragRef.current = null;
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragRef.current?.active) return;
      const canvas = radarCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radiusPx = canvas.width / 2 - 20;
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = mx - cx;
      const dy = my - cy;
      const rPx = Math.hypot(dx, dy);
      if (rPx > radiusPx) return;
      const newAngle = clampAngleDeg360((Math.atan2(dy, dx) * 180) / Math.PI);
      const newDist = Math.min(
        DETECTION_RANGE_M * 0.98,
        (rPx / radiusPx) * DETECTION_RANGE_M,
      );
      dragRef.current.moved = true;
      const dragId = dragRef.current.id;
      placedTargetsRef.current = placedTargetsRef.current.map((p) =>
        p.id === dragId ? { ...p, angleDeg: newAngle, distanceM: newDist } : p,
      );
      setPlacedTargets(placedTargetsRef.current);
    },
    [],
  );

  const handleMouseUp = useCallback(() => {
    if (dragRef.current) dragRef.current.active = false;
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current?.moved) {
        dragRef.current = null;
        return;
      }
      dragRef.current = null;
      const canvas = radarCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radiusPx = canvas.width / 2 - 20;
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const dx = mx - cx;
      const dy = my - cy;
      const rPx = Math.hypot(dx, dy);
      if (rPx > radiusPx) return;
      const clickAngle = clampAngleDeg360((Math.atan2(dy, dx) * 180) / Math.PI);
      const clickDist = (rPx / radiusPx) * DETECTION_RANGE_M;
      const targets = placedTargetsRef.current;
      for (const t of targets) {
        const ta = degToRad(t.angleDeg);
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(ta) * tr;
        const ty = cy + Math.sin(ta) * tr;
        const pr = Math.max(4, (t.sizeM / DETECTION_RANGE_M) * radiusPx);
        if (Math.hypot(mx - tx, my - ty) <= pr + 8) {
          setSelectedTargetId(t.id);
          return;
        }
      }
      if (targets.length >= 5) return;
      const id = `U-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const newTarget: PlacedTarget = {
        id,
        angleDeg: clickAngle,
        distanceM: clickDist,
        sizeM: 0.6,
        lastHitMs: 0,
      };
      placedTargetsRef.current = [...placedTargetsRef.current, newTarget];
      setPlacedTargets(placedTargetsRef.current);
      setSelectedTargetId(id);
    },
    [],
  );

  // ─── Derived chart data ───────────────────────────────────────────────────────

  /** Angle Detection: normalised AF at each 0.5° bucket. */
  const angleDetChartData = useMemo(() => {
    if (angleSamples.length === 0) return [];
    let peak = 0;
    for (const s of angleSamples) if (s.intensity > peak) peak = s.intensity;
    if (peak <= 0)
      return angleSamples.map((s) => ({ angle: s.angle, intensity: 0 }));
    const scale = 1 / peak;
    return angleSamples.map((s) => ({
      angle: s.angle,
      intensity: parseFloat((s.intensity * scale).toFixed(4)),
    }));
  }, [angleSamples]);

  /** Beam Width Comparison: real AF for 8, 16, 32 elements, using current geometry. */
  const beamWidthChartData = useMemo(() => {
    const nConfigs = [8, 16, 32] as const;
    const wavelength = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const spacingOverLambda = Number(params.spacing ?? 0.5) / wavelength;
    const wType =
      (params.apodizationEnabled ? params.windowType : "rectangular") ??
      "rectangular";
    const steeringDeg = Number(params.steeringAngleDeg ?? 0);
    const geometry = params.geometry ?? "linear";
    const radiusOverLambda = Math.max(0.5, Number(params.radius ?? 5));
    const points = Array.from({ length: 181 }, (_, i) => -90 + i);
    const raw: Record<string, number[]> = { n8: [], n16: [], n32: [] };
    const peaks: Record<string, number> = { n8: 1e-9, n16: 1e-9, n32: 1e-9 };
    for (const angleDeg of points) {
      const relRad = degToRad(angleDeg);
      for (const n of nConfigs) {
        const w = makeWindowWeights(wType, n);
        const phaseOff =
          2 * Math.PI * spacingOverLambda * Math.sin(degToRad(steeringDeg));
        const af = computeArrayFactor(
          n,
          spacingOverLambda,
          relRad,
          w,
          phaseOff,
          geometry,
          radiusOverLambda,
        );
        raw[`n${n}`].push(af);
        if (af > peaks[`n${n}`]) peaks[`n${n}`] = af;
      }
    }
    return points.map((angleDeg, i) => ({
      angle: angleDeg,
      n8: parseFloat((raw.n8[i] / peaks.n8).toFixed(4)),
      n16: parseFloat((raw.n16[i] / peaks.n16).toFixed(4)),
      n32: parseFloat((raw.n32[i] / peaks.n32).toFixed(4)),
    }));
  }, [
    params.spacing,
    params.wavelength,
    params.windowType,
    params.apodizationEnabled,
    params.steeringAngleDeg,
    params.geometry,
    params.radius,
  ]);

  // ─── Utilities ────────────────────────────────────────────────────────────────

  const clearChartData = useCallback(() => {
    detectionHistoryRef.current = [];
    setDetectionHistory([]);
    angleChartBufRef.current.fill(0);
    beamInsideRef.current.clear();
    setAngleSamples([]);
    simStartMs.current = performance.now();
  }, []);

  // ─── Extra controls ───────────────────────────────────────────────────────────

  const extraControls = (
    <>
      {/* Scenario presets */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Scenario
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {scenario}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["quick", "precision", "multi"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={() => {
                setScenario(s);
                clearChartData();
                if (s === "quick") {
                  setBeamWidth(22);
                  setScanSpeed(16);
                }
                if (s === "precision") {
                  setBeamWidth(4);
                  setScanSpeed(3);
                }
                if (s === "multi") {
                  setBeamWidth(14);
                  setScanSpeed(10);
                  const base = performance.now();
                  const preset: PlacedTarget[] = [
                    {
                      id: `P1-${base}`,
                      angleDeg: 20,
                      distanceM: 2.2,
                      sizeM: 0.45,
                      lastHitMs: 0,
                    },
                    {
                      id: `P2-${base}`,
                      angleDeg: 75,
                      distanceM: 5.5,
                      sizeM: 0.7,
                      lastHitMs: 0,
                    },
                    {
                      id: `P3-${base}`,
                      angleDeg: 140,
                      distanceM: 7.8,
                      sizeM: 0.55,
                      lastHitMs: 0,
                    },
                    {
                      id: `P4-${base}`,
                      angleDeg: 230,
                      distanceM: 3.8,
                      sizeM: 0.85,
                      lastHitMs: 0,
                    },
                    {
                      id: `P5-${base}`,
                      angleDeg: 310,
                      distanceM: 9.2,
                      sizeM: 0.6,
                      lastHitMs: 0,
                    },
                  ];
                  placedTargetsRef.current = preset;
                  setPlacedTargets(preset);
                  setSelectedTargetId(preset[0].id);
                }
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Presets set scan + beam. Multi places 5 targets.
        </p>
      </div>

      {/* Beam width */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Beam Width
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {beamWidth}°
          </span>
        </div>
        <Slider
          value={[beamWidth]}
          min={2}
          max={30}
          step={1}
          onValueChange={([v]) => setBeamWidth(v)}
        />
      </div>

      {/* Scan speed */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Scan Speed
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {scanSpeed}°/s
          </span>
        </div>
        <Slider
          value={[scanSpeed]}
          min={1}
          max={60}
          step={1}
          onValueChange={([v]) => setScanSpeed(v)}
        />
      </div>

      {/* Targets */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Targets
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {placedTargets.length}/5
          </span>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Click to place · Drag to move · Scroll to resize
        </p>
        <div className="flex gap-2">
          {placedTargets.length > 0 && (
            <button
              type="button"
              className="flex-1 h-7 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={() => {
                placedTargetsRef.current = [];
                setPlacedTargets([]);
                setSelectedTargetId(null);
                clearChartData();
              }}
            >
              Clear Targets
            </button>
          )}
          {(detectionHistory.length > 0 || angleSamples.length > 0) && (
            <button
              type="button"
              className="flex-1 h-7 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
              onClick={clearChartData}
            >
              Clear Charts
            </button>
          )}
        </div>
      </div>

      {/* Selected target size */}
      {selectedTargetId &&
        (() => {
          const t = placedTargets.find((x) => x.id === selectedTargetId);
          if (!t) return null;
          return (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                  Target Size
                </Label>
                <span className="text-xs font-mono text-foreground tabular-nums">
                  {t.sizeM.toFixed(2)} m
                </span>
              </div>
              <Slider
                value={[t.sizeM]}
                min={0.1}
                max={2.5}
                step={0.05}
                onValueChange={([v]) =>
                  setPlacedTargets((prev) =>
                    prev.map((p) => (p.id === t.id ? { ...p, sizeM: v } : p)),
                  )
                }
              />
            </div>
          );
        })()}
    </>
  );

  // ─── Error state ──────────────────────────────────────────────────────────────

  if (error && isInitialLoadRef.current) {
    return (
      <MainLayout
        controlPanel={
          <ControlPanel params={params} onParamChange={updateParam} />
        }
      >
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const panelTitle =
    radarMode === "mechanical"
      ? "Radar Scan (Mechanical)"
      : `Radar Scan (Beamforming · ${(params.geometry ?? "linear").toUpperCase()})`;

  const tooltipStyle = {
    backgroundColor: "hsl(240,10%,15%)",
    border: "1px solid hsl(240,10%,22%)",
    borderRadius: 8,
    fontFamily: "JetBrains Mono",
    fontSize: 11,
  };
  const axisTickStyle = { fontSize: 9, fontFamily: "JetBrains Mono" };
  const axisLabelStyle = {
    fill: "hsl(240,8%,55%)",
    fontSize: 10,
    fontFamily: "JetBrains Mono",
  };
  const gridStroke = "hsl(240,10%,22%)";
  const legendStyle = { fontSize: 10, fontFamily: "JetBrains Mono" };

  return (
    <MainLayout
      controlPanel={
        <ControlPanel
          params={params}
          onParamChange={updateParam}
          extra={extraControls}
        />
      }
    >
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        {/* ── Radar Scan Canvas ──────────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {panelTitle}
          </h3>
          <div className="flex gap-2 mb-2">
            {(["mechanical", "beamforming"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setRadarMode(mode)}
                className={`flex-1 h-7 text-[10px] font-mono uppercase tracking-wider rounded-md transition-colors ${
                  radarMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/5 border border-white/15 hover:bg-white/10"
                }`}
              >
                {mode === "mechanical" ? "⟳ Mechanical" : "⟿ Beamforming"}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas
              ref={radarCanvasRef}
              onClick={handleCanvasClick}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`radar-canvas rounded-lg max-w-full max-h-full cursor-crosshair ${isInitialLoadRef.current ? "loading" : "ready"}`}
            />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* ── PPI Radar Screen ───────────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            PPI Radar Screen (Plan Position Indicator)
          </h3>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <canvas
              ref={ppiCanvasRef}
              className="radar-canvas rounded-lg max-w-full max-h-full"
            />
          </div>
          {detectionHistory.length === 0 && (
            <p className="text-[10px] font-mono text-muted-foreground/60 text-center mt-1">
              Place targets on the scan display — detections appear here as
              glowing dots
            </p>
          )}
        </div>

        {/* ── Angle Detection ────────────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Angle Detection (Return Intensity)
          </h3>
          <div className="flex-1 min-h-0">
            {isInitialLoadRef.current ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={angleDetChartData}
                  margin={{ top: 8, right: 10, bottom: 28, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    dataKey="angle"
                    type="number"
                    domain={[0, 359.5]}
                    tickCount={9}
                    tick={axisTickStyle}
                    label={{
                      value: "Beam Angle (°)",
                      position: "bottom",
                      offset: 8,
                      style: axisLabelStyle,
                    }}
                    tickFormatter={(v: number) => `${Math.round(v)}°`}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={axisTickStyle}
                    width={42}
                    label={{
                      value: "Norm. Intensity",
                      angle: -90,
                      position: "insideLeft",
                      style: axisLabelStyle,
                    }}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: unknown) => [
                      typeof value === "number" ? value.toFixed(4) : "0",
                      "Return",
                    ]}
                    labelFormatter={(label: unknown) => `θ = ${label}°`}
                  />
                  <ReferenceLine
                    x={parseFloat(
                      (Math.round(scanAngleDeg * 2) / 2).toFixed(1),
                    )}
                    stroke="hsla(270,80%,70%,0.7)"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  {placedTargets.map((t, ti) => (
                    <ReferenceLine
                      key={t.id}
                      x={parseFloat(
                        (Math.round(t.angleDeg * 2) / 2).toFixed(1),
                      )}
                      stroke={TARGET_COLORS[ti % TARGET_COLORS.length]}
                      strokeOpacity={0.55}
                      strokeWidth={1}
                      strokeDasharray="2 4"
                    />
                  ))}
                  <Line
                    type="monotoneX"
                    dataKey="intensity"
                    stroke="hsl(270,70%,58%)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ── Beam Width Comparison ──────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Beam Width Comparison (8 / 16 / 32 Elements)
          </h3>
          <div className="flex-1 min-h-0">
            {isInitialLoadRef.current ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={beamWidthChartData}
                  margin={{ top: 8, right: 16, bottom: 28, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    dataKey="angle"
                    type="number"
                    domain={[-90, 90]}
                    tickCount={7}
                    tick={axisTickStyle}
                    label={{
                      value: "Angle from boresight (°)",
                      position: "bottom",
                      offset: 8,
                      style: axisLabelStyle,
                    }}
                    tickFormatter={(v: number) => `${v}°`}
                  />
                  <YAxis
                    domain={[0, 1]}
                    tick={axisTickStyle}
                    label={{
                      value: "Normalised AF",
                      angle: -90,
                      position: "insideLeft",
                      style: axisLabelStyle,
                    }}
                    tickFormatter={(v: number) => v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: unknown, name: unknown) => [
                      typeof value === "number" ? value.toFixed(4) : "0",
                      String(name),
                    ]}
                    labelFormatter={(label: unknown) => `${label}°`}
                  />
                  <Legend wrapperStyle={legendStyle} />
                  <ReferenceLine
                    y={0.7071}
                    stroke="hsla(240,8%,55%,0.45)"
                    strokeDasharray="6 3"
                    label={{
                      value: "−3 dB",
                      position: "insideRight",
                      style: {
                        fill: "hsl(240,8%,55%)",
                        fontSize: 9,
                        fontFamily: "JetBrains Mono",
                      },
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="n8"
                    stroke="hsl(320,75%,62%)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="8 el. (wide)"
                  />
                  <Line
                    type="monotone"
                    dataKey="n16"
                    stroke="hsl(200,80%,62%)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="16 el. (medium)"
                  />
                  <Line
                    type="monotone"
                    dataKey="n32"
                    stroke="hsl(130,75%,55%)"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    name="32 el. (narrow)"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

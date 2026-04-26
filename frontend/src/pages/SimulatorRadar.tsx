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
import HeatmapView from "@/components/HeatmapView";
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
    const ey = radiusOverLambda * (1 - Math.cos(elemAngle));

    // Curved steering uses physical element position projection:
    // phi_n = k * (x*cos(theta) + y*sin(theta))
    const k = 2 * Math.PI;
    const elemPhase =
      k * (ex * Math.cos(thetaObsRad) + ey * Math.sin(thetaObsRad));

    // Steering phase: phase delay to steer main lobe to steeringRad
    const steerPhase =
      k * (ex * Math.cos(steeringRad) + ey * Math.sin(steeringRad));

    const wi = weights[i] ?? 1 / N;
    // Front-only element directivity for curved geometry.
    const elemFactor = Math.max(0, Math.cos(thetaObsRad - elemAngle));
    const totalPhase = elemPhase - steerPhase;
    re += wi * elemFactor * Math.cos(totalPhase);
    im += wi * elemFactor * Math.sin(totalPhase);
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
  compassAngle: number;  // 0-360°, compass style (0=top/north, CW)
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
  const [scanSpeed, setScanSpeed] = useState(60.0);
  const [scanDirection, setScanDirection] = useState<"cw" | "ccw">("cw");
  const scanDirectionRef = useRef<"cw" | "ccw">("cw");
  const [radarViewMode, setRadarViewMode] = useState<"ppi" | "heatmap">("ppi");

  // ── Scan angle ───────────────────────────────────────────────────────────────
  const [scanAngleDeg, setScanAngleDeg] = useState(0);
  const scanAngleRef = useRef(0);
  const [isScanning, setIsScanning] = useState(true);
  const isScanningRef = useRef(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetId: string } | null>(null);

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
  /** Tracks the last slot index written so we can detect revolution boundaries */
  const angleChartLastSlotRef = useRef<number>(ANGLE_SLOTS - 1);
  const backendNoiseRef = useRef<number[]>([]);
  const [angleSamples, setAngleSamples] = useState<AngleSample[]>([]);

  const beamInsideRef = useRef<Map<string, boolean>>(new Map());
  const lastChartFlushMs = useRef(0);

  // ── Detection params ref (read by RAF without stale closure) ──────────────────
  type DetParams = {
    numElements: number;
    spacingOverLambda: number;
    windowType: string;
    apodizationEnabled: boolean;
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
  const lastScanTickMsRef = useRef<number | null>(null);

  // ─── Keep refs current ────────────────────────────────────────────────────────

  useEffect(() => {
    placedTargetsRef.current = placedTargets;
  }, [placedTargets]);
  useEffect(() => {
    scanSpeedRef.current = scanSpeed;
  }, [scanSpeed]);

  useEffect(() => {
    scanDirectionRef.current = scanDirection;
  }, [scanDirection]);

  useEffect(() => {
    const wavelength = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const spacingOverLambda = Number(params.spacing ?? 0.5) / wavelength;
    // Phase shift uses compass→elevation: sin((90 - beamAngle) * π/180)
    // steeringAngleDeg is compass, so elevation = 90 - steeringAngleDeg
    const steeringOffsetDeg = Number(params.steeringAngleDeg ?? 0);
    const radiusOverLambda = Math.max(0.5, Number(params.radius ?? 5));
    const phaseOffsetRad =
      2 * Math.PI * spacingOverLambda * Math.sin((90 - steeringOffsetDeg) * Math.PI / 180);

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
          backendNoiseRef.current = res.data?.noiseBuffer || [];
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
    if (key === "steeringAngleDeg") {
      // steeringAngleDeg slider value equals beamAngle (compass) directly
      const nextAngle = clampAngleDeg360(Number(value));
      scanAngleRef.current = nextAngle;
      setScanAngleDeg(nextAngle);
    }
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
    const currentMode = "beamforming";
    const beamWidthDeg = Math.max(1, dp.beamWidthDeg);
    const halfBeam = beamWidthDeg / 2;

    // beamAngle is compass convention master variable
    const effectiveSweepDeg = clampAngleDeg360(sweepDeg);  // already compass, no offset

    // No local SNR calculations — backend is the single source of truth

    // Shortest-arc angular difference (degrees)
    const wrapDiff = (a: number, b: number): number => {
      let d = (((a - b) % 360) + 360) % 360;
      if (d > 180) d -= 360;
      return d;
    };

    // ── Angle Detection chart — written every frame ───────────────────────────
    try {
      // We track whether the beam has completed a full revolution.  At the start
      // of each new revolution we reset the entire buffer so stale values from
      // previous sweeps never persist and pollute the chart at high SNR.
      const slotIdx =
        Math.round((((effectiveSweepDeg % 360) + 360) % 360) * 2) % ANGLE_SLOTS;

      // Detect revolution boundary: when slotIdx wraps back near 0
      if (
        slotIdx < 4 &&
        (angleChartLastSlotRef.current ?? ANGLE_SLOTS - 1) > ANGLE_SLOTS - 8
      ) {
        // New revolution started — clear the buffer so stale noise never persists
        angleChartBufRef.current.fill(0);
      }
      angleChartLastSlotRef.current = slotIdx;

      // Compute clean signal for this slot (0 when beam is not over any target)
      let slotSignal = 0;
      for (const t of targets) {
        const targetAngleDeg = clampAngleDeg360(t.compassAngle);
        const diff = Math.abs(effectiveSweepDeg - targetAngleDeg);
        const deltaDeg = diff > 180 ? 360 - diff : diff;
        const targetRadiusM = t.sizeM / 2;
        const targetAngularSizeDeg =
          (Math.atan2(targetRadiusM, Math.max(0.1, t.distanceM)) * 180) / Math.PI;
        const detectionHalfWindow = halfBeam + targetAngularSizeDeg / 2;
        if (deltaDeg >= detectionHalfWindow) continue;
        const distM = Math.max(0.1, t.distanceM);
        let cleanSignal: number;
        if (currentMode === "mechanical") {
          const frac = deltaDeg / halfBeam;
          cleanSignal =
            (dp.amplitude * Math.cos((frac * Math.PI) / 2)) / (distM * distM);
        } else {
          const sv = sincNorm(deltaDeg / Math.max(0.5, beamWidthDeg));
          cleanSignal = (dp.amplitude * sv * sv) / (distM * distM);
        }
        if (!Number.isFinite(cleanSignal)) cleanSignal = 0;
        if (cleanSignal > slotSignal) slotSignal = cleanSignal;
      }

      // Single Source of Truth: Apply the exact noise sample computed by the Python backend
      const noiseBuffer = backendNoiseRef.current;
      let appliedNoise = 0;
      if (noiseBuffer && noiseBuffer.length > 0) {
        // Backend computes a 360-degree array of standard normal noise * noise_multiplier
        const exactAngleIdx = Math.round(effectiveSweepDeg) % 360;
        const backendNoiseSample = noiseBuffer[exactAngleIdx] || 0;
        // Scale proportionally for visual effect against target signals (amplitude)
        appliedNoise = Math.max(0, backendNoiseSample * dp.amplitude * 0.35);
      }

      angleChartBufRef.current[slotIdx] = Number.isFinite(slotSignal)
        ? Math.max(0, slotSignal + appliedNoise)
        : 0;
    } catch (e) {
      console.warn("Radar angle chart computation error:", e);
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

    try {
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const targetAngleDeg = clampAngleDeg360(t.compassAngle);
        const diff = Math.abs(effectiveSweepDeg - targetAngleDeg);
        const deltaDeg = diff > 180 ? 360 - diff : diff;
        // Target angular size contributes to detection window (spec requirement)
        const targetRadiusM = t.sizeM / 2;
        const targetAngularSizeDeg =
          (Math.atan2(targetRadiusM, Math.max(0.1, t.distanceM)) * 180) / Math.PI;
        const effectiveHalf =
          currentMode === "mechanical"
            ? halfBeam * 1.1 + targetAngularSizeDeg / 2
            : halfBeam + targetAngularSizeDeg / 2;
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

        // ── Single Source of Truth ──────────────────────────────────────────────
        // All detection checks are simplified. Radar purely detects based on backend
        // physics, which means noise modeling must be applied strictly via the API response.
        let detected = cleanSignal > 0.001;

        if (detected) hitIds.add(t.id);

        // Leading-edge recording: record when beam first enters AND detection succeeds
        if (!wasInside && detected) {
          // Spike is recorded at target.compassAngle on chart
          const targetSlot =
            Math.round((((targetAngleDeg % 360) + 360) % 360) * 2) % ANGLE_SLOTS;
          const spikeAbs = Math.max(
            dp.amplitude * 0.35,
            Math.min(dp.amplitude * 1.15, cleanSignal * 12),
          );
          angleChartBufRef.current[targetSlot] = Math.max(
            angleChartBufRef.current[targetSlot],
            spikeAbs,
          );
          const sideSpike = spikeAbs * 0.45;
          const left = (targetSlot - 1 + ANGLE_SLOTS) % ANGLE_SLOTS;
          const right = (targetSlot + 1) % ANGLE_SLOTS;
          angleChartBufRef.current[left] = Math.max(
            angleChartBufRef.current[left],
            sideSpike,
          );
          angleChartBufRef.current[right] = Math.max(
            angleChartBufRef.current[right],
            sideSpike,
          );

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
            `[Det] ti=${ti} dist=${t.distanceM.toFixed(2)}m angle=${targetAngleDeg.toFixed(1)}° detected=true`,
          );
        } else if (!wasInside && !detected) {
          console.log(
            `[Det] ti=${ti} dist=${t.distanceM.toFixed(2)}m angle=${targetAngleDeg.toFixed(1)}° detected=MISSED (below threshold)`,
          );
        }
      }
    } catch (e) {
      console.warn("Radar detection loop error:", e);
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

  // ─── Scan loop — degrees per second ────────────────────────────────────────────

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      // Scan speed slider controls degrees per second.
      const prevMs = lastScanTickMsRef.current;
      const dtSec =
        prevMs == null ? 0 : Math.min(0.1, Math.max(0, (now - prevMs) / 1000));
      lastScanTickMsRef.current = now;

      if (isScanningRef.current) {
        const nextAngle = clampAngleDeg360(
          scanAngleRef.current +
            (scanDirectionRef.current === "cw" ? 1 : -1) *
              scanSpeedRef.current *
              dtSec,
        );
        scanAngleRef.current = nextAngle;
        setScanAngleDeg(nextAngle);
        runDetectionRef.current(nextAngle, now);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastScanTickMsRef.current = null;
    };
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

      // Detection angle stored in compass convention; convert for PPI canvas drawing
      const canvasAngleRad = (d.angleDeg - 90) * Math.PI / 180;
      const rPx = (d.distanceM / DETECTION_RANGE_M) * R;
      const x = cx + Math.cos(canvasAngleRad) * rPx;
      const y = cy + Math.sin(canvasAngleRad) * rPx;

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

    // Sweep line: convert compass beamAngle to canvas angle for PPI
    const sweepCanvasRad = (scanAngleDeg - 90) * Math.PI / 180;
    const sweepGrad = ctx.createLinearGradient(
      cx,
      cy,
      cx + Math.cos(sweepCanvasRad) * R,
      cy + Math.sin(sweepCanvasRad) * R,
    );
    sweepGrad.addColorStop(0, "rgba(0,255,80,0.12)");
    sweepGrad.addColorStop(1, "rgba(0,255,80,0)");
    ctx.strokeStyle = sweepGrad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepCanvasRad) * R, cy + Math.sin(sweepCanvasRad) * R);
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
      // compassAngle stored in target → convert to canvas angle for drawing
      const canvasAngleRad = (t.compassAngle - 90) * Math.PI / 180;
      const r = (t.distanceM / DETECTION_RANGE_M) * radius;
      const x = cx + Math.cos(canvasAngleRad) * r;
      const y = cy + Math.sin(canvasAngleRad) * r;
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

    // beamAngle is compass (0=top/north, CW). Convert to canvas math angle for drawing.
    const beamAngle = scanAngleDeg; // compass convention master variable
    const canvasBeamRad = (beamAngle - 90) * Math.PI / 180;
    const sweepRad = canvasBeamRad; // alias used by wavefront/element rendering below
    const beamDirRad = canvasBeamRad;

    // Build centered element emitters from sidebar geometry/spacing parameters.
    const nElem = Math.max(
      2,
      Math.min(128, Math.round(Number(params.numElements ?? 32))),
    );
    const wavelength = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const spacingOverLambda = Math.max(
      0.01,
      Number(params.spacing ?? 0.5) / wavelength,
    );
    const wType =
      (params.apodizationEnabled ? params.windowType : "rectangular") ??
      "rectangular";
    const elementWeights = makeWindowWeights(wType, nElem);

    const localElements: Array<{
      xLambda: number;
      yLambda: number;
      weight: number;
      steerPhaseRad: number;
      phaseColorRad: number;
      phaseCycles: number;
      localFacingAngle: number;
    }> = [];

    // Arrange all elements as a centered circular ring.
    const ringRadiusPx = 20;
    const ringRadiusLambda = Math.max(
      0.3,
      (nElem * Math.max(0.01, spacingOverLambda)) / (2 * Math.PI),
    );
    for (let i = 0; i < nElem; i++) {
      const a = -Math.PI / 2 + (i / nElem) * 2 * Math.PI;
      const xLambda = ringRadiusLambda * Math.cos(a);
      const yLambda = ringRadiusLambda * Math.sin(a);
      // phi_n = 2pi * (x_n cos(theta) + y_n sin(theta)) / lambda.
      // xLambda/yLambda are already normalized by lambda.
      const phaseColorRad =
        2 * Math.PI * (xLambda * Math.cos(beamDirRad) + yLambda * Math.sin(beamDirRad));
      const steerPhaseRad = -phaseColorRad;
      const phaseCycles = ((steerPhaseRad / (2 * Math.PI)) % 1 + 1) % 1;
      localElements.push({
        xLambda,
        yLambda,
        weight: Math.max(1e-6, Math.abs(elementWeights[i] ?? 0)),
        steerPhaseRad,
        phaseColorRad,
        phaseCycles,
        localFacingAngle: a,
      });
    }

    const pxPerLambda = ringRadiusPx / ringRadiusLambda;
    const elementEmitters = localElements.map((el) => ({
      ...el,
      x: cx + el.xLambda * pxPerLambda,
      y: cy + el.yLambda * pxPerLambda,
    }));
    const maxAbsPhaseColorRad = Math.max(
      1e-9,
      ...elementEmitters.map((e) => Math.abs(e.phaseColorRad)),
    );

    // Faint per-element semicircular wavefronts propagating in current beam direction.
    if (elementEmitters.length > 0) {
      const nowS = nowMs / 1000;
      const waveRateHz = 1.2 + Math.min(2.1, scanSpeed * 0.2);
      const ringCount = 3;
      const maxWaveRadius = radius * 0.95;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const em of elementEmitters) {
        // Each element emits forward relative to its own local facing direction.
        const elementArcStart = em.localFacingAngle - Math.PI / 2;
        const elementArcEnd = em.localFacingAngle + Math.PI / 2;
        const emitterAlphaBase = Math.min(0.48, 0.12 + em.weight * 1.8);
        for (let ring = 0; ring < ringCount; ring++) {
          const phase = nowS * waveRateHz + em.phaseCycles - ring / ringCount;
          const wrapped = phase - Math.floor(phase);
          const pulseRadius = 2 + wrapped * maxWaveRadius;
          const fade = Math.pow(1 - wrapped, 1.28);
          const alpha = fade * emitterAlphaBase * 0.58;
          if (alpha < 0.012) continue;
          ctx.strokeStyle = `hsla(272,88%,74%,${alpha})`;
          ctx.lineWidth = 0.55 + em.weight * (1.25 - wrapped * 0.45);
          ctx.beginPath();
          ctx.arc(em.x, em.y, pulseRadius, elementArcStart, elementArcEnd);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Beam rendering: single filled rotating wedge tied to beam width.
    const beamWidthRad = degToRad(Math.max(1, Number(beamWidth ?? 10)));
    const halfBeam = beamWidthRad / 2;
    const beamStart = beamDirRad - halfBeam;
    const beamEnd = beamDirRad + halfBeam;
    const wedgeHue = 270;
    const wedgeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    wedgeGrad.addColorStop(0, `hsla(${wedgeHue},85%,70%,0.34)`);
    wedgeGrad.addColorStop(0.5, `hsla(${wedgeHue},85%,62%,0.20)`);
    wedgeGrad.addColorStop(1, `hsla(${wedgeHue},85%,58%,0.06)`);

    ctx.fillStyle = wedgeGrad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, beamStart, beamEnd);
    ctx.closePath();
    ctx.fill();

    // Array support and element dots (kept visible above beam layers).
    if (elementEmitters.length > 0) {
      ctx.strokeStyle = "hsla(270,65%,75%,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < elementEmitters.length; i++) {
        const p = elementEmitters[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();

      for (const em of elementEmitters) {
        const dotR = 1.5 + Math.min(1.8, Math.sqrt(em.weight) * 3.2);
        const phaseNorm = Math.max(
          -1,
          Math.min(1, em.phaseColorRad / maxAbsPhaseColorRad),
        );
        const blue = { r: 70, g: 130, b: 245 };
        const neutral = { r: 228, g: 230, b: 236 };
        const red = { r: 235, g: 86, b: 86 };
        const mix = (
          a: { r: number; g: number; b: number },
          b: { r: number; g: number; b: number },
          t: number,
        ) => ({
          r: Math.round(a.r + (b.r - a.r) * t),
          g: Math.round(a.g + (b.g - a.g) * t),
          b: Math.round(a.b + (b.b - a.b) * t),
        });
        const col =
          phaseNorm < 0
            ? mix(blue, neutral, phaseNorm + 1)
            : mix(neutral, red, phaseNorm);
        ctx.fillStyle = `rgba(${col.r},${col.g},${col.b},0.96)`;
        ctx.beginPath();
        ctx.arc(em.x, em.y, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Phase legend near the array center.
      const legendW = 126;
      const legendH = 8;
      const legendX = Math.max(10, Math.min(size - legendW - 10, cx - legendW / 2));
      const legendY = Math.max(10, Math.min(size - 20, cy + radius * 0.2));

      ctx.fillStyle = "hsla(240,10%,8%,0.55)";
      ctx.fillRect(legendX - 4, legendY - 16, legendW + 8, legendH + 22);

      const phaseLegend = ctx.createLinearGradient(legendX, 0, legendX + legendW, 0);
      phaseLegend.addColorStop(0, "rgb(70,130,245)");
      phaseLegend.addColorStop(0.5, "rgb(228,230,236)");
      phaseLegend.addColorStop(1, "rgb(235,86,86)");
      ctx.fillStyle = phaseLegend;
      ctx.fillRect(legendX, legendY, legendW, legendH);
      ctx.strokeStyle = "hsla(240,8%,85%,0.45)";
      ctx.lineWidth = 0.8;
      ctx.strokeRect(legendX, legendY, legendW, legendH);

      ctx.fillStyle = "hsla(240,8%,86%,0.92)";
      ctx.font = "8px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText("Lagging (blue) -> Leading (red)", legendX + legendW / 2, legendY - 4);
      ctx.textAlign = "left";
    }

    // Central icon
    ctx.fillStyle = "hsla(270,70%,60%,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "hsla(270,70%,80%,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
    ctx.stroke();
    // HUD
    const wHUD = Math.max(0.01, Number(params.wavelength ?? 1.0));
    const dHUD = Number(params.spacing ?? 0.5) / wHUD;
    // Phase shift uses compass→elevation: sin((90 - beamAngle) * π/180)
    const rawDPhi = 2 * Math.PI * dHUD * Math.sin((90 - beamAngle) * Math.PI / 180);
    const dPhi = ((rawDPhi + Math.PI) % (2 * Math.PI)) - Math.PI;
    ctx.fillStyle = "hsla(240,8%,78%,0.75)";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(`θ: ${beamAngle.toFixed(1)}°`, 14, 22);
    ctx.fillText(`Δφ: ${dPhi.toFixed(2)} rad`, 14, 38);
    ctx.fillText(
      `${scanSpeed.toFixed(1)}°/s  ${(params.geometry ?? "linear").toUpperCase()}`,
      14,
      54,
    );
    ctx.font = "bold 11px JetBrains Mono";
    ctx.fillStyle = "hsla(270,80%,72%,0.9)";
    ctx.textAlign = "right";
    ctx.fillText(scanDirection === "cw" ? "CW" : "CCW", size - 14, 22);
    ctx.textAlign = "left";
  }, [
    radar,
    params,
    scanAngleDeg,
    placedTargets,
    selectedTargetId,
    scanDirection,
    scanSpeed,
    beamWidth,
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
        const tCanvasRad = (t.compassAngle - 90) * Math.PI / 180;
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(tCanvasRad) * tr;
        const ty = cy + Math.sin(tCanvasRad) * tr;
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
      setContextMenu(null);
      const canvas = radarCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const radiusPx = canvas.width / 2 - 20;
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      for (const t of placedTargetsRef.current) {
        const tCanvasRad = (t.compassAngle - 90) * Math.PI / 180;
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(tCanvasRad) * tr;
        const ty = cy + Math.sin(tCanvasRad) * tr;
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
      // Compass angle: negate dy because canvas Y is flipped
      const newAngle = (90 - Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
      const newDist = Math.min(
        DETECTION_RANGE_M * 0.98,
        (rPx / radiusPx) * DETECTION_RANGE_M,
      );
      dragRef.current.moved = true;
      const dragId = dragRef.current.id;
      placedTargetsRef.current = placedTargetsRef.current.map((p) =>
        p.id === dragId ? { ...p, compassAngle: newAngle, distanceM: newDist } : p,
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
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
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
      // Compass angle from canvas pixel: negate dy because canvas Y is flipped
      const clickAngle = (90 - Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
      const clickDist = (rPx / radiusPx) * DETECTION_RANGE_M;
      const targets = placedTargetsRef.current;
      for (const t of targets) {
        const tCanvasRad = (t.compassAngle - 90) * Math.PI / 180;
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(tCanvasRad) * tr;
        const ty = cy + Math.sin(tCanvasRad) * tr;
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
        compassAngle: clickAngle,
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

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radiusPx = canvas.width / 2 - 20;
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);

    for (const t of placedTargetsRef.current) {
      const tCanvasRad = (t.compassAngle - 90) * Math.PI / 180;
      const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
      const tx = cx + Math.cos(tCanvasRad) * tr;
      const ty = cy + Math.sin(tCanvasRad) * tr;
      const pr = Math.max(4, (t.sizeM / DETECTION_RANGE_M) * radiusPx);
      if (Math.hypot(mx - tx, my - ty) <= pr + 10) {
        setContextMenu({ x: e.clientX, y: e.clientY, targetId: t.id });
        return;
      }
    }
    setContextMenu(null);
  }, []);

  const deleteTarget = useCallback((id: string) => {
    const updated = placedTargetsRef.current.filter((t) => t.id !== id);
    placedTargetsRef.current = updated;
    setPlacedTargets(updated);
    setContextMenu(null);
  }, []);

  // ─── Derived chart data ───────────────────────────────────────────────────────

  /** Angle Detection: normalised by reference amplitude, NOT by peak.
   *
   * Normalising by peak causes the chart to auto-scale so noise fills
   * 0..1 even at high SNR.  Instead we divide by dp.amplitude (the
   * reference signal at 1 m distance) so the Y axis is stable and noise
   * is genuinely tiny at high SNR.  Values are clamped to [0, 1] so a
   * close target spike stays at 1 and the noise floor sits near 0.
   */
  const angleDetChartData = useMemo(() => {
    if (angleSamples.length === 0) return [];
    // Reference: peak signal at 1 m, boresight → amplitude / 1² = amplitude
    const refAmplitude = Math.max(0.001, detParamsRef.current.amplitude);
    return angleSamples.map((s) => ({
      angle: s.angle,
      intensity: parseFloat(
        Math.min(1, Math.max(0, s.intensity / refAmplitude)).toFixed(4),
      ),
    }));
  }, [angleSamples]);



  // ─── Utilities ────────────────────────────────────────────────────────────────

  // ─── Radar Heatmap Data ────────────────────────────────────────────────────────
  const interferenceHeatmapData = useMemo(() => {
    if (radarViewMode !== "heatmap") {
      return { grid: [[0]], xRange: [0], yRange: [0], maxVal: 1, extent: 1 };
    }

    const GRID_N = 80; // Optimized resolution for performance
    const C = 3e8; // Speed of light
    
    const ext = Math.max(1, DETECTION_RANGE_M);
    const spanX = 2 * ext;
    const spanY = 2 * ext;
    const xRange = Array.from({ length: GRID_N }, (_, i) => -ext + (i / (GRID_N - 1)) * spanX);
    const yRange = Array.from({ length: GRID_N }, (_, i) => -ext + (i / (GRID_N - 1)) * spanY);

    const nElem = Math.max(2, Math.min(128, Math.round(Number(params.numElements ?? 32))));
    const freqHz = Number(params.frequency ?? 10e9);
    const wavelength = Math.max(1e-9, C / Math.max(1.0, freqHz));
    const spacingMeters = Math.max(1e-6, Number(params.spacing ?? 0.5) * wavelength);
    const amplitude = Math.max(1e-6, Number(params.amplitude ?? 1.0));
    
    const wType = (params.apodizationEnabled ? params.windowType : "rectangular") ?? "rectangular";
    const weights = makeWindowWeights(wType, nElem);
    const wNorm = Math.max(1e-9, weights.reduce((s, w) => s + Math.abs(w), 0));
    const kWave = (2 * Math.PI) / wavelength;

    const steeringOffsetDeg = Number(params.steeringAngleDeg ?? 0);
    const sweepRad = degToRad(scanAngleDeg);
    const beamDirRad = degToRad(scanAngleDeg + steeringOffsetDeg);
    const geometry = params.geometry ?? "linear";
    const radiusOverLambda = Math.max(0.5, Number(params.radius ?? 5));
    const ringRadiusMeters = radiusOverLambda * wavelength;

    const elementEmitters: Array<{ x: number; y: number; amp: number; phase: number; k: number; facingAngle: number; isCurved: boolean }> = [];

    if (geometry === "curved") {
      const arcLength = spacingMeters * (nElem - 1);
      const totalSweep = arcLength / Math.max(1e-6, ringRadiusMeters);
      const a0 = -totalSweep / 2;
      for (let i = 0; i < nElem; i++) {
        const t = nElem === 1 ? 0 : i / (nElem - 1);
        const alpha_n = a0 + t * totalSweep;
        const ex = ringRadiusMeters * Math.sin(alpha_n);
        const ey = ringRadiusMeters * (1 - Math.cos(alpha_n));
        const steerPhase = kWave * (ex * Math.cos(beamDirRad) + ey * Math.sin(beamDirRad));
        const phase = -steerPhase;
        const elemAmp = amplitude * ((weights[i] ?? 1) / wNorm);
        elementEmitters.push({
          x: ex,
          y: ey,
          amp: elemAmp,
          phase,
          k: kWave,
          facingAngle: alpha_n,
          isCurved: true,
        });
      }
    } else {
      const centerOffset = (nElem - 1) / 2;
      for (let i = 0; i < nElem; i++) {
        const offset = (i - centerOffset) * spacingMeters;
        const ex = offset;
        const ey = 0;
        const steerPhase = kWave * (ex * Math.cos(beamDirRad) + ey * Math.sin(beamDirRad));
        const phase = -steerPhase;
        const elemAmp = amplitude * ((weights[i] ?? 1) / wNorm);
        elementEmitters.push({
          x: ex,
          y: ey,
          amp: elemAmp,
          phase,
          k: kWave,
          facingAngle: beamDirRad,
          isCurved: false,
        });
      }
    }


    const maxR = DETECTION_RANGE_M;
    const rawGrid: number[][] = [];

    for (let yi = 0; yi < GRID_N; yi++) {
      const py = yRange[GRID_N - 1 - yi];
      const row: number[] = [];
      for (let xi = 0; xi < GRID_N; xi++) {
        const px = xRange[xi];
        const theta = Math.atan2(py, px);
        const r = Math.hypot(px, py);

        let real = 0;
        let imag = 0;
        for (const em of elementEmitters) {
          // Array Factor contribution in direction theta including steering phase
          const phase = (em.k * (em.x * Math.cos(theta) + em.y * Math.sin(theta))) + em.phase;
          let elemFactor = 1.0;
          if (em.isCurved) {
            // Suppress rear radiation for curved elements.
            elemFactor = Math.max(0, Math.cos(theta - em.facingAngle));
          }
          real += em.amp * elemFactor * Math.cos(phase);
          imag += em.amp * elemFactor * Math.sin(phase);
        }

        const AF = Math.sqrt(real * real + imag * imag) / (amplitude || 1);
        // Apply distance falloff: intensity = AF * exp(-r/maxR)
        const intensity = Math.min(1, AF * Math.exp(-r / (maxR * 0.8)));
        row.push(intensity);
      }
      rawGrid.push(row);
    }

    const maxVal = 1.0;

    return {
      grid: rawGrid,
      xRange,
      yRange,
      maxVal: Math.max(1e-9, maxVal),
      extent: Math.max(spanX, spanY),
    };
  }, [
    params.numElements,
    params.spacing,
    params.wavelength,
    params.windowType,
    params.apodizationEnabled,
    params.steeringAngleDeg,
    params.amplitude,
    params.frequency,
    params.geometry,
    params.radius,
    scanAngleDeg,
    radarViewMode
  ]);

  const clearChartData = useCallback(() => {
    detectionHistoryRef.current = [];
    setDetectionHistory([]);
    angleChartBufRef.current.fill(0);
    angleChartLastSlotRef.current = ANGLE_SLOTS - 1;
    beamInsideRef.current.clear();
    setAngleSamples([]);
    simStartMs.current = performance.now();
  }, []);

  // ─── Extra controls ───────────────────────────────────────────────────────────

  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportState = useCallback(() => {
    const state = {
      params,
      placedTargets,
      scanDirection,
      beamWidth,
      scanSpeed,
      radarViewMode,
      isScanning,
      scanAngleDeg,
    };
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `radar-state-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [params, placedTargets, scanDirection, beamWidth, scanSpeed, radarViewMode, isScanning, scanAngleDeg]);

  const importState = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const state = JSON.parse(ev.target?.result as string);
        if (state.params) setParams(state.params);
        if (state.placedTargets) {
          placedTargetsRef.current = state.placedTargets;
          setPlacedTargets(state.placedTargets);
        }
        if (state.scanDirection) {
          setScanDirection(state.scanDirection);
          scanDirectionRef.current = state.scanDirection;
        }
        if (state.beamWidth !== undefined) setBeamWidth(state.beamWidth);
        if (state.scanSpeed !== undefined) {
          setScanSpeed(state.scanSpeed);
          scanSpeedRef.current = state.scanSpeed;
        }
        if (state.radarViewMode) setRadarViewMode(state.radarViewMode);
        if (state.isScanning !== undefined) {
          setIsScanning(state.isScanning);
          isScanningRef.current = state.isScanning;
        }
        if (state.scanAngleDeg !== undefined) {
          setScanAngleDeg(state.scanAngleDeg);
          scanAngleRef.current = state.scanAngleDeg;
        }
        clearChartData();
      } catch (err) {
        console.error("Failed to import radar state:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [clearChartData]);

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

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".json"
          onChange={importState}
        />

        <div className="grid grid-cols-2 gap-2 mb-2">
          <button
            type="button"
            onClick={exportState}
            className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center justify-center gap-1.5"
          >
            <span className="text-xs">⤓</span> Export JSON
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5"
          >
            <span className="text-xs">⤒</span> Import JSON
          </button>
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
                  setScanSpeed(180.0);
                  const base = performance.now();
                  const preset: PlacedTarget[] = [
                    { id: `Q1-${base}`, compassAngle: 45, distanceM: 6.0, sizeM: 0.5, lastHitMs: 0 },
                  ];
                  placedTargetsRef.current = preset;
                  setPlacedTargets(preset);
                }
                if (s === "precision") {
                  setBeamWidth(4);
                  setScanSpeed(35.0);
                  const base = performance.now();
                  const preset: PlacedTarget[] = [
                    { id: `P1-${base}`, compassAngle: 120, distanceM: 8.5, sizeM: 0.2, lastHitMs: 0 },
                  ];
                  placedTargetsRef.current = preset;
                  setPlacedTargets(preset);
                }
                if (s === "multi") {
                  setBeamWidth(14);
                  setScanSpeed(90.0);
                  const base = performance.now();
                  const preset: PlacedTarget[] = [
                    {
                      id: `P1-${base}`,
                      compassAngle: 20,
                      distanceM: 2.2,
                      sizeM: 0.45,
                      lastHitMs: 0,
                    },
                    {
                      id: `P2-${base}`,
                      compassAngle: 75,
                      distanceM: 5.5,
                      sizeM: 0.7,
                      lastHitMs: 0,
                    },
                    {
                      id: `P3-${base}`,
                      compassAngle: 140,
                      distanceM: 7.8,
                      sizeM: 0.55,
                      lastHitMs: 0,
                    },
                    {
                      id: `P4-${base}`,
                      compassAngle: 230,
                      distanceM: 3.8,
                      sizeM: 0.85,
                      lastHitMs: 0,
                    },
                    {
                      id: `P5-${base}`,
                      compassAngle: 310,
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
            {scanSpeed.toFixed(1)}°/second
          </span>
        </div>
        <Slider
          value={[scanSpeed]}
          min={10}
          max={240}
          step={5}
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
            <div className="space-y-1.5 pt-3 border-t border-white/10 mt-3">
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
          <ControlPanel
            params={{ ...params, steeringAngleDeg: Math.round(scanAngleDeg) }}
            onParamChange={updateParam}
          />
        }
      >
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  const panelTitle = `Radar Scan (${(params.geometry ?? "linear").toUpperCase()})`;

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
          params={{ ...params, steeringAngleDeg: Math.round(scanAngleDeg) }}
          onParamChange={updateParam}
          extra={extraControls}
        />
      }
    >
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        {/* ── Radar Scan Canvas ──────────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
              {panelTitle}
            </h3>
            <button
              type="button"
              onClick={() => {
                setIsScanning((prev) => {
                  const next = !prev;
                  isScanningRef.current = next;
                  return next;
                });
              }}
              className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              {isScanning ? "⏸ Pause" : "▶ Resume"}
            </button>
          </div>
          <div className="flex gap-2 mb-2">
            {(["cw", "ccw"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  scanDirectionRef.current = mode;
                  setScanDirection(mode);
                }}
                className={`flex-1 h-7 text-[10px] font-mono uppercase tracking-wider rounded-md transition-colors ${
                  scanDirection === mode
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/5 border border-white/15 hover:bg-white/10"
                }`}
              >
                {mode === "cw" ? "Clockwise (CW)" : "Counter-Clockwise (CCW)"}
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
              onContextMenu={handleContextMenu}
              className={`radar-canvas rounded-lg max-w-full max-h-full cursor-crosshair ${isInitialLoadRef.current ? "loading" : "ready"}`}
            />
            {contextMenu && (
              <div
                className="fixed z-[100] bg-[#1a1a1a] border border-white/10 rounded-md shadow-xl py-1 overflow-hidden min-w-[100px]"
                style={{ left: contextMenu.x, top: contextMenu.y }}
              >
                <button
                  onClick={() => deleteTarget(contextMenu.targetId)}
                  className="w-full px-3 py-1.5 text-[11px] font-mono text-left hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center gap-2"
                >
                  <span className="text-sm">×</span> Delete Target
                </button>
              </div>
            )}
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
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
              {radarViewMode === "heatmap" ? "Interference Heatmap" : "PPI Radar Screen"}
            </h3>
            <button
              type="button"
              onClick={() => setRadarViewMode(prev => prev === "ppi" ? "heatmap" : "ppi")}
              className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Show {radarViewMode === "heatmap" ? "PPI Screen" : "Heatmap"}
            </button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            {radarViewMode === "ppi" ? (
              <canvas
                ref={ppiCanvasRef}
                className="radar-canvas rounded-lg max-w-full max-h-full"
              />
            ) : (
              <HeatmapView data={interferenceHeatmapData} />
            )}
          </div>
          {radarViewMode === "ppi" && detectionHistory.length === 0 && (
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
                        (Math.round(t.compassAngle * 2) / 2).toFixed(1),
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

        {/* ── Empty Slot (Removed Beam Comparison) ─────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col items-center justify-center border-dashed border-white/5 bg-transparent">
           <p className="text-[10px] font-mono text-muted-foreground/30 uppercase tracking-widest">Reserved for Future Diagnostics</p>
        </div>
      </div>
    </MainLayout>
  );
}

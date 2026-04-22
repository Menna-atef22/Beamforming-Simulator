import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import { useRadarSimulatorAPI, SimulatorRadarResponse, RadarTarget } from "@/hooks/useRadarSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./SimulatorRadar.css";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell,
} from "recharts";

function clampAngleDeg360(a: number) {
  let x = a % 360;
  if (x < 0) x += 360;
  return x;
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function normalizedSinc(x: number) {
  if (Math.abs(x) < 1e-12) return 1;
  return Math.sin(x) / x;
}

function makeWindowWeights(type: string, n: number): number[] {
  const N = Math.max(1, Math.floor(n));
  if (N === 1) return [1];
  const w = new Array(N).fill(1);

  const twoPi = 2 * Math.PI;
  switch (type) {
    case "hamming":
      for (let i = 0; i < N; i++) w[i] = 0.54 - 0.46 * Math.cos((twoPi * i) / (N - 1));
      break;
    case "hanning":
    case "hann":
      for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((twoPi * i) / (N - 1));
      break;
    case "blackman":
      for (let i = 0; i < N; i++) {
        const a = (twoPi * i) / (N - 1);
        w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
      }
      break;
    case "rectangular":
    default:
      break;
  }

  // Normalize by sum(abs)
  const norm = Math.max(1e-9, w.reduce((s, x) => s + Math.abs(x), 0));
  return w.map((x) => x / norm);
}

function computeArrayFactor(
  n: number,
  spacingOverLambda: number,
  thetaRelRad: number,
  weights: number[],
) {
  // Simple ULA magnitude pattern (closed form for rectangular, weighted sum for windows)
  const N = Math.max(1, Math.floor(n));
  const d = spacingOverLambda;
  const psi = Math.PI * d * Math.sin(thetaRelRad);
  if (N <= 1) return 1;
  const isRect = weights.every((w) => Math.abs(w - weights[0]) < 1e-6);
  if (isRect) {
    // |sin(N*psi)/ (N*sin(psi))|
    const denom = Math.max(1e-12, Math.sin(psi));
    return Math.abs(Math.sin(N * psi) / (N * denom));
  }

  // Weighted AF magnitude
  let re = 0;
  let im = 0;
  const center = (N - 1) / 2;
  for (let i = 0; i < N; i++) {
    const p = (i - center) * 2 * psi;
    const wi = weights[i] ?? 0;
    re += wi * Math.cos(p);
    im += wi * Math.sin(p);
  }
  return Math.sqrt(re * re + im * im);
}

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
  // Radar-specific parameters
  frequency: 10e9,
  scanRangeDeg: 360,
  gridSize: 360,
  computeDoppler: true,
};

export default function SimulatorRadar() {
  const [params, setParams] = useState<BeamformingParams & Record<string, any>>(defaultParams);
  const debouncedParams = useDebounce(params, 300);
  const [result, setResult] = useState<SimulatorRadarResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = useRadarSimulatorAPI();
  const [beamWidth, setBeamWidth] = useState(10);
  const [scanSpeed, setScanSpeed] = useState(5);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const [scanAngleDeg, setScanAngleDeg] = useState(0);
  const DETECTION_RANGE_M = 10;
  const [scanMode, setScanMode] = useState<"search" | "track">("search");
  const [trackTargetId, setTrackTargetId] = useState<string | null>(null);
  const trackRef = useRef<{
    targetId: string | null;
    startedMs: number;
    endMs: number;
    sweepDir: 1 | -1;
    minHitDiffDeg: number;
    maxHitDiffDeg: number;
  }>({ targetId: null, startedMs: 0, endMs: 0, sweepDir: 1, minHitDiffDeg: 999, maxHitDiffDeg: -999 });

  type PlacedTarget = {
    id: string;
    angleDeg: number;     // 0° = +x, CCW
    distanceM: number;    // 0..DETECTION_RANGE_M
    sizeM: number;        // target radius in meters (for display + hit tolerance)
    lastHitMs: number;    // for flash/highlight
    estimatedSizeM?: number;
  };
  const [placedTargets, setPlacedTargets] = useState<PlacedTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<"custom" | "quick" | "precision" | "multi">("custom");

  // Run simulation when debounced params change - FIXED: no isInitialLoad in deps
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
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    
    runSim();
    return () => {
      isMounted = false;
    };
  }, [debouncedParams, simulate]);

  const updateParam = <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const wrapAngleDiffDeg = useCallback((a: number, b: number) => {
    // minimal signed angle diff a-b in [-180,180]
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }, []);

  const effectiveSearchBeamWidth = Math.max(2, beamWidth);
  const effectiveSearchSpeed = Math.max(0.5, scanSpeed);
  const effectiveTrackBeamWidth = Math.max(1.5, effectiveSearchBeamWidth * 0.25);
  const effectiveTrackSpeed = Math.max(0.5, effectiveSearchSpeed * (effectiveTrackBeamWidth / Math.max(2, effectiveSearchBeamWidth)));

  // Continuous 360° electronic scan (beam steering, not mechanical rotation)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      // Track state machine timing
      const tr = trackRef.current;
      if (scanMode === "track" && tr.targetId && now < tr.endMs) {
        // During tracking, sweep narrowly around the target center.
        const tgt = placedTargets.find((t) => t.id === tr.targetId);
        if (tgt) {
          const sweepSpan = Math.max(6, effectiveTrackBeamWidth * 3.5); // degrees total span
          const step = effectiveTrackSpeed * dt * tr.sweepDir;
          const next = clampAngleDeg360(scanAngleDeg + step);
          const diffToCenter = wrapAngleDiffDeg(next, tgt.angleDeg);
          if (Math.abs(diffToCenter) > sweepSpan / 2) {
            tr.sweepDir = (tr.sweepDir === 1 ? -1 : 1);
          }
          setScanAngleDeg((prev) => clampAngleDeg360(prev + effectiveTrackSpeed * dt * tr.sweepDir));
        } else {
          setScanMode("search");
          setTrackTargetId(null);
          trackRef.current = { targetId: null, startedMs: 0, endMs: 0, sweepDir: 1, minHitDiffDeg: 999, maxHitDiffDeg: -999 };
        }
      } else if (scanMode === "track" && tr.targetId && now >= tr.endMs) {
        // Finalize size estimate from hit span
        const tgt = placedTargets.find((t) => t.id === tr.targetId);
        if (tgt && tr.maxHitDiffDeg > tr.minHitDiffDeg && tr.minHitDiffDeg < 900) {
          const spanDeg = Math.max(0, tr.maxHitDiffDeg - tr.minHitDiffDeg);
          const est = tgt.distanceM * Math.sin(degToRad(spanDeg / 2));
          setPlacedTargets((prev) => prev.map((p) => p.id === tgt.id ? { ...p, estimatedSizeM: Number.isFinite(est) ? est : p.estimatedSizeM } : p));
        }
        setScanMode("search");
        setTrackTargetId(null);
        trackRef.current = { targetId: null, startedMs: 0, endMs: 0, sweepDir: 1, minHitDiffDeg: 999, maxHitDiffDeg: -999 };
        setScanAngleDeg((prev) => clampAngleDeg360(prev + effectiveSearchSpeed * dt));
      } else {
        setScanAngleDeg((prev) => clampAngleDeg360(prev + effectiveSearchSpeed * dt));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [effectiveSearchSpeed, effectiveTrackSpeed, effectiveTrackBeamWidth, scanMode, placedTargets, scanAngleDeg, wrapAngleDiffDeg]);

  const radar = useMemo(() => {
    if (!result?.data) return null;
    return {
      angles: result.data.anglesDeg?.filter(Number.isFinite) || [],
      magnitudes: result.data.magnitudes || [],
      magnitudesDb: result.data.magnitudesDb || [],
      targets: (result.data.targets || []).filter(
        (t: RadarTarget) => 
          t && Number.isFinite(t.angleDeg) && Number.isFinite(t.distanceM) && Number.isFinite(t.rcsDbsm)
      ),
      metrics: result.data.metrics || {},
    };
  }, [result]);

  // Radar scan view (polar canvas with rotating beam and objects)
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas || !radar) return;
    const ctx = canvas.getContext("2d")!;
    const size = canvas.width = canvas.height = 380;
    const cx = size / 2, cy = size / 2, radius = size / 2 - 20;

    // Background
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
      ctx.fillText(`${r * 2.5}`, cx + 3, cy - (radius * r) / 4 + 3);
    }

    // Cross hairs
    ctx.beginPath(); ctx.moveTo(cx, 10); ctx.lineTo(cx, size - 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, cy); ctx.lineTo(size - 10, cy); ctx.stroke();

    // Radar returns (polar intensity)
    if (radar.angles.length > 0 && radar.magnitudes.length > 0) {
      const maxReturn = Math.max(...radar.magnitudes, 0.001);
      radar.angles.forEach((angleDeg, i) => {
        const intensity = radar.magnitudes[i] ?? 0;
        if (intensity < 0.01) return;
        const angleRad = (angleDeg - 90) * Math.PI / 180;
        const r = (intensity / maxReturn) * radius * 0.8;
        const x = cx + Math.cos(angleRad) * r;
        const y = cy + Math.sin(angleRad) * r;
        const alpha = Math.min(1, intensity / maxReturn);
        ctx.fillStyle = `hsla(270,70%,50%,${alpha * 0.4})`;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Targets
    radar.targets.forEach((target: RadarTarget, i: number) => {
      if (!target || !Number.isFinite(target.angleDeg) || !Number.isFinite(target.distanceM)) return;
      const angleRad = (target.angleDeg - 90) * Math.PI / 180;
      const r = (target.distanceM / 10) * radius;
      const x = cx + Math.cos(angleRad) * r;
      const y = cy + Math.sin(angleRad) * r;

      // Glow
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

    // User-placed solid targets (click-to-place)
    const nowMs = performance.now();
    for (const t of placedTargets) {
      const a = degToRad(t.angleDeg);
      const r = (t.distanceM / DETECTION_RANGE_M) * radius;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const pr = Math.max(3, (t.sizeM / DETECTION_RANGE_M) * radius);

      const isSelected = selectedTargetId === t.id;
      const age = nowMs - (t.lastHitMs || 0);
      const hitGlow = age >= 0 && age < 350 ? (1 - age / 350) : 0;

      // Flash/highlight on detection
      if (hitGlow > 0) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, pr * 6);
        glow.addColorStop(0, `hsla(45,95%,70%,${0.55 * hitGlow})`);
        glow.addColorStop(1, "hsla(45,95%,70%,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, pr * 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Solid target body
      ctx.fillStyle = isSelected ? "hsl(45,90%,60%)" : "hsl(210,12%,70%)";
      ctx.strokeStyle = isSelected ? "hsl(45,90%,85%)" : "hsl(210,10%,85%)";
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "hsla(240,10%,10%,0.85)";
      ctx.font = "bold 9px JetBrains Mono";
      ctx.fillText("●", x - 3, y + 3);
    }

    // Central phased array icon (fixed)
    ctx.fillStyle = "hsla(270,70%,60%,0.9)";
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "hsla(270,70%,80%,0.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Electronic scan steering angle (0° = +x, increases CCW)
    const sweepRad = degToRad(scanAngleDeg);

    // Draw polar beam lobes from array factor AF(θ) over [-90°, +90°] relative to steering direction.
    const nElem = Math.max(2, Math.min(128, Math.round(Number(params.numElements ?? 32))));
    const dOverLambda = Number(params.spacing ?? 0.5);
    const weights = makeWindowWeights(
      (params.apodizationEnabled ? params.windowType : "rectangular") ?? "rectangular",
      nElem
    );

    const samples = 181; // -90..+90 inclusive
    const pts: Array<{ x: number; y: number; a: number }> = [];
    let peak = 1e-9;
    for (let i = 0; i < samples; i++) {
      const relDeg = -90 + (180 * i) / (samples - 1);
      const relRad = degToRad(relDeg);
      const af = computeArrayFactor(nElem, dOverLambda, relRad, weights);
      peak = Math.max(peak, af);
      pts.push({ x: relRad, y: af, a: relDeg });
    }

    // Filled lobe shape
    const lobeScale = radius * 0.92;
    ctx.fillStyle = "hsla(270,70%,55%,0.10)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let i = 0; i < pts.length; i++) {
      const relRad = pts[i].x;
      const af = pts[i].y / peak;
      // exaggerate a bit so sidelobes are visible
      const r = lobeScale * Math.pow(Math.max(0, af), 0.7);
      const ang = sweepRad + relRad;
      ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    }
    ctx.closePath();
    ctx.fill();

    // Bright outline for main lobe + sidelobes
    ctx.strokeStyle = "hsla(270,80%,70%,0.45)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const relRad = pts[i].x;
      const af = pts[i].y / peak;
      const r = lobeScale * Math.pow(Math.max(0, af), 0.7);
      const ang = sweepRad + relRad;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Sweep ray (for clarity)
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweepRad) * radius, cy + Math.sin(sweepRad) * radius);
    grad.addColorStop(0, "hsla(270,75%,60%,0.75)");
    grad.addColorStop(1, "hsla(270,75%,60%,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepRad) * radius, cy + Math.sin(sweepRad) * radius);
    ctx.stroke();

    // Display instantaneous electronic phase step Δφ between adjacent elements
    // Δφ = 2π * (d/λ) * sin(θ)
    const deltaPhi = 2 * Math.PI * dOverLambda * Math.sin(sweepRad);
    ctx.fillStyle = "hsla(240,8%,75%,0.7)";
    ctx.font = "10px JetBrains Mono";
    ctx.fillText(`mode ${scanMode}`, 14, 22);
    ctx.fillText(`θ ${scanAngleDeg.toFixed(1)}°`, 14, 38);
    ctx.fillText(`Δφ ${deltaPhi.toFixed(2)} rad`, 14, 54);
  }, [radar, params, beamWidth, scanAngleDeg, placedTargets, selectedTargetId]);

  // Hit-test: wide search detects presence; narrow track estimates size.
  useEffect(() => {
    if (placedTargets.length === 0) return;
    const nElem = Math.max(2, Math.min(128, Math.round(Number(params.numElements ?? 32))));
    const dOverLambda = Number(params.spacing ?? 0.5);
    const weights = makeWindowWeights(
      (params.apodizationEnabled ? params.windowType : "rectangular") ?? "rectangular",
      nElem
    );
    const isTracking = scanMode === "track" && trackTargetId != null;
    const halfBeam = Math.max(0.75, (isTracking ? effectiveTrackBeamWidth : effectiveSearchBeamWidth) / 2);
    const sweep = scanAngleDeg;
    const now = performance.now();

    let bestHit: { id: string; score: number; diff: number } | null = null;

    setPlacedTargets((prev) => prev.map((t) => {
      const diff = wrapAngleDiffDeg(t.angleDeg, sweep);
      const tolDeg = halfBeam + (t.sizeM / DETECTION_RANGE_M) * 10;
      if (Math.abs(diff) > tolDeg) return t;

      const relRad = degToRad(diff);
      const af = computeArrayFactor(nElem, dOverLambda, relRad, weights);
      const rangeTerm = 1 / Math.max(0.25, t.distanceM * t.distanceM);
      const score = af * rangeTerm;
      if (score > 0.015) {
        if (!bestHit || score > bestHit.score) bestHit = { id: t.id, score, diff };
        const tr = trackRef.current;
        if (isTracking && tr.targetId === t.id) {
          tr.minHitDiffDeg = Math.min(tr.minHitDiffDeg, diff);
          tr.maxHitDiffDeg = Math.max(tr.maxHitDiffDeg, diff);
        }
        return { ...t, lastHitMs: now };
      }
      return t;
    }));

    // If searching and we got a hit, immediately go to narrow tracking for size estimation.
    if (!isTracking && bestHit) {
      setScanMode("track");
      setTrackTargetId(bestHit.id);
      trackRef.current = {
        targetId: bestHit.id,
        startedMs: now,
        endMs: now + 1200,
        sweepDir: 1,
        minHitDiffDeg: 999,
        maxHitDiffDeg: -999,
      };
    }
  }, [
    scanAngleDeg,
    params.numElements,
    params.spacing,
    params.apodizationEnabled,
    params.windowType,
    placedTargets.length,
    scanMode,
    trackTargetId,
    effectiveSearchBeamWidth,
    effectiveTrackBeamWidth,
    DETECTION_RANGE_M,
    wrapAngleDiffDeg,
  ]);

  const handleRadarCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radiusPx = canvas.width / 2 - 20;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const dx = x - cx;
    const dy = y - cy;
    const rPx = Math.hypot(dx, dy);
    if (rPx > radiusPx) return;

    // Select existing if clicked close
    const clickedAngle = clampAngleDeg360((Math.atan2(dy, dx) * 180) / Math.PI);
    const clickedDistM = (rPx / radiusPx) * DETECTION_RANGE_M;

    const hitId = (() => {
      for (const t of placedTargets) {
        const ta = degToRad(t.angleDeg);
        const tr = (t.distanceM / DETECTION_RANGE_M) * radiusPx;
        const tx = cx + Math.cos(ta) * tr;
        const ty = cy + Math.sin(ta) * tr;
        const pr = Math.max(3, (t.sizeM / DETECTION_RANGE_M) * radiusPx);
        if (Math.hypot(x - tx, y - ty) <= pr + 6) return t.id;
      }
      return null;
    })();

    if (hitId) {
      setSelectedTargetId(hitId);
      return;
    }

    if (placedTargets.length >= 5) return;
    const id = `U-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const newTarget: PlacedTarget = {
      id,
      angleDeg: clickedAngle,
      distanceM: clickedDistM,
      sizeM: 0.6,
      lastHitMs: 0,
    };
    setPlacedTargets((prev) => [...prev, newTarget]);
    setSelectedTargetId(id);
  }, [placedTargets, DETECTION_RANGE_M]);

  // Distance vs time
  const distTimeData = useMemo(() => 
    radar?.targets?.map((t: RadarTarget, i: number) => ({
      target: `T${i + 1}`,
      distance: t.distanceM,
      time: parseFloat(((2 * t.distanceM) / 3e8 * 1e6).toFixed(4)),
    })) ?? [],
    [radar?.targets]
  );

  // Angle detection data
  const angleDetData = useMemo(() => {
    if (!radar?.angles?.length) return [];
    const data = [];
    for (let i = 0; i < radar.angles.length; i += 3) {
      data.push({
        angle: radar.angles[i],
        return: parseFloat(((radar.magnitudes?.[i] ?? 0) || 0).toFixed(4)),
      });
    }
    return data;
  }, [radar?.angles, radar?.magnitudes]);

  // Beam width effect: multiple beam widths
  const beamWidthData = useMemo(() => {
    const beamWidths = [5, 10, 20];
    return Array.from({ length: 61 }, (_, i) => {
      const angle = i - 30;
      const entry: Record<string, number | string> = { angle };
      beamWidths.forEach((bw) => {
        entry[`bw${bw}`] = parseFloat(Math.exp(-(angle * angle) / (2 * (bw / 2.35) * (bw / 2.35))).toFixed(4));
      });
      return entry;
    });
  }, []);

  const extraControls = (
    <>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Scenario</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">{scenario}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
            onClick={() => {
              setScenario("quick");
              setBeamWidth(22);
              setScanSpeed(16);
            }}
          >
            Quick
          </button>
          <button
            type="button"
            className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
            onClick={() => {
              setScenario("precision");
              setBeamWidth(4);
              setScanSpeed(3);
            }}
          >
            Precision
          </button>
          <button
            type="button"
            className="h-8 text-[10px] font-mono uppercase tracking-wider rounded-md border border-white/15 bg-white/5 hover:bg-white/10"
            onClick={() => {
              setScenario("multi");
              setBeamWidth(14);
              setScanSpeed(10);
              const base = performance.now();
              const preset: PlacedTarget[] = [
                { id: `P1-${base}`, angleDeg: 20,  distanceM: 2.2, sizeM: 0.45, lastHitMs: 0 },
                { id: `P2-${base}`, angleDeg: 75,  distanceM: 5.5, sizeM: 0.70, lastHitMs: 0 },
                { id: `P3-${base}`, angleDeg: 140, distanceM: 7.8, sizeM: 0.55, lastHitMs: 0 },
                { id: `P4-${base}`, angleDeg: 230, distanceM: 3.8, sizeM: 0.85, lastHitMs: 0 },
                { id: `P5-${base}`, angleDeg: 310, distanceM: 9.2, sizeM: 0.60, lastHitMs: 0 },
              ];
              setPlacedTargets(preset);
              setSelectedTargetId(preset[0].id);
            }}
          >
            Multi
          </button>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          Presets set scan + beam. Multi also places 5 targets.
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Search Beam Width</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {beamWidth}° (track → {Math.max(1.5, beamWidth * 0.25).toFixed(1)}°)
          </span>
        </div>
        <Slider value={[beamWidth]} min={2} max={30} step={1} onValueChange={([v]) => setBeamWidth(v)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Search Scan Speed</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {scanSpeed}°/s (track → {Math.max(0.5, scanSpeed * (Math.max(1.5, beamWidth * 0.25) / Math.max(2, beamWidth))).toFixed(1)}°/s)
          </span>
        </div>
        <Slider value={[scanSpeed]} min={1} max={20} step={1} onValueChange={([v]) => setScanSpeed(v)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Targets</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">{placedTargets.length}/5</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground">
          Click inside circle to place. Click a target to select.
        </div>
      </div>
      {selectedTargetId && (() => {
        const t = placedTargets.find((x) => x.id === selectedTargetId);
        if (!t) return null;
        return (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Target Size</Label>
              <span className="text-xs font-mono text-foreground tabular-nums">{t.sizeM.toFixed(2)} m</span>
            </div>
            <Slider
              value={[t.sizeM]}
              min={0.2}
              max={2.0}
              step={0.05}
              onValueChange={([v]) => setPlacedTargets((prev) => prev.map((p) => p.id === t.id ? { ...p, sizeM: v } : p))}
            />
          </div>
        );
      })()}
    </>
  );

  if (error && isInitialLoadRef.current) {
    return (
      <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  return (
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} extra={extraControls} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        {/* Radar Scan */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Radar Scan (Rotating Beam + Objects)</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas
              ref={radarCanvasRef}
              onClick={handleRadarCanvasClick}
              className={`radar-canvas rounded-lg max-w-full max-h-full cursor-crosshair ${isInitialLoadRef.current ? 'loading' : 'ready'}`}
            />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* Distance vs Time */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Distance vs Time (Round-Trip)</h3>
          <div className="flex-1 min-h-0">
            {isInitialLoadRef.current ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distTimeData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                  <XAxis dataKey="target" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                  <YAxis tick={{ fontSize: 9 }}
                    label={{ value: "Distance", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                  <Bar dataKey="distance" radius={[6, 6, 0, 0]}>
                    {distTimeData.map((_, i) => (
                      <Cell key={i} fill={`hsl(${270 + i * 15},70%,${50 + i * 5}%)`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Angle Detection */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Angle Detection (Return Intensity)</h3>
          <div className="flex-1 min-h-0">
            {isInitialLoadRef.current ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={angleDetData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                  <XAxis dataKey="angle" tick={{ fontSize: 9 }}
                    label={{ value: "Angle (°)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                  <Line type="monotone" dataKey="return" stroke="hsl(270,70%,50%)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Beam Width Effect */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Beam Width Effect Comparison</h3>
          <div className="flex-1 min-h-0">
            {isInitialLoadRef.current ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={beamWidthData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                  <XAxis dataKey="angle" tick={{ fontSize: 9 }}
                    label={{ value: "Angle (°)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                  <Line type="monotone" dataKey="bw5" stroke="hsl(270,70%,55%)" strokeWidth={1.5} dot={false} name="5°" />
                  <Line type="monotone" dataKey="bw10" stroke="hsl(290,60%,55%)" strokeWidth={1.5} dot={false} name="10°" />
                  <Line type="monotone" dataKey="bw20" stroke="hsl(320,70%,60%)" strokeWidth={1.5} dot={false} name="20°" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

import { useMemo, useRef, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams, PhantomEllipse } from "@/types/beamforming";
import { useUltrasoundSimulatorAPI, SimulatorUltrasoundResponse } from "@/hooks/useUltrasoundSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import "./SimulatorUltrasound.css";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

type UltrasoundUIParams = BeamformingParams & {
  wavelength: number;
  noiseEnabled?: boolean;
  apodizationEnabled?: boolean;
  maxDepthMm: number;
  numSamples: number;
  enableSpeckle: boolean;
  runDoppler: boolean;
  targetDepthMm: number;
  phantomRegions?: PhantomEllipse[];
};

type HoverState = {
  regionIndex: number;
  x: number;
  y: number;
};

type EditableNumericField =
  | "acousticImpedanceMrayl"
  | "attenuationDbCmMhz"
  | "backscatterCoeff"
  | "speedOfSoundMps"
  | "scatterDensity"
  | "boundaryRoughness";

type VesselState = {
  x0: number;
  y0: number;
  a: number;
  b: number;
};

const AUTO_SCAN_STEP_RAD = 0.015;
const TOTAL_SCAN_POSITIONS = Math.floor((Math.PI * 2) / AUTO_SCAN_STEP_RAD) + 1;

const BEAM_FIELD_SIZE = 300;
const BMODE_DISPLAY_WIDTH = 360;
const BMODE_DISPLAY_HEIGHT = 260;
const BMODE_SECTOR_HALF_ANGLE_RAD = (35 * Math.PI) / 180;

const getBeamFieldWindowWeights = (windowType: string, numElements: number) => {
  if (numElements <= 1) return [1];

  const weights: number[] = [];
  const denom = numElements - 1;

  for (let n = 0; n < numElements; n += 1) {
    const base = (2 * Math.PI * n) / denom;
    let w = 1;

    if (windowType === "hamming") {
      w = 0.54 - 0.46 * Math.cos(base);
    } else if (windowType === "hanning") {
      w = 0.5 * (1 - Math.cos(base));
    } else if (windowType === "blackman") {
      w = 0.42 - 0.5 * Math.cos(base) + 0.08 * Math.cos(2 * base);
    }

    weights.push(w);
  }

  return weights;
};

const defaultParams: UltrasoundUIParams = {
  numElements: 64,
  spacing: 0.3,
  wavelength: 1.0,
  frequency: 5e6,
  steeringAngleDeg: 0,
  amplitude: 1.0,
  snrDb: 25,
  windowType: "rectangular",
  noiseEnabled: true,
  enableNoise: true,
  apodizationEnabled: false,
  maxDepthMm: 100,
  numSamples: 512,
  enableSpeckle: true,
  runDoppler: false,
  targetDepthMm: 50,
};

export default function SimulatorUltrasound() {
  const [params, setParams] = useState<UltrasoundUIParams>(defaultParams);
  const debouncedParams = useDebounce(params, 300);
  const [result, setResult] = useState<SimulatorUltrasoundResponse | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<HoverState | null>(null);
  const [selectedRegionIndex, setSelectedRegionIndex] = useState<number | null>(null);
  const [editorDraft, setEditorDraft] = useState<PhantomEllipse | null>(null);
  const [probeParamRad, setProbeParamRad] = useState(Math.PI / 2);
  const debouncedProbeParamRad = useDebounce(probeParamRad, 80);
  const [isDraggingProbe, setIsDraggingProbe] = useState(false);
  const [autoScanActive, setAutoScanActive] = useState(false);
  const [autoScanProgress, setAutoScanProgress] = useState(0);
  const [latestColumnProbeParamRad, setLatestColumnProbeParamRad] = useState(Math.PI / 2);
  const [vessel, setVessel] = useState<VesselState>({ x0: 0.18, y0: -0.15, a: 0.18, b: 0.06 });
  const [isDraggingVessel, setIsDraggingVessel] = useState(false);
  const [bloodVelocityCms, setBloodVelocityCms] = useState(24);
  const [flowAngleDeg, setFlowAngleDeg] = useState(20);
  const isInitialLoadRef = useRef(true);
  const wasAutoScanActiveRef = useRef(false);
  const preserveAutoScanResultRef = useRef<{ paramsKey: string; probeParamRad: number } | null>(null);
  const lastIdleInputRef = useRef<{ params: UltrasoundUIParams; probeParamRad: number } | null>(null);
  const draggedProbeRef = useRef(false);
  const draggedVesselRef = useRef(false);
  const autoScanStartParamRef = useRef<number>(0);
  const autoScanParamsRef = useRef<UltrasoundUIParams | null>(null);
  const bmodeBufferRef = useRef<Uint8ClampedArray | null>(null);
  const bmodeAmplitudeBufferRef = useRef<Float32Array | null>(null);
  const bmodeGlobalMaxAmplitudeRef = useRef(0);
  const bmodeWidthRef = useRef(TOTAL_SCAN_POSITIONS);
  const bmodeHeightRef = useRef(Math.max(defaultParams.numSamples, 1));
  const vesselDragOffsetRef = useRef({ dx: 0, dy: 0 });

  const { simulate, error } = useUltrasoundSimulatorAPI();
  const phantomRef = useRef<HTMLCanvasElement>(null);
  const bmodeRef = useRef<HTMLCanvasElement>(null);
  const beamFieldRef = useRef<HTMLCanvasElement>(null);

  const us = useMemo(() => {
    if (!result?.data?.bmode) return null;

    return {
      depths: result.data.bmode.depthsMm || [],
      amplitudes: result.data.bmode.amplitudes || [],
      amplitudesDb: result.data.bmode.amplitudesDb || [],
      reflections: result.data.bmode.reflections || [],
      metrics: result.data.bmode.metrics || {},
      phantom: result.data.bmode.phantom,
    };
  }, [result]);

  const phantomRegions = useMemo(
    () => params.phantomRegions ?? us?.phantom?.ellipses ?? [],
    [params.phantomRegions, us?.phantom?.ellipses]
  );

  const outerBoundary = useMemo(() => {
    if (!phantomRegions.length) return null;

    const region = phantomRegions.reduce((largest, current) => {
      const largestArea = largest.a * largest.b;
      const currentArea = current.a * current.b;
      return currentArea > largestArea ? current : largest;
    }, phantomRegions[0]);

    const phiRad = (region.phiDeg * Math.PI) / 180;
    return {
      ...region,
      phiRad,
      cosPhi: Math.cos(phiRad),
      sinPhi: Math.sin(phiRad),
    };
  }, [phantomRegions]);

  const computeProbePose = (paramRad: number) => {
    if (!outerBoundary) return null;

    const localX = outerBoundary.a * Math.cos(paramRad);
    const localY = outerBoundary.b * Math.sin(paramRad);

    const xNorm = outerBoundary.x0 + localX * outerBoundary.cosPhi - localY * outerBoundary.sinPhi;
    const yNorm = outerBoundary.y0 + localX * outerBoundary.sinPhi + localY * outerBoundary.cosPhi;

    const normalLocalX = Math.cos(paramRad) / Math.max(outerBoundary.a, 1e-9);
    const normalLocalY = Math.sin(paramRad) / Math.max(outerBoundary.b, 1e-9);
    const normalGlobalX = normalLocalX * outerBoundary.cosPhi - normalLocalY * outerBoundary.sinPhi;
    const normalGlobalY = normalLocalX * outerBoundary.sinPhi + normalLocalY * outerBoundary.cosPhi;
    const normalMag = Math.hypot(normalGlobalX, normalGlobalY) || 1;

    const outwardX = normalGlobalX / normalMag;
    const outwardY = normalGlobalY / normalMag;

    return {
      xNorm,
      yNorm,
      inwardX: -outwardX,
      inwardY: -outwardY,
      outwardX,
      outwardY,
    };
  };

  const projectPointToBoundaryParam = (xNorm: number, yNorm: number): number | null => {
    if (!outerBoundary) return null;

    const dx = xNorm - outerBoundary.x0;
    const dy = yNorm - outerBoundary.y0;
    const localX = dx * outerBoundary.cosPhi + dy * outerBoundary.sinPhi;
    const localY = -dx * outerBoundary.sinPhi + dy * outerBoundary.cosPhi;

    return Math.atan2(
      localY / Math.max(outerBoundary.b, 1e-9),
      localX / Math.max(outerBoundary.a, 1e-9)
    );
  };

  const isPointInEllipse = (xNorm: number, yNorm: number, ellipse: { x0: number; y0: number; a: number; b: number; phiDeg?: number }) => {
    const phi = ((ellipse.phiDeg ?? 0) * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = xNorm - ellipse.x0;
    const dy = yNorm - ellipse.y0;
    const xRot = dx * cosPhi + dy * sinPhi;
    const yRot = -dx * sinPhi + dy * cosPhi;
    const norm = (xRot * xRot) / Math.max(ellipse.a * ellipse.a, 1e-9) + (yRot * yRot) / Math.max(ellipse.b * ellipse.b, 1e-9);
    return norm <= 1;
  };

  const isPointInsideOuterBoundary = (xNorm: number, yNorm: number) => {
    if (!outerBoundary) return false;
    return isPointInEllipse(xNorm, yNorm, outerBoundary);
  };

  const doesRayIntersectVessel = (
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    vesselShape: VesselState
  ) => {
    const ox = originX - vesselShape.x0;
    const oy = originY - vesselShape.y0;
    const dx = dirX;
    const dy = dirY;

    const aCoeff = (dx * dx) / Math.max(vesselShape.a * vesselShape.a, 1e-9) + (dy * dy) / Math.max(vesselShape.b * vesselShape.b, 1e-9);
    const bCoeff = 2 * ((ox * dx) / Math.max(vesselShape.a * vesselShape.a, 1e-9) + (oy * dy) / Math.max(vesselShape.b * vesselShape.b, 1e-9));
    const cCoeff = (ox * ox) / Math.max(vesselShape.a * vesselShape.a, 1e-9) + (oy * oy) / Math.max(vesselShape.b * vesselShape.b, 1e-9) - 1;

    const disc = bCoeff * bCoeff - 4 * aCoeff * cCoeff;
    if (disc < 0) return false;

    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-bCoeff - sqrtDisc) / Math.max(2 * aCoeff, 1e-9);
    const t2 = (-bCoeff + sqrtDisc) / Math.max(2 * aCoeff, 1e-9);
    return t1 >= 0 || t2 >= 0;
  };

  const hoveredRegionData = hoveredRegion ? phantomRegions[hoveredRegion.regionIndex] : null;

  useEffect(() => {
    if (!us?.phantom?.ellipses?.length) return;

    setParams((prev) => {
      if (prev.phantomRegions?.length) {
        return prev;
      }

      return {
        ...prev,
        phantomRegions: us.phantom?.ellipses.map((ellipse) => ({ ...ellipse })) ?? [],
      };
    });
  }, [us?.phantom]);

  useEffect(() => {
    const justFinishedAutoScan = wasAutoScanActiveRef.current && !autoScanActive;
    wasAutoScanActiveRef.current = autoScanActive;

    if (justFinishedAutoScan) return;
    if (autoScanActive) return;

    const preserved = preserveAutoScanResultRef.current;
    if (preserved) {
      const currentParamsKey = JSON.stringify(debouncedParams);
      const twoPi = Math.PI * 2;
      const normalize = (a: number) => ((a % twoPi) + twoPi) % twoPi;
      const sameProbeDebounced = Math.abs(normalize(debouncedProbeParamRad) - normalize(preserved.probeParamRad)) < 1e-6;
      const sameProbeCurrent = Math.abs(normalize(probeParamRad) - normalize(preserved.probeParamRad)) < 1e-6;

      if (currentParamsKey === preserved.paramsKey && (sameProbeDebounced || sameProbeCurrent)) {
        return;
      }

      preserveAutoScanResultRef.current = null;
    }

    let isMounted = true;

    const runSim = async () => {
      const simulationParams = {
        ...debouncedParams,
        frequency: 5e6 / Math.max(debouncedParams.wavelength, 0.1),
        enableNoise: debouncedParams.noiseEnabled ?? debouncedParams.enableNoise ?? true,
        probeParamRad: debouncedProbeParamRad,
      };

      const res = await simulate(simulationParams, isInitialLoadRef.current);
      if (isMounted && res?.success) {
        setResult(res);
        setLatestColumnProbeParamRad(debouncedProbeParamRad);
        lastIdleInputRef.current = {
          params: { ...debouncedParams },
          probeParamRad: debouncedProbeParamRad,
        };
        isInitialLoadRef.current = false;
      }
    };

    runSim();
    return () => {
      isMounted = false;
    };
  }, [autoScanActive, debouncedParams, debouncedProbeParamRad, probeParamRad, simulate]);

  const updateParam = <K extends keyof UltrasoundUIParams>(key: K, value: UltrasoundUIParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const updateDraftNumericField = (field: EditableNumericField, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;

    setEditorDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: parsed,
      };
    });
  };

  const findRegionAtNormalizedPoint = (xNorm: number, yNorm: number): number | null => {
    for (let i = phantomRegions.length - 1; i >= 0; i -= 1) {
      const ellipse = phantomRegions[i];
      const phi = (ellipse.phiDeg * Math.PI) / 180;
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const dx = xNorm - ellipse.x0;
      const dy = yNorm - ellipse.y0;
      const xRot = dx * cosPhi + dy * sinPhi;
      const yRot = -dx * sinPhi + dy * cosPhi;

      const a2 = ellipse.a * ellipse.a;
      const b2 = ellipse.b * ellipse.b;
      const norm = (xRot * xRot) / Math.max(a2, 1e-9) + (yRot * yRot) / Math.max(b2, 1e-9);

      if (norm <= 1) {
        return i;
      }
    }

    return null;
  };

  const beginRegionEdit = (regionIndex: number) => {
    const region = phantomRegions[regionIndex];
    if (!region) return;

    setSelectedRegionIndex(regionIndex);
    setEditorDraft({ ...region });
  };

  const closeRegionEditor = () => {
    setSelectedRegionIndex(null);
    setEditorDraft(null);
  };

  const applyRegionEdit = () => {
    if (selectedRegionIndex === null || !editorDraft) return;

    setParams((prev) => {
      const source = prev.phantomRegions ?? phantomRegions;
      const nextRegions = source.map((region, index) => (
        index === selectedRegionIndex ? { ...editorDraft } : { ...region }
      ));

      return {
        ...prev,
        phantomRegions: nextRegions,
      };
    });

    closeRegionEditor();
  };

  const aData = useMemo(
    () =>
      us?.depths
        .filter((_: number, i: number) => i % 2 === 0)
        .map((d: number, i: number) => ({
          depth: parseFloat(d.toFixed(2)),
          amplitude: parseFloat((us?.amplitudes[i * 2] || 0).toFixed(4)),
        })) ?? [],
    [us?.depths, us?.amplitudes]
  );

  const dopplerState = useMemo(() => {
    const pose = computeProbePose(probeParamRad);
    if (!pose) {
      return { intersects: false, fdHz: 0, dirX: 0, dirY: -1 };
    }

    const steerRad = ((params.steeringAngleDeg ?? 0) * Math.PI) / 180;
    const dirX = pose.inwardX * Math.cos(steerRad) - pose.inwardY * Math.sin(steerRad);
    const dirY = pose.inwardX * Math.sin(steerRad) + pose.inwardY * Math.cos(steerRad);

    const intersects = doesRayIntersectVessel(pose.xNorm, pose.yNorm, dirX, dirY, vessel);
    if (!intersects) {
      return { intersects: false, fdHz: 0, dirX, dirY };
    }

    const vMs = bloodVelocityCms / 100;
    const f0Hz = 5e6 / Math.max(params.wavelength, 0.1);
    const c = 1540;
    const beamAngle = Math.atan2(dirY, dirX);
    const flowRad = (flowAngleDeg * Math.PI) / 180;
    const theta = flowRad - beamAngle;
    const fdHz = (2 * vMs * Math.cos(theta) * f0Hz) / c;

    return { intersects: true, fdHz, dirX, dirY };
  }, [bloodVelocityCms, flowAngleDeg, params.steeringAngleDeg, params.wavelength, probeParamRad, vessel]);

  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = (canvas.width = 360);
    const h = (canvas.height = 360);

    ctx.fillStyle = "hsl(240,10%,10%)";
    ctx.fillRect(0, 0, w, h);

    if (phantomRegions.length) {
      const imageData = ctx.createImageData(w, h);
      const rgba = imageData.data;
      const ellipses = phantomRegions.map((ellipse) => {
        const phi = (ellipse.phiDeg * Math.PI) / 180;
        return {
          ...ellipse,
          cosPhi: Math.cos(phi),
          sinPhi: Math.sin(phi),
          a2: ellipse.a * ellipse.a,
          b2: ellipse.b * ellipse.b,
        };
      });

      for (let py = 0; py < h; py += 1) {
        const yNorm = 1 - ((py + 0.5) / h) * 2;

        for (let px = 0; px < w; px += 1) {
          const xNorm = ((px + 0.5) / w) * 2 - 1;
          let intensity = 0;

          for (const ellipse of ellipses) {
            const dx = xNorm - ellipse.x0;
            const dy = yNorm - ellipse.y0;
            const xRot = dx * ellipse.cosPhi + dy * ellipse.sinPhi;
            const yRot = -dx * ellipse.sinPhi + dy * ellipse.cosPhi;

            const norm = (xRot * xRot) / ellipse.a2 + (yRot * yRot) / ellipse.b2;
            if (norm <= 1) {
              intensity += ellipse.intensity;
            }
          }

          const clamped = Math.max(0, Math.min(1, intensity));
          const gammaCorrected = Math.pow(clamped, 0.95);
          const gray = Math.round(gammaCorrected * 255);
          const idx = (py * w + px) * 4;

          rgba[idx] = gray;
          rgba[idx + 1] = gray;
          rgba[idx + 2] = gray;
          rgba[idx + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      const drawRegionOutline = (regionIndex: number, strokeStyle: string, lineWidth: number) => {
        const region = phantomRegions[regionIndex];
        if (!region) return;

        const centerX = ((region.x0 + 1) / 2) * w;
        const centerY = ((1 - region.y0) / 2) * h;
        const radiusX = Math.max(1, (region.a / 2) * w);
        const radiusY = Math.max(1, (region.b / 2) * h);
        const rotation = -((region.phiDeg * Math.PI) / 180);

        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, rotation, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };

      if (hoveredRegion) {
        drawRegionOutline(hoveredRegion.regionIndex, "hsla(185, 90%, 65%, 0.9)", 2);
      }

      if (selectedRegionIndex !== null) {
        drawRegionOutline(selectedRegionIndex, "hsla(30, 100%, 65%, 0.95)", 2.5);
      }
    } else {
      ctx.fillStyle = "hsl(240,8%,60%)";
      ctx.font = "11px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText("Phantom data unavailable", w / 2, h / 2);
    }

    ctx.strokeStyle = "hsla(290,70%,65%,0.18)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const vesselX = ((vessel.x0 + 1) / 2) * w;
    const vesselY = ((1 - vessel.y0) / 2) * h;
    const vesselRx = Math.max(2, (vessel.a / 2) * w);
    const vesselRy = Math.max(2, (vessel.b / 2) * h);

    ctx.save();
    ctx.fillStyle = dopplerState.intersects ? "hsla(0, 90%, 56%, 0.30)" : "hsla(200, 80%, 52%, 0.26)";
    ctx.strokeStyle = dopplerState.intersects ? "hsla(0, 95%, 62%, 0.95)" : "hsla(200, 82%, 60%, 0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(vesselX, vesselY, vesselRx, vesselRy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const flowRad = (flowAngleDeg * Math.PI) / 180;
    const flowHalf = vesselRx * 0.8;
    ctx.strokeStyle = "hsla(10, 95%, 72%, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(vesselX - Math.cos(flowRad) * flowHalf, vesselY + Math.sin(flowRad) * flowHalf);
    ctx.lineTo(vesselX + Math.cos(flowRad) * flowHalf, vesselY - Math.sin(flowRad) * flowHalf);
    ctx.stroke();
    ctx.restore();

    const probePose = computeProbePose(probeParamRad);
    if (probePose) {
      const steerRad = ((params.steeringAngleDeg ?? 0) * Math.PI) / 180;

      const probeX = ((probePose.xNorm + 1) / 2) * w;
      const probeY = ((1 - probePose.yNorm) / 2) * h;

      const dirX = probePose.inwardX * Math.cos(steerRad) - probePose.inwardY * Math.sin(steerRad);
      const dirY = probePose.inwardX * Math.sin(steerRad) + probePose.inwardY * Math.cos(steerRad);
      const beamLengthNorm = 1.8;

      const beamEndNormX = probePose.xNorm + dirX * beamLengthNorm;
      const beamEndNormY = probePose.yNorm + dirY * beamLengthNorm;
      const beamEndX = ((beamEndNormX + 1) / 2) * w;
      const beamEndY = ((1 - beamEndNormY) / 2) * h;

      const grad = ctx.createLinearGradient(probeX, probeY, beamEndX, beamEndY);
      grad.addColorStop(0, "hsla(270,85%,62%,0.60)");
      grad.addColorStop(1, "hsla(320,90%,62%,0.06)");

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = grad;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(probeX, probeY);
      ctx.lineTo(beamEndX, beamEndY);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "hsl(270,65%,52%)";
      ctx.beginPath();
      ctx.arc(probeX, probeY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "hsl(270,65%,72%)";
      ctx.stroke();

      const labelX = probeX + probePose.outwardX * 18;
      const labelY = probeY - probePose.outwardY * 18;
      ctx.fillStyle = "hsl(270,60%,80%)";
      ctx.font = "9px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText("PROBE", labelX, labelY);
      ctx.restore();
    }
  }, [dopplerState.intersects, flowAngleDeg, hoveredRegion, params.steeringAngleDeg, phantomRegions, probeParamRad, selectedRegionIndex, vessel]);

  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas) return;

    const toCanvasCoords = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const canvasX = (localX * canvas.width) / Math.max(rect.width, 1);
      const canvasY = (localY * canvas.height) / Math.max(rect.height, 1);
      const xNorm = ((canvasX + 0.5) / canvas.width) * 2 - 1;
      const yNorm = 1 - ((canvasY + 0.5) / canvas.height) * 2;

      return { rect, localX, localY, canvasX, canvasY, xNorm, yNorm };
    };

    const isNearCurrentProbe = (canvasX: number, canvasY: number) => {
      const probePose = computeProbePose(probeParamRad);
      if (!probePose) return false;

      const probeCanvasX = ((probePose.xNorm + 1) / 2) * canvas.width;
      const probeCanvasY = ((1 - probePose.yNorm) / 2) * canvas.height;
      const dist = Math.hypot(canvasX - probeCanvasX, canvasY - probeCanvasY);

      return dist <= 14;
    };

    const handlePointerDown = (event: MouseEvent) => {
      const { canvasX, canvasY, xNorm, yNorm } = toCanvasCoords(event);

      if (isNearCurrentProbe(canvasX, canvasY)) {
        const projectedParam = projectPointToBoundaryParam(xNorm, yNorm);
        if (projectedParam !== null) {
          setProbeParamRad(projectedParam);
        }

        draggedProbeRef.current = false;
        setIsDraggingProbe(true);
        setHoveredRegion(null);
        event.preventDefault();
        return;
      }

      if (isPointInEllipse(xNorm, yNorm, vessel)) {
        vesselDragOffsetRef.current = { dx: xNorm - vessel.x0, dy: yNorm - vessel.y0 };
        draggedVesselRef.current = false;
        setIsDraggingVessel(true);
        setHoveredRegion(null);
        event.preventDefault();
      }
    };

    const handlePointerMove = (event: MouseEvent) => {
      const { rect, localX, localY, xNorm, yNorm } = toCanvasCoords(event);

      if (isDraggingProbe) {
        const projectedParam = projectPointToBoundaryParam(xNorm, yNorm);
        if (projectedParam !== null) {
          setProbeParamRad(projectedParam);
          draggedProbeRef.current = true;
          setHoveredRegion(null);
        }
        return;
      }

      if (isDraggingVessel) {
        const nextX = xNorm - vesselDragOffsetRef.current.dx;
        const nextY = yNorm - vesselDragOffsetRef.current.dy;

        if (isPointInsideOuterBoundary(nextX, nextY)) {
          setVessel((prev) => ({ ...prev, x0: nextX, y0: nextY }));
          draggedVesselRef.current = true;
          setHoveredRegion(null);
        }
        return;
      }

      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
        setHoveredRegion(null);
        return;
      }

      const regionIndex = findRegionAtNormalizedPoint(xNorm, yNorm);

      if (regionIndex === null) {
        setHoveredRegion(null);
        return;
      }

      setHoveredRegion({
        regionIndex,
        x: localX,
        y: localY,
      });
    };

    const handlePointerLeave = () => {
      if (isDraggingProbe || isDraggingVessel) return;
      setHoveredRegion(null);
    };

    const handlePointerUp = () => {
      if (isDraggingProbe) {
        setIsDraggingProbe(false);
      }
      if (isDraggingVessel) {
        setIsDraggingVessel(false);
      }
    };

    const handleClick = (event: MouseEvent) => {
      const { canvasX, canvasY, xNorm, yNorm } = toCanvasCoords(event);

      if (draggedProbeRef.current || isNearCurrentProbe(canvasX, canvasY)) {
        draggedProbeRef.current = false;
        return;
      }

      if (draggedVesselRef.current || isPointInEllipse(xNorm, yNorm, vessel)) {
        draggedVesselRef.current = false;
        return;
      }

      const regionIndex = findRegionAtNormalizedPoint(xNorm, yNorm);

      if (regionIndex !== null) {
        beginRegionEdit(regionIndex);
      }
    };

    canvas.addEventListener("mousedown", handlePointerDown);
    canvas.addEventListener("mousemove", handlePointerMove);
    canvas.addEventListener("mouseleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      canvas.removeEventListener("mousedown", handlePointerDown);
      canvas.removeEventListener("mousemove", handlePointerMove);
      canvas.removeEventListener("mouseleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [isDraggingProbe, isDraggingVessel, outerBoundary, phantomRegions, probeParamRad, vessel]);

  const redrawBmodeBuffer = () => {
    const canvas = bmodeRef.current;
    const buffer = bmodeBufferRef.current;
    if (!canvas || !buffer) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sourceWidth = bmodeWidthRef.current;
    const sourceHeight = bmodeHeightRef.current;
    const displayWidth = BMODE_DISPLAY_WIDTH;
    const displayHeight = BMODE_DISPLAY_HEIGHT;

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    const image = ctx.createImageData(displayWidth, displayHeight);
    const centerX = displayWidth / 2;
    const apexY = Math.round(displayHeight * 0.02);
    const nearDepthPx = Math.max(4, Math.round(displayHeight * 0.06));
    const depthSpanPx = Math.max(1, Math.round(displayHeight * 0.9));

    for (let py = 0; py < displayHeight; py += 1) {
      const yFromApex = py - apexY;
      const depthNorm = (yFromApex - nearDepthPx) / depthSpanPx;

      for (let px = 0; px < displayWidth; px += 1) {
        const pixelIdx = (py * displayWidth + px) * 4;
        let intensity = 0;

        if (depthNorm >= 0 && depthNorm <= 1) {
          const depthPx = nearDepthPx + depthNorm * depthSpanPx;
          const lateralLimit = Math.tan(BMODE_SECTOR_HALF_ANGLE_RAD) * depthPx;
          const dx = px - centerX;

          if (Math.abs(dx) <= lateralLimit && lateralLimit > 1e-6) {
            const theta = (dx / lateralLimit) * BMODE_SECTOR_HALF_ANGLE_RAD;
            const scanNorm = (theta + BMODE_SECTOR_HALF_ANGLE_RAD) / (2 * BMODE_SECTOR_HALF_ANGLE_RAD);
            const sourceX = Math.max(0, Math.min(sourceWidth - 1, Math.round(scanNorm * (sourceWidth - 1))));
            const sourceY = Math.max(0, Math.min(sourceHeight - 1, Math.round(depthNorm * (sourceHeight - 1))));
            const sourceIdx = (sourceY * sourceWidth + sourceX) * 4;

            const raw = buffer[sourceIdx] ?? 0;
            const edgeTaper = Math.pow(Math.max(0, 1 - Math.abs(dx) / Math.max(lateralLimit, 1)), 0.8);
            const depthGain = 0.55 + 0.9 * depthNorm;

            intensity = raw * edgeTaper * depthGain;
          }
        }

        const clamped = Math.max(0, Math.min(255, Math.round(intensity)));
        const visible = clamped < 30 ? 0 : clamped;
        image.data[pixelIdx] = Math.round(visible * 0.92);
        image.data[pixelIdx + 1] = Math.round(visible * 0.96);
        image.data[pixelIdx + 2] = visible;
        image.data[pixelIdx + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);

    ctx.save();
    ctx.strokeStyle = "hsla(192, 85%, 65%, 0.16)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i += 1) {
      const y = apexY + nearDepthPx + (i / 6) * depthSpanPx;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(displayWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  };

  const getAmplitudePercentile = (buffer: Float32Array, percentile: number) => {
    const values: number[] = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const value = buffer[i];
      if (value > 0) {
        values.push(value);
      }
    }

    if (!values.length) return 0;
    values.sort((a, b) => a - b);

    const p = Math.max(0, Math.min(100, percentile));
    const idx = Math.min(values.length - 1, Math.max(0, Math.floor((p / 100) * (values.length - 1))));
    return values[idx];
  };

  const toLogCompressedPixel = (amplitude: number, maxAmplitude: number) => {
    if (amplitude <= 0 || maxAmplitude <= 0) return 0;
    const normalized = Math.max(0, Math.min(1, amplitude / maxAmplitude));
    const gammaCorrected = Math.pow(normalized, 0.35);
    return Math.max(0, Math.min(255, Math.round(255 * gammaCorrected)));
  };

  const renormalizeBmodeImage = () => {
    const buffer = bmodeBufferRef.current;
    const amplitudeBuffer = bmodeAmplitudeBufferRef.current;
    if (!buffer || !amplitudeBuffer) return;

    const filteredAmplitudeValues = Array.from(amplitudeBuffer).filter((value) => value >= 0.001);
    const normalizationCeiling = filteredAmplitudeValues.length
      ? getAmplitudePercentile(new Float32Array(filteredAmplitudeValues), 99.5)
      : 0;

    for (let i = 0; i < amplitudeBuffer.length; i += 1) {
      const amplitude = Math.max(0, Math.min(amplitudeBuffer[i], normalizationCeiling));
      const normalized = normalizationCeiling > 0
        ? Math.max(0, Math.min(1, Math.log1p(amplitude) / Math.log1p(normalizationCeiling)))
        : 0;
      const gammaCorrected = Math.pow(normalized, 0.4);
      const mappedPixel = Math.max(0, Math.min(255, Math.round(255 * gammaCorrected)));
      const pixel = mappedPixel < 30 ? 0 : mappedPixel;
      const idx = i * 4;
      buffer[idx] = pixel;
      buffer[idx + 1] = pixel;
      buffer[idx + 2] = pixel;
      buffer[idx + 3] = 255;
    }

    redrawBmodeBuffer();
  };

  const clearBmodeBuffer = (width = bmodeWidthRef.current, height = bmodeHeightRef.current) => {
    bmodeWidthRef.current = Math.max(1, Math.floor(width));
    bmodeHeightRef.current = Math.max(1, Math.floor(height));

    const pixelCount = bmodeWidthRef.current * bmodeHeightRef.current;
    bmodeBufferRef.current = new Uint8ClampedArray(pixelCount * 4);
    bmodeAmplitudeBufferRef.current = new Float32Array(pixelCount);
    bmodeGlobalMaxAmplitudeRef.current = 0;
    const buffer = bmodeBufferRef.current;
    for (let i = 0; i < buffer.length; i += 4) {
      buffer[i] = 0;
      buffer[i + 1] = 0;
      buffer[i + 2] = 0;
      buffer[i + 3] = 255;
    }
    redrawBmodeBuffer();
  };

  const drawBmodeColumnAtScanIndex = (
    scanIndex: number,
    totalScanPositions: number,
    amplitudes: number[],
    drawImmediate = true,
  ) => {
    const buffer = bmodeBufferRef.current;
    const amplitudeBuffer = bmodeAmplitudeBufferRef.current;
    if (!buffer || !amplitudeBuffer || !amplitudes.length) return;

    const width = bmodeWidthRef.current;
    const height = bmodeHeightRef.current;
    const mappedX = totalScanPositions <= 1
      ? 0
      : Math.round((scanIndex / (totalScanPositions - 1)) * (width - 1));
    const x = Math.max(0, Math.min(width - 1, mappedX));

    for (let sampleIdx = 0; sampleIdx < amplitudes.length; sampleIdx += 1) {
      const y = amplitudes.length <= 1
        ? 0
        : Math.round((sampleIdx / (amplitudes.length - 1)) * (height - 1));
      const amplitude = Math.max(0, amplitudes[sampleIdx] ?? 0);
      const ampIdx = y * width + x;

      if (amplitude > amplitudeBuffer[ampIdx]) {
        amplitudeBuffer[ampIdx] = amplitude;
        if (amplitude > bmodeGlobalMaxAmplitudeRef.current) {
          bmodeGlobalMaxAmplitudeRef.current = amplitude;
        }

        if (drawImmediate) {
          const idx = ampIdx * 4;
          const pixel = toLogCompressedPixel(amplitude, bmodeGlobalMaxAmplitudeRef.current);
          buffer[idx] = pixel;
          buffer[idx + 1] = pixel;
          buffer[idx + 2] = pixel;
          buffer[idx + 3] = 255;
        }
      }
    }

    if (drawImmediate) {
      redrawBmodeBuffer();
    }
  };

  useEffect(() => {
    if (!bmodeBufferRef.current) {
      clearBmodeBuffer();
      return;
    }
    redrawBmodeBuffer();
  }, []);

  useEffect(() => {
    if (!us?.amplitudes?.length) return;
    if (autoScanActive) return;
    if (!bmodeBufferRef.current || !bmodeAmplitudeBufferRef.current) {
      clearBmodeBuffer();
    }

    const width = bmodeWidthRef.current;
    const probeCycle = ((latestColumnProbeParamRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const scanIndex = width <= 1 ? 0 : Math.round((probeCycle / (Math.PI * 2)) * (width - 1));
    drawBmodeColumnAtScanIndex(scanIndex, width, us.amplitudes);
  }, [autoScanActive, latestColumnProbeParamRad, us?.amplitudes]);

  useEffect(() => {
    if (!autoScanActive) return;

    let cancelled = false;

    const runSweep = async () => {
      const scanParams = autoScanParamsRef.current ?? params;
      const scanParamsKey = JSON.stringify(scanParams);
      const totalScanPositions = TOTAL_SCAN_POSITIONS;
      const scanHeight = Math.max(scanParams.numSamples, 1);
      const sweepSpan = Math.max(0, Math.PI * 2 - AUTO_SCAN_STEP_RAD);
      let lastSweepParam = autoScanStartParamRef.current;

      clearBmodeBuffer(totalScanPositions, scanHeight);

      for (let scanIndex = 0; scanIndex < totalScanPositions; scanIndex += 1) {
        if (cancelled) return;

        const t = totalScanPositions <= 1 ? 0 : scanIndex / (totalScanPositions - 1);
        const sweepParam = autoScanStartParamRef.current + t * sweepSpan;
        lastSweepParam = sweepParam;
        setProbeParamRad(sweepParam);
        setAutoScanProgress(t);

        const simulationParams = {
          ...scanParams,
          frequency: 5e6 / Math.max(scanParams.wavelength, 0.1),
          enableNoise: scanParams.noiseEnabled ?? scanParams.enableNoise ?? true,
          probeParamRad: sweepParam,
        };

        const res = await simulate(simulationParams, false);
        if (cancelled) return;

        if (res?.success) {
          setResult(res);
          setLatestColumnProbeParamRad(sweepParam);
          drawBmodeColumnAtScanIndex(scanIndex, totalScanPositions, res.data.bmode.amplitudes || [], false);
        }
      }

      if (cancelled) return;
      renormalizeBmodeImage();
      setProbeParamRad(lastSweepParam);
      setLatestColumnProbeParamRad(lastSweepParam);
      preserveAutoScanResultRef.current = {
        paramsKey: scanParamsKey,
        probeParamRad: lastSweepParam,
      };
      setAutoScanProgress(1);
      setAutoScanActive(false);
    };

    runSweep();

    return () => {
      cancelled = true;
    };
  }, [autoScanActive, simulate]);

  useEffect(() => {
    const canvas = beamFieldRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = BEAM_FIELD_SIZE;
    canvas.width = size;
    canvas.height = size;

    const numElements = Math.max(1, Math.floor(params.numElements));
    const steeringRad = ((params.steeringAngleDeg ?? 0) * Math.PI) / 180;
    const dLambda = params.spacing;
    const phaseScale = 2 * Math.PI;
    const xSpan = numElements * dLambda * 1.5;
    const ySpan = numElements * dLambda * 5;

    const weights = getBeamFieldWindowWeights(params.windowType, numElements);
    const elementHorizontalX = Array.from({ length: numElements }, (_, n) => (n - (numElements - 1) / 2) * dLambda);
    const elementVerticalY = new Array(numElements).fill(0);
    const phaseN = Array.from({ length: numElements }, (_, n) => {
      const xN = elementHorizontalX[n];
      return phaseScale * xN * Math.sin(steeringRad);
    });

    const field = new Float32Array(size * size);
    let maxAbsField = 0;

    const denom = Math.max(1, size - 1);

    for (let py = 0; py < size; py += 1) {
      const v = (py / denom) * ySpan;
      for (let px = 0; px < size; px += 1) {
        const u = (px / denom - 0.5) * xSpan;
        let realSum = 0;

        for (let n = 0; n < numElements; n += 1) {
          const rN = Math.sqrt((u - elementHorizontalX[n]) ** 2 + (v - elementVerticalY[n]) ** 2);
          const phase = phaseScale * rN - phaseN[n];
          realSum += weights[n] * Math.cos(phase);
        }

        const idx = py * size + px;
        field[idx] = realSum;
        const absSum = Math.abs(realSum);
        if (absSum > maxAbsField) maxAbsField = absSum;
      }
    }

    const norm = maxAbsField > 0 ? maxAbsField : 1;
    const image = ctx.createImageData(size, size);

    for (let i = 0; i < field.length; i += 1) {
      const signedVal = Math.max(-1, Math.min(1, field[i] / norm));
      const compressed = Math.tanh(1.8 * signedVal);
      const p = i * 4;

      if (compressed >= 0) {
        const c = compressed;
        image.data[p] = Math.round(14 + 20 * c);
        image.data[p + 1] = Math.round(72 + 178 * c);
        image.data[p + 2] = Math.round(95 + 160 * c);
      } else {
        const c = -compressed;
        image.data[p] = Math.round(70 + 170 * c);
        image.data[p + 1] = Math.round(16 + 36 * c);
        image.data[p + 2] = Math.round(28 + 58 * c);
      }

      image.data[p + 3] = 255;
    }

    ctx.putImageData(image, 0, 0);

    const cx = size / 2;
    const cy = 0;
    const lineLen = size * 0.9;
    const endX = cx + lineLen * Math.sin(steeringRad);
    const endY = cy + lineLen * Math.cos(steeringRad);

    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgb(255, 235, 59)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.restore();
  }, [
    params.numElements,
    params.spacing,
    params.steeringAngleDeg,
    params.windowType,
  ]);

  const handleAutoScanClick = () => {
    if (autoScanActive) {
      setAutoScanActive(false);
      return;
    }

    const startInput = lastIdleInputRef.current ?? {
      params: debouncedParams,
      probeParamRad: debouncedProbeParamRad,
    };

    autoScanParamsRef.current = { ...startInput.params };
    clearBmodeBuffer(TOTAL_SCAN_POSITIONS, Math.max(startInput.params.numSamples, 1));
    setAutoScanProgress(0);
    autoScanStartParamRef.current = startInput.probeParamRad;
    setProbeParamRad(startInput.probeParamRad);
    setLatestColumnProbeParamRad(startInput.probeParamRad);
    setAutoScanActive(true);
  };

  const maxExpectedFd = (2 * (bloodVelocityCms / 100) * (5e6 / Math.max(params.wavelength, 0.1))) / 1540;
  const fdMagnitudeNorm = Math.min(Math.abs(dopplerState.fdHz) / Math.max(maxExpectedFd, 1), 1);

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
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Phantom View (Modified Shepp-Logan)</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={phantomRef} className={`ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? "loading" : "ready"} ${(isDraggingProbe || isDraggingVessel) ? "cursor-grabbing" : "cursor-grab"}`} />
            <div className="ultrasound-phantom-hint">Drag probe on boundary and drag vessel inside phantom. Hover region to inspect, click to edit.</div>

            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}

            {hoveredRegionData && !editorDraft && (
              <div
                className="ultrasound-phantom-tooltip"
                style={{
                  left: Math.min(hoveredRegion?.x ?? 0, 250),
                  top: Math.max((hoveredRegion?.y ?? 0) - 10, 8),
                }}
              >
                <div className="ultrasound-phantom-tooltip-title">{hoveredRegionData.label}</div>
                <div>Z: {hoveredRegionData.acousticImpedanceMrayl.toFixed(2)} MRayl</div>
                <div>a: {hoveredRegionData.attenuationDbCmMhz.toFixed(2)} dB/cm/MHz</div>
                <div>Backscatter: {hoveredRegionData.backscatterCoeff.toFixed(2)}</div>
                <div>c: {Math.round(hoveredRegionData.speedOfSoundMps)} m/s</div>
              </div>
            )}

            {editorDraft && selectedRegionIndex !== null && (
              <div className="ultrasound-phantom-editor">
                <h4 className="ultrasound-phantom-editor-title">Edit Region {editorDraft.regionId}</h4>

                <label className="ultrasound-phantom-editor-label">
                  Label
                  <input
                    value={editorDraft.label}
                    onChange={(event) =>
                      setEditorDraft((prev) => (prev ? { ...prev, label: event.target.value } : prev))
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Acoustic Impedance (MRayl)
                  <input
                    type="number"
                    step="0.01"
                    value={editorDraft.acousticImpedanceMrayl}
                    onChange={(event) =>
                      updateDraftNumericField("acousticImpedanceMrayl", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Attenuation (dB/cm/MHz)
                  <input
                    type="number"
                    step="0.01"
                    value={editorDraft.attenuationDbCmMhz}
                    onChange={(event) =>
                      updateDraftNumericField("attenuationDbCmMhz", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Backscatter Coefficient
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={editorDraft.backscatterCoeff}
                    onChange={(event) =>
                      updateDraftNumericField("backscatterCoeff", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Speed of Sound (m/s)
                  <input
                    type="number"
                    step="1"
                    value={editorDraft.speedOfSoundMps}
                    onChange={(event) =>
                      updateDraftNumericField("speedOfSoundMps", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Scatter Density
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={editorDraft.scatterDensity}
                    onChange={(event) =>
                      updateDraftNumericField("scatterDensity", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <label className="ultrasound-phantom-editor-label">
                  Boundary Roughness
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={editorDraft.boundaryRoughness}
                    onChange={(event) =>
                      updateDraftNumericField("boundaryRoughness", event.target.value)
                    }
                    className="ultrasound-phantom-editor-input"
                  />
                </label>

                <div className="ultrasound-phantom-editor-actions">
                  <button type="button" onClick={applyRegionEdit} className="ultrasound-phantom-editor-btn primary">Apply</button>
                  <button type="button" onClick={closeRegionEditor} className="ultrasound-phantom-editor-btn">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">A-Mode (Amplitude vs Depth)</h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded ultrasound-loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={aData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <defs>
                  <linearGradient id="usGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(270,70%,50%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(320,70%,60%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis
                  dataKey="depth"
                  tick={{ fontSize: 9 }}
                  label={{
                    value: "Depth (mm)",
                    position: "bottom",
                    offset: 5,
                    style: {
                      fill: "hsl(240,8%,55%)",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono",
                    },
                  }}
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  label={{
                    value: "Amplitude",
                    angle: -90,
                    position: "insideLeft",
                    style: {
                      fill: "hsl(240,8%,55%)",
                      fontSize: 10,
                      fontFamily: "JetBrains Mono",
                    },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(240,10%,15%)",
                    border: "1px solid hsl(240,10%,22%)",
                    borderRadius: 8,
                    fontFamily: "JetBrains Mono",
                    fontSize: 11,
                  }}
                />
                {us?.reflections?.map((reflection, index) => (
                  <ReferenceLine
                    key={`${reflection.depthMm}-${index}`}
                    x={reflection.depthMm}
                    stroke="hsl(320,70%,60%)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                ))}
                <Area
                  type="monotone"
                  dataKey="amplitude"
                  stroke="hsl(270,70%,50%)"
                  fill="url(#usGrad)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-panel p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2 gap-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">B-Mode Image</h3>
            <button
              type="button"
              onClick={handleAutoScanClick}
              className={`ultrasound-scan-btn ${autoScanActive ? "active" : ""}`}
            >
              {autoScanActive ? "Stop Scan" : "Auto Scan"}
            </button>
          </div>

          <div className="ultrasound-scan-progress">
            <div className="ultrasound-scan-progress-fill" style={{ width: `${Math.round(autoScanProgress * 100)}%` }} />
          </div>

          <div className="h-[230px] w-full flex items-center justify-center relative mt-2">
            <canvas ref={bmodeRef} className={`bmode-canvas ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? "loading" : "ready"}`} />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>

          <div className="ultrasound-doppler-section mt-2">
            <h4 className="ultrasound-doppler-title">Doppler Mode</h4>
            <p className="ultrasound-doppler-help">Drag the vessel in Phantom View. Frequency shift uses beam-vessel intersection.</p>

            <div className="ultrasound-doppler-control">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Blood Velocity</Label>
                <span className="text-[11px] font-mono text-foreground">{bloodVelocityCms.toFixed(1)} cm/s</span>
              </div>
              <Slider
                value={[bloodVelocityCms]}
                min={0}
                max={120}
                step={0.5}
                onValueChange={([v]) => setBloodVelocityCms(v)}
              />
            </div>

            <div className="ultrasound-doppler-control">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Flow Angle</Label>
                <span className="text-[11px] font-mono text-foreground">{flowAngleDeg.toFixed(0)}°</span>
              </div>
              <Slider
                value={[flowAngleDeg]}
                min={-180}
                max={180}
                step={1}
                onValueChange={([v]) => setFlowAngleDeg(v)}
              />
            </div>

            <div className="ultrasound-doppler-plot">
              <div className="ultrasound-doppler-axis" />
              <div
                className={`ultrasound-doppler-bar ${dopplerState.fdHz >= 0 ? "pos" : "neg"}`}
                style={{ width: `${Math.round(fdMagnitudeNorm * 50)}%` }}
              />
            </div>

            <div className="ultrasound-doppler-readout">
              <span>{dopplerState.intersects ? "Beam intersects vessel" : "No vessel intersection"}</span>
              <span>fd: {dopplerState.fdHz.toFixed(1)} Hz</span>
            </div>
          </div>
        </div>

        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Beam Field</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <canvas
              ref={beamFieldRef}
              width={BEAM_FIELD_SIZE}
              height={BEAM_FIELD_SIZE}
              className="rounded-lg"
              style={{ width: BEAM_FIELD_SIZE, height: BEAM_FIELD_SIZE }}
            />
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

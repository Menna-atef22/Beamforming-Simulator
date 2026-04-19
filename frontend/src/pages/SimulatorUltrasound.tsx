import { useMemo, useRef, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams, PhantomEllipse } from "@/types/beamforming";
import { useUltrasoundSimulatorAPI, SimulatorUltrasoundResponse } from "@/hooks/useUltrasoundSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const isInitialLoadRef = useRef(true);

  const { simulate, error } = useUltrasoundSimulatorAPI();
  const phantomRef = useRef<HTMLCanvasElement>(null);
  const bmodeRef = useRef<HTMLCanvasElement>(null);

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
    let isMounted = true;

    const runSim = async () => {
      const simulationParams = {
        ...debouncedParams,
        frequency: 5e6 / Math.max(debouncedParams.wavelength, 0.1),
        enableNoise: debouncedParams.noiseEnabled ?? debouncedParams.enableNoise ?? true,
      };

      const res = await simulate(simulationParams, isInitialLoadRef.current);
      if (isMounted && res?.success) {
        setResult(res);
        isInitialLoadRef.current = false;
      }
    };

    runSim();
    return () => {
      isMounted = false;
    };
  }, [debouncedParams, simulate]);

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

    const steerRad = (params.steeringAngleDeg * Math.PI) / 180;
    const probeX = w / 2;
    const probeY = 12;
    const beamLength = h - 28;
    const beamEndX = probeX + Math.sin(steerRad) * beamLength;
    const beamEndY = probeY + Math.cos(steerRad) * beamLength;

    const grad = ctx.createLinearGradient(probeX, probeY, beamEndX, beamEndY);
    grad.addColorStop(0, "hsla(270,85%,62%,0.55)");
    grad.addColorStop(1, "hsla(320,90%,62%,0.08)");

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = grad;
    ctx.lineWidth = 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(probeX, probeY);
    ctx.lineTo(beamEndX, beamEndY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "hsl(270,60%,50%)";
    ctx.fillRect(w / 2 - 20, 0, 40, 14);
    ctx.fillStyle = "hsl(270,60%,75%)";
    ctx.font = "9px JetBrains Mono";
    ctx.textAlign = "center";
    ctx.fillText("PROBE", w / 2, 10);
  }, [hoveredRegion, params.steeringAngleDeg, phantomRegions, selectedRegionIndex]);

  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas) return;

    const handlePointerMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
        setHoveredRegion(null);
        return;
      }

      const canvasX = (localX * canvas.width) / Math.max(rect.width, 1);
      const canvasY = (localY * canvas.height) / Math.max(rect.height, 1);
      const xNorm = ((canvasX + 0.5) / canvas.width) * 2 - 1;
      const yNorm = 1 - ((canvasY + 0.5) / canvas.height) * 2;
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
      setHoveredRegion(null);
    };

    const handleClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const canvasX = (localX * canvas.width) / Math.max(rect.width, 1);
      const canvasY = (localY * canvas.height) / Math.max(rect.height, 1);
      const xNorm = ((canvasX + 0.5) / canvas.width) * 2 - 1;
      const yNorm = 1 - ((canvasY + 0.5) / canvas.height) * 2;
      const regionIndex = findRegionAtNormalizedPoint(xNorm, yNorm);

      if (regionIndex !== null) {
        beginRegionEdit(regionIndex);
      }
    };

    canvas.addEventListener("mousemove", handlePointerMove);
    canvas.addEventListener("mouseleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);

    return () => {
      canvas.removeEventListener("mousemove", handlePointerMove);
      canvas.removeEventListener("mouseleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
    };
  }, [phantomRegions]);

  useEffect(() => {
    const canvas = bmodeRef.current;
    if (!canvas || !us) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = (canvas.width = 200);
    const h = (canvas.height = 300);
    const imageData = ctx.createImageData(w, h);

    const maxAmp = Math.max(...us.amplitudes, 0.001);

    for (let y = 0; y < h; y += 1) {
      const depthIdx = Math.floor((y / h) * us.amplitudes.length);
      for (let x = 0; x < w; x += 1) {
        const centerDist = Math.abs(x - w / 2) / (w / 2);
        const beamFalloff = Math.exp(-centerDist * centerDist * 3);
        const amp = (us.amplitudes[depthIdx] ?? 0) * beamFalloff;
        const brightness = Math.min(255, Math.round((amp / maxAmp) * 255));
        const idx = (y * w + x) * 4;
        imageData.data[idx] = brightness;
        imageData.data[idx + 1] = brightness;
        imageData.data[idx + 2] = brightness;
        imageData.data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [us]);

  const probeData = useMemo(
    () =>
      Array.from({ length: 181 }, (_, i) => {
        const angle = i - 90;
        const steerDiff = Math.abs(angle - (params.steeringAngleDeg ?? 0));
        const gain = Math.exp(-(steerDiff * steerDiff) / (2 * 15 * 15));
        return { angle, gain: parseFloat(gain.toFixed(4)) };
      }),
    [params.steeringAngleDeg]
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
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Phantom View (Modified Shepp-Logan)</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={phantomRef} className={`ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? "loading" : "ready"} ${hoveredRegion ? "cursor-pointer" : ""}`} />
            <div className="ultrasound-phantom-hint">Hover to inspect, click to edit region parameters</div>

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
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">B-Mode Image</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={bmodeRef} className={`bmode-canvas ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? "loading" : "ready"}`} />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Probe Direction</h3>
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
              <AreaChart data={probeData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <defs>
                  <linearGradient id="probeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(290,60%,50%)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(290,60%,50%)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis
                  dataKey="angle"
                  tick={{ fontSize: 9 }}
                  label={{
                    value: "Angle (°)",
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
                    value: "Gain",
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
                <Area
                  type="monotone"
                  dataKey="gain"
                  stroke="hsl(290,60%,50%)"
                  fill="url(#probeGrad)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

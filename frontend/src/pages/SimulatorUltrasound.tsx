import { useMemo, useRef, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import { useUltrasoundSimulatorAPI, SimulatorUltrasoundResponse, UltrasoundReflection } from "@/hooks/useUltrasoundSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./SimulatorUltrasound.css";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  LineChart, Line,
} from "recharts";

const defaultParams: BeamformingParams = {
  numElements: 8,
  spacing: 0.5,
  wavelength: 1.0,
  steeringAngleDeg: 0,
  amplitude: 1.0,
  snrDb: 30,
  windowType: "rectangular",
  noiseEnabled: true,
  apodizationEnabled: false,
};

export default function SimulatorUltrasound() {
  const [params, setParams] = useState<BeamformingParams>(defaultParams);
  const debouncedParams = useDebounce(params, 300);
  const [result, setResult] = useState<SimulatorUltrasoundResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = useUltrasoundSimulatorAPI();
  const us = useMemo(() => {
    if (!result?.data) return null;
    return {
      depths: result.data.depths || [],
      amplitudes: result.data.amplitudes || [],
      reflections: result.data.reflections || [],
    };
  }, [result]);
  const phantomRef = useRef<HTMLCanvasElement>(null);
  const bmodeRef = useRef<HTMLCanvasElement>(null);

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

  // A-mode data
  const aData = useMemo(() =>
    us?.depths
      .filter((_: number, i: number) => i % 2 === 0)
      .map((d: number, i: number) => ({
        depth: parseFloat(d.toFixed(2)),
        amplitude: parseFloat(((us?.amplitudes[i * 2] || 0)).toFixed(4)),
      })) ?? [],
    [us?.depths, us?.amplitudes]
  );

  // Phantom View (organ shapes)
  useEffect(() => {
    const canvas = phantomRef.current;
    if (!canvas || !us) return;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width = 360;
    const h = canvas.height = 360;
    ctx.fillStyle = "hsl(240,10%,10%)";
    ctx.fillRect(0, 0, w, h);

    // Body outline
    ctx.strokeStyle = "hsl(270,40%,35%)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 150, 160, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Tissue layers
    const layers = [
      { depth: 3, y: 80, label: "Skin", color: "hsl(320,40%,35%)" },
      { depth: 6.5, y: 155, label: "Liver", color: "hsl(270,50%,30%)" },
      { depth: 9, y: 215, label: "Kidney", color: "hsl(290,45%,28%)" },
      { depth: 12, y: 285, label: "Deep Tissue", color: "hsl(260,35%,25%)" },
    ];

    layers.forEach((layer) => {
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.ellipse(w / 2, layer.y, 80 + Math.random() * 30, 25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "hsl(270,20%,65%)";
      ctx.font = "10px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText(layer.label, w / 2, layer.y + 5);
    });

    // Probe beam
    const steerRad = (params.steeringAngleDeg * Math.PI) / 180;
    const beamEndX = w / 2 + Math.sin(steerRad) * 160;
    const grad = ctx.createLinearGradient(w / 2, 10, beamEndX, h - 20);
    grad.addColorStop(0, "hsla(270,70%,55%,0.6)");
    grad.addColorStop(1, "hsla(320,70%,60%,0.1)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w / 2, 10);
    ctx.lineTo(beamEndX, h - 20);
    ctx.stroke();

    // Probe
    ctx.fillStyle = "hsl(270,60%,50%)";
    ctx.fillRect(w / 2 - 20, 0, 40, 14);
    ctx.fillStyle = "hsl(270,60%,75%)";
    ctx.font = "9px JetBrains Mono";
    ctx.textAlign = "center";
    ctx.fillText("PROBE", w / 2, 10);
  }, [params, us]);

  // B-mode Image (basic)
  useEffect(() => {
    const canvas = bmodeRef.current;
    if (!canvas || !us) return;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width = 200;
    const h = canvas.height = 300;
    const imageData = ctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
      const depthIdx = Math.floor((y / h) * us.amplitudes.length);
      for (let x = 0; x < w; x++) {
        const centerDist = Math.abs(x - w / 2) / (w / 2);
        const beamFalloff = Math.exp(-centerDist * centerDist * 3);
        const amp = (us.amplitudes[depthIdx] ?? 0) * beamFalloff;
        const maxAmp = Math.max(...us.amplitudes);
        const brightness = Math.min(255, Math.round((amp / Math.max(maxAmp, 0.001)) * 255));
        const idx = (y * w + x) * 4;
        imageData.data[idx] = brightness;
        imageData.data[idx + 1] = brightness;
        imageData.data[idx + 2] = brightness;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }, [us]);

  // Probe direction data
  const probeData = useMemo(() =>
    Array.from({ length: 181 }, (_, i) => {
      const angle = i - 90;
      const steerDiff = Math.abs(angle - params.steeringAngleDeg);
      const gain = Math.exp(-(steerDiff * steerDiff) / (2 * 15 * 15));
      return { angle, gain: parseFloat(gain.toFixed(4)) };
    }),
    [params.steeringAngleDeg]
  );

  if (error && isInitialLoad) {
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
        {/* Phantom View */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Phantom View (Organ Layout)</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={phantomRef} className={`ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? 'loading' : 'ready'}`} />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* A-mode Plot */}
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
                <XAxis dataKey="depth" tick={{ fontSize: 9 }}
                  label={{ value: "Depth (cm)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Amplitude", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                {us?.reflections?.map((ref, i) => (
                  <ReferenceLine key={i} x={ref.depth} stroke="hsl(320,70%,60%)" strokeDasharray="4 4" strokeOpacity={0.5} />
                ))}
                <Area type="monotone" dataKey="amplitude" stroke="hsl(270,70%,50%)" fill="url(#usGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* B-mode Image */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">B-Mode Image</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={bmodeRef} className={`bmode-canvas ultrasound-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? 'loading' : 'ready'}`} />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* Probe Direction */}
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
                <XAxis dataKey="angle" tick={{ fontSize: 9 }}
                  label={{ value: "Angle (°)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Gain", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                <Area type="monotone" dataKey="gain" stroke="hsl(290,60%,50%)" fill="url(#probeGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

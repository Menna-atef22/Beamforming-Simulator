import { useMemo, useState, useRef, useEffect } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import { useRadarSimulatorAPI, SimulatorRadarResponse, RadarTarget } from "@/hooks/useRadarSimulatorAPI";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./SimulatorRadar.css";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Cell,
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

export default function SimulatorRadar() {
  const [params, setParams] = useState<BeamformingParams>(defaultParams);
  const [result, setResult] = useState<SimulatorRadarResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { simulate, error, loading } = useRadarSimulatorAPI();
  const [beamWidth, setBeamWidth] = useState(10);
  const [scanSpeed, setScanSpeed] = useState(5);
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);

  // Run simulation when params change
  useEffect(() => {
    const runSim = async () => {
      setIsLoading(true);
      const res = await simulate(params);
      setResult(res);
      setIsLoading(false);
    };
    runSim();
  }, [params, simulate]);

  const updateParam = <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const radar = useMemo(() => {
    if (!result?.data) return null;
    return {
      angles: result.data.angles?.filter(Number.isFinite) || [],
      returns: result.data.returns?.filter(Number.isFinite) || [],
      targets: (result.data.targets || []).filter(
        (t: RadarTarget) => 
          t && Number.isFinite(t.angle) && Number.isFinite(t.range) && Number.isFinite(t.rcs)
      ),
      beam_width_deg: result.data.beam_width_deg ?? 10,
    };
  }, [result]);

  // Radar scan view (polar canvas with rotating beam and objects)
  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas || !radar) return;
    const ctx = canvas.getContext("2d")!;
    const size = canvas.width = canvas.height = 380;
    const cx = size / 2, cy = size / 2, radius = size / 2 - 20;

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
    if (radar.angles.length > 0 && radar.returns.length > 0) {
      const maxReturn = Math.max(...radar.returns, 0.001);
      radar.angles.forEach((angleDeg, i) => {
        const intensity = radar.returns[i] ?? 0;
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
      if (!target || !Number.isFinite(target.angle) || !Number.isFinite(target.range)) return;
      const angleRad = (target.angle - 90) * Math.PI / 180;
      const r = (target.range / 10) * radius;
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

    // Beam sweep line
    const sweepAngle = ((params.steeringAngleDeg - 90) * Math.PI) / 180;
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
    grad.addColorStop(0, "hsla(270,70%,55%,0.8)");
    grad.addColorStop(1, "hsla(270,70%,55%,0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * radius, cy + Math.sin(sweepAngle) * radius);
    ctx.stroke();

    // Beam cone
    const halfBeam = (beamWidth / 2) * Math.PI / 180;
    ctx.fillStyle = "hsla(270,60%,50%,0.08)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, sweepAngle - halfBeam, sweepAngle + halfBeam);
    ctx.closePath();
    ctx.fill();
  }, [radar, params, beamWidth]);

  // Distance vs time
  const distTimeData = radar?.targets?.map((t: RadarTarget, i: number) => ({
    target: `T${i + 1}`,
    distance: t.range,
    time: parseFloat(((2 * t.range) / 3e8 * 1e6).toFixed(4)),
  })) ?? [];

  // Angle detection data
  const angleDetData = (radar?.angles?.length
    ? radar.angles
        .filter((_, i) => i % 3 === 0)
        .map((angle, i) => ({
          angle,
          return: parseFloat(((radar.returns?.[i * 3] ?? 0) || 0).toFixed(4)),
        }))
    : []);

  // Beam width effect: multiple beam widths
  const beamWidths = [5, 10, 20];
  const beamWidthData = Array.from({ length: 61 }, (_, i) => {
    const angle = i - 30;
    const entry: Record<string, number | string> = { angle };
    beamWidths.forEach((bw) => {
      entry[`bw${bw}`] = parseFloat(Math.exp(-(angle * angle) / (2 * (bw / 2.35) * (bw / 2.35))).toFixed(4));
    });
    return entry;
  });

  const extraControls = (
    <>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Beam Width</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">{beamWidth}°</span>
        </div>
        <Slider value={[beamWidth]} min={2} max={30} step={1} onValueChange={([v]) => setBeamWidth(v)} />
      </div>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Scan Speed</Label>
          <span className="text-xs font-mono text-foreground tabular-nums">{scanSpeed}°/s</span>
        </div>
        <Slider value={[scanSpeed]} min={1} max={20} step={1} onValueChange={([v]) => setScanSpeed(v)} />
      </div>
    </>
  );

  if (error || loading) {
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
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {isLoading ? (
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            ) : (
              <canvas ref={radarCanvasRef} className="radar-canvas rounded-lg max-w-full max-h-full" />
            )}
          </div>
        </div>

        {/* Distance vs Time */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Distance vs Time (Round-Trip)</h3>
          <div className="flex-1 min-h-0">
            {isLoading ? (
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
            {isLoading ? (
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
            {isLoading ? (
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

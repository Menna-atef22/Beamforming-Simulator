import { useMemo, useRef, useEffect, useState } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import { use5GSimulatorAPI, Simulator5GResponse, Tower, User } from "@/hooks/use5GSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LineChart, Line,
} from "recharts";
import BeamPlot from "@/components/BeamPlot";
import { Alert, AlertDescription } from "@/components/ui/alert";
import "./Simulator5G.css";

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

export default function Simulator5G() {
  const [params, setParams] = useState<BeamformingParams>(defaultParams);
  const debouncedParams = useDebounce(params, 300);
  const [result, setResult] = useState<Simulator5GResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = use5GSimulatorAPI();
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  // Extract 5G-specific data from API response
  const fiveG = useMemo(() => 
    result?.data ? { towers: result.data.towers || [], users: result.data.users || [], beam_patterns: result.data.beam_patterns || [] } : null,
    [result?.data]
  );

  // 2D Map with towers, users, and beam connections
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fiveG) return;
    const ctx = canvas.getContext("2d")!;
    const w = canvas.width = 400;
    const h = canvas.height = 400;
    ctx.fillStyle = "hsl(240,10%,12%)";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "hsl(240,10%,18%)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 40); ctx.lineTo(w, i * 40); ctx.stroke();
    }

    const toX = (x: number) => (x + 5) * (w / 10);
    const toY = (y: number) => h - (y + 1) * (h / 10);

    // Beam connections (lines from towers to users)
    fiveG?.towers.forEach((tower: Tower) => {
      fiveG.users.forEach((user: User) => {
        const grad = ctx.createLinearGradient(toX(tower.x), toY(tower.y), toX(user.x), toY(user.y));
        grad.addColorStop(0, "hsla(270,70%,50%,0.4)");
        grad.addColorStop(1, "hsla(320,70%,60%,0.15)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(tower.x), toY(tower.y));
        ctx.lineTo(toX(user.x), toY(user.y));
        ctx.stroke();
      });
    });

    // Towers (triangles)
    fiveG?.towers.forEach((tower: Tower) => {
      const tx = toX(tower.x), ty = toY(tower.y);
      ctx.fillStyle = "hsl(270,70%,55%)";
      ctx.beginPath();
      ctx.moveTo(tx, ty - 12);
      ctx.lineTo(tx - 8, ty + 6);
      ctx.lineTo(tx + 8, ty + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "hsl(270,70%,80%)";
      ctx.font = "10px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText(`T${tower.id}`, tx, ty + 20);
    });

    // Users (circles)
    fiveG?.users.forEach((user: User) => {
      const ux = toX(user.x), uy = toY(user.y);
      ctx.fillStyle = "hsl(320,70%,60%)";
      ctx.beginPath();
      ctx.arc(ux, uy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "hsl(320,70%,85%)";
      ctx.font = "10px JetBrains Mono";
      ctx.textAlign = "center";
      ctx.fillText(`U${user.id}`, ux, uy - 12);
    });
  }, [fiveG]);

  if (error && isInitialLoadRef.current) {
    return (
      <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
        <Alert variant="destructive" className="m-4">
          <AlertDescription>Backend Error: {error}</AlertDescription>
        </Alert>
      </MainLayout>
    );
  }

  const userSignalData = useMemo(() => 
    fiveG?.users.map((u: User) => ({
      name: `User ${u.id}`,
      signal: parseFloat(u.signal_strength.toFixed(3)),
    })) ?? [],
    [fiveG?.users]
  );

  // Distance vs signal for each user from each tower
  const distSignalData = useMemo(() =>
    (fiveG?.towers.flatMap((tower: Tower) =>
      (fiveG?.users ?? []).map((user: User) => {
        const dx = user.x - tower.x;
        const dy = user.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return { distance: parseFloat(dist.toFixed(2)), signal: parseFloat((user.signal_strength / (fiveG?.towers.length ?? 1)).toFixed(3)), label: `T${tower.id}→U${user.id}` };
      })
    ) ?? []).sort((a, b) => a.distance - b.distance),
    [fiveG?.towers, fiveG?.users]
  );

  return (
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">
        {/* 2D Map */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">5G Coverage Map (3 Towers · 2 Users)</h3>
          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas ref={canvasRef} className={`simulator-canvas rounded-lg max-w-full max-h-full ${isInitialLoadRef.current ? 'loading' : 'ready'}`} />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                <p className="text-xs text-muted-foreground">Initializing...</p>
              </div>
            )}
          </div>
        </div>

        {/* Signal Strength per User */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Signal Strength per User</h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={userSignalData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
                <YAxis tick={{ fontSize: 9 }} label={{ value: "Signal", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                <Bar dataKey="signal" radius={[6, 6, 0, 0]}>
                  {userSignalData.map((_, i) => (
                    <Cell key={`cell-${i}`} fill={i === 0 ? "hsl(270,70%,50%)" : "hsl(320,70%,60%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distance vs Signal */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Distance vs Signal</h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={distSignalData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis dataKey="distance" tick={{ fontSize: 9 }}
                  label={{ value: "Distance", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Signal", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                <Line type="monotone" dataKey="signal" stroke="hsl(280,60%,55%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(320,70%,60%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Beam Direction */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tower Beam Direction</h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-xs text-muted-foreground">Loading...</p>
                </div>
              </div>
            )}
            {result?.data?.beam_patterns && result.data.beam_patterns.length > 0 ? (
              <BeamPlot 
                beamPattern={{
                  angles: result.data.beam_patterns[0].angles ?? [],
                  magnitudes: result.data.beam_patterns[0].magnitudes ?? [],
                  magnitudesDb: (result.data.beam_patterns[0].magnitudes ?? []).map(m => 20 * Math.log10(Math.max(m, 1e-6)))
                }}
                title=""
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">No beam data</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
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

// ─── World-space bounds for user movement ────────────────────────────────────
const WORLD_MIN_X = -4.5;
const WORLD_MAX_X = 4.5;
const WORLD_MIN_Y = 0.2;
const WORLD_MAX_Y = 7.5;
const STEP = 0.25; // metres per key press

// ─── Default positions (keep in sync with backend _setup_default_network) ────
const DEFAULT_TOWERS = [
  { id: 1, x: -3.0, y: 0.0 },
  { id: 2, x:  0.0, y: 0.0 },
  { id: 3, x:  3.0, y: 0.0 },
];
const DEFAULT_USERS = [
  { id: 101, x:  1.0, y: 3.0 },
  { id: 102, x: -2.0, y: 4.0 },
];

// ─── Unique color per tower (hue, saturation%, lightness%) ───────────────────
// Each tower gets its own hue used for: coverage circle, beam lines, icon, label
const TOWER_COLORS: Record<number, { hue: number; name: string }> = {
  1: { hue: 270, name: "Violet"  }, // Tower 1 → violet/purple
  2: { hue: 185, name: "Cyan"    }, // Tower 2 → cyan/teal
  3: { hue:  35, name: "Amber"   }, // Tower 3 → amber/orange
};
const DEFAULT_TOWER_HUE = 270; // fallback if id not in palette

const defaultParams: BeamformingParams & Record<string, any> = {
  numElements: 16,
  spacing: 0.5,
  wavelength: 1.0,
  steeringAngleDeg: 0,
  amplitude: 1.0,
  snrDb: 30,
  windowType: "rectangular",
  noiseEnabled: true,
  apodizationEnabled: false,
  frequency: 28e9,
  autoSteer: true,
  gridSize: 80,
};

export default function Simulator5G() {
  const [params, setParams] = useState<BeamformingParams & Record<string, any>>(defaultParams);
  const debouncedParams = useDebounce(params, 300);

  // ─── Local user / tower state (drives both canvas and API) ───────────────
  const [localUsers, setLocalUsers] = useState(DEFAULT_USERS.map(u => ({ ...u })));
  const [localTowers] = useState(DEFAULT_TOWERS.map(t => ({ ...t })));
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  // ─── Handoff state: {userId: towerId} – updated from API, sent back for hysteresis
  const [currentConnections, setCurrentConnections] = useState<Record<number, number>>({});
  const currentConnectionsRef = useRef<Record<number, number>>({});
  currentConnectionsRef.current = currentConnections;

  const [result, setResult] = useState<Simulator5GResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = use5GSimulatorAPI();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ─── Run simulation whenever debounced params OR user positions change ────
  const runSimulation = useCallback(async (
    currentParams: typeof debouncedParams,
    users: typeof localUsers,
    towers: typeof localTowers,
  ) => {
    setIsLoading(true);
    try {
      const res = await simulate(
        {
          ...currentParams,
          users,
          towers,
          // Pass previous connections so backend can apply hysteresis
          current_connections: currentConnectionsRef.current,
        },
        isInitialLoadRef.current,
      );
      if (res?.success) {
        setResult(res);
        isInitialLoadRef.current = false;
        // Update local connection map from API response
        const newConns: Record<number, number> = {};
        for (const u of (res.data?.users ?? [])) {
          if ((u as any).connected_tower_id != null) {
            newConns[u.id] = (u as any).connected_tower_id;
          }
        }
        setCurrentConnections(newConns);
      }
    } finally {
      setIsLoading(false);
    }
  }, [simulate]);

  // Re-run on param changes
  useEffect(() => {
    let alive = true;
    runSimulation(debouncedParams, localUsers, localTowers).then(() => {
      if (!alive) return;
    });
    return () => { alive = false; };
  }, [debouncedParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run whenever user positions change (debounced via useState update)
  const localUsersRef = useRef(localUsers);
  localUsersRef.current = localUsers;

  const pendingSimRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSimAfterMove = useCallback(() => {
    if (pendingSimRef.current) clearTimeout(pendingSimRef.current);
    pendingSimRef.current = setTimeout(() => {
      runSimulation(debouncedParams, localUsersRef.current, localTowers);
    }, 80); // 80 ms debounce for keyboard holds
  }, [debouncedParams, localTowers, runSimulation]);

  // ─── Keyboard movement ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (selectedUserId === null) return;

      // Only intercept movement keys
      const moveKeys = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","w","a","s","d","W","A","S","D"];
      if (!moveKeys.includes(e.key)) return;

      e.preventDefault(); // stop page scroll

      setLocalUsers(prev => prev.map(u => {
        if (u.id !== selectedUserId) return u;
        let nx = u.x;
        let ny = u.y;
        switch (e.key) {
          case "ArrowUp":    case "w": case "W": ny += STEP; break;
          case "ArrowDown":  case "s": case "S": ny -= STEP; break;
          case "ArrowLeft":  case "a": case "A": nx -= STEP; break;
          case "ArrowRight": case "d": case "D": nx += STEP; break;
        }
        nx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, nx));
        ny = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y, ny));
        return { ...u, x: nx, y: ny };
      }));

      triggerSimAfterMove();
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedUserId, triggerSimAfterMove]);

  const updateParam = <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // ─── Extract 5G data from API response for charts ─────────────────────────
  const fiveG = useMemo(() =>
    result?.data
      ? {
          towers:      result.data.towers      || [],
          users:       result.data.users       || [],
          beamPatterns: result.data.beamPatterns || [],
        }
      : null,
    [result?.data]
  );

  // ─── Canvas coordinate helpers ────────────────────────────────────────────
  const CANVAS_W = 400;
  const CANVAS_H = 400;
  // Map world [-5, 5] x [0, 8] → canvas [0, 400]
  const toCanvasX = (x: number) => ((x + 5) / 10) * CANVAS_W;
  const toCanvasY = (y: number) => CANVAS_H - (y / 8) * CANVAS_H;

  // ─── Canvas click → select user ───────────────────────────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    // Find nearest user within 14px
    let bestId: number | null = null;
    let bestDist = 14;
    for (const u of localUsers) {
      const ux = toCanvasX(u.x);
      const uy = toCanvasY(u.y);
      const dist = Math.hypot(cx - ux, cy - uy);
      if (dist < bestDist) { bestDist = dist; bestId = u.id; }
    }
    setSelectedUserId(bestId ?? (selectedUserId === null ? null : null));
    if (bestId === null) setSelectedUserId(null); // click on empty space deselects
  }, [localUsers, selectedUserId]);

  // ─── Canvas drawing ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;

    // Background
    ctx.fillStyle = "hsl(240,10%,12%)";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = "hsl(240,10%,18%)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath(); ctx.moveTo(i * 40, 0); ctx.lineTo(i * 40, CANVAS_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 40); ctx.lineTo(CANVAS_W, i * 40); ctx.stroke();
    }

    // ── Coverage radius circles (drawn behind everything else) ───────────────
    const mToPxX = CANVAS_W / 10; // 40 px / m
    const mToPxY = CANVAS_H / 8;  // 50 px / m
    const mToPx  = (mToPxX + mToPxY) / 2;

    for (const tower of localTowers) {
      const tx = toCanvasX(tower.x), ty = toCanvasY(tower.y);
      const apiTower = fiveG?.towers.find((t: any) => t.id === tower.id);
      const radiusM  = (apiTower as any)?.coverage_radius_m ?? 4.5;
      const radiusPx = radiusM * mToPx;
      const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

      // Radial gradient fill — unique per-tower hue
      const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, radiusPx);
      grad.addColorStop(0,    `hsla(${hue},70%,45%,0.22)`);
      grad.addColorStop(0.65, `hsla(${hue},70%,40%,0.12)`);
      grad.addColorStop(1,    `hsla(${hue},70%,35%,0.0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tx, ty, radiusPx, 0, Math.PI * 2);
      ctx.fill();

      // Dashed border ring in tower color
      ctx.strokeStyle = `hsla(${hue},70%,65%,0.5)`;
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(tx, ty, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // "T1 – Violet  5.0 m" label on the right edge
      const colorName = TOWER_COLORS[tower.id]?.name ?? "";
      ctx.fillStyle = `hsla(${hue},65%,78%,0.75)`;
      ctx.font      = "9px JetBrains Mono, monospace";
      ctx.textAlign = "left";
      ctx.fillText(`T${tower.id} · ${colorName}  ${radiusM.toFixed(1)} m`, tx + radiusPx + 4, ty + 3);
    }

    // ── Connected beam lines (ONE beam per user — the connected tower only) ──
    for (const user of localUsers) {
      // Use the connection from latest API result (falls back to currentConnections)
      const apiUser   = fiveG?.users.find((u: any) => u.id === user.id);
      const connTowId = (apiUser as any)?.connected_tower_id ?? currentConnections[user.id] ?? null;
      if (connTowId === null) continue; // user not connected — skip

      const tower = localTowers.find(t => t.id === connTowId);
      if (!tower) continue;

      const tx = toCanvasX(tower.x), ty = toCanvasY(tower.y);
      const ux = toCanvasX(user.x),  uy = toCanvasY(user.y);
      const hue = TOWER_COLORS[connTowId]?.hue ?? DEFAULT_TOWER_HUE;
      const isSelectedUser = user.id === selectedUserId;

      const lineGrad = ctx.createLinearGradient(tx, ty, ux, uy);
      lineGrad.addColorStop(0, `hsla(${hue},85%,60%,${isSelectedUser ? 0.9 : 0.55})`);
      lineGrad.addColorStop(1, `hsla(${hue},70%,65%,${isSelectedUser ? 0.35 : 0.15})`);
      ctx.strokeStyle = lineGrad;
      ctx.lineWidth   = isSelectedUser ? 3 : 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ux, uy);
      ctx.stroke();
    }

    // ── Tower icons (triangles in unique tower color) ─────────────────────────
    for (const tower of localTowers) {
      const tx  = toCanvasX(tower.x), ty = toCanvasY(tower.y);
      const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

      // Tower triangle
      ctx.fillStyle = `hsl(${hue},70%,55%)`;
      ctx.strokeStyle = `hsl(${hue},70%,80%)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty - 13);
      ctx.lineTo(tx - 9, ty + 7);
      ctx.lineTo(tx + 9, ty + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Tower label in matching color
      ctx.fillStyle = `hsl(${hue},70%,88%)`;
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`T${tower.id}`, tx, ty + 22);
    }

    // ── User dots (color = connected tower or pink if unconnected) ────────────
    for (const user of localUsers) {
      const ux = toCanvasX(user.x), uy = toCanvasY(user.y);
      const isSelected = user.id === selectedUserId;

      // Resolve connected tower
      const apiUser   = fiveG?.users.find((u: any) => u.id === user.id);
      const connTowId = (apiUser as any)?.connected_tower_id ?? currentConnections[user.id] ?? null;
      const connHue   = connTowId != null ? (TOWER_COLORS[connTowId]?.hue ?? DEFAULT_TOWER_HUE) : null;
      const connected = connTowId != null;

      // In-range ring (green glow when inside *any* coverage circle)
      const inRange = localTowers.some(tower => {
        const apiTower = fiveG?.towers.find((t: any) => t.id === tower.id);
        const radiusM  = (apiTower as any)?.coverage_radius_m ?? 4.5;
        return Math.hypot(user.x - tower.x, user.y - tower.y) <= radiusM;
      });

      if (inRange && !isSelected && connHue !== null) {
        ctx.strokeStyle = `hsla(${connHue},75%,60%,0.6)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ux, uy, 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Selection glow
      if (isSelected) {
        const glowHue = connHue ?? 45;
        ctx.strokeStyle = `hsl(${glowHue},95%,65%)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(ux, uy, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `hsla(${glowHue},85%,65%,0.25)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ux, uy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }

      // User dot — tower color if connected, pink if not
      ctx.fillStyle = isSelected
        ? `hsl(${connHue ?? 45},90%,60%)`
        : connected
        ? `hsl(${connHue},68%,58%)`
        : "hsl(320,60%,55%)";
      ctx.beginPath();
      ctx.arc(ux, uy, 7, 0, Math.PI * 2);
      ctx.fill();

      // "U101" label
      ctx.fillStyle = isSelected
        ? `hsl(${connHue ?? 45},80%,88%)`
        : connected ? `hsl(${connHue},65%,82%)` : "hsl(320,60%,85%)";
      ctx.font = "bold 10px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`U${user.id}`, ux, uy - 17);

      // "→ T1" connectivity badge  (or "✖ no signal")
      if (connected) {
        const tName = TOWER_COLORS[connTowId!]?.name ?? `T${connTowId}`;
        ctx.fillStyle = `hsla(${connHue},65%,72%,0.85)`;
        ctx.font = "8px JetBrains Mono, monospace";
        ctx.fillText(`→ T${connTowId} ${tName}`, ux, uy + 20);
      } else {
        ctx.fillStyle = "hsla(0,65%,60%,0.6)";
        ctx.font = "8px JetBrains Mono, monospace";
        ctx.fillText("✖ no signal", ux, uy + 20);
      }

      // Position readout for selected user
      if (isSelected) {
        ctx.fillStyle = `hsl(${connHue ?? 45},75%,72%)`;
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.fillText(`(${user.x.toFixed(1)}, ${user.y.toFixed(1)})`, ux, uy - 28);
      }
    }
  }, [localUsers, localTowers, selectedUserId, fiveG, currentConnections]);



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

  const distSignalData = useMemo(() =>
    (fiveG?.towers.flatMap((tower: Tower) =>
      (fiveG?.users ?? []).map((user: User) => {
        const dx = user.x - tower.x;
        const dy = user.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return {
          distance: parseFloat(dist.toFixed(2)),
          signal:   parseFloat((user.signal_strength / (fiveG?.towers.length ?? 1)).toFixed(3)),
          label:    `T${tower.id}→U${user.id}`,
        };
      })
    ) ?? []).sort((a, b) => a.distance - b.distance),
    [fiveG?.towers, fiveG?.users]
  );

  return (
    <MainLayout controlPanel={<ControlPanel params={params} onParamChange={updateParam} />}>
      <div className="grid grid-cols-2 grid-rows-2 gap-3 h-full">

        {/* ── 2D Map ───────────────────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            5G Coverage Map — 3 Towers · 2 Users
          </h3>

          {/* Keyboard hint + color legend */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {selectedUserId !== null ? (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                ✦ U{selectedUserId} selected — W/A/S/D or ↑↓←→ to move
              </span>
            ) : (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground border border-white/10">
                Click a user (●) to select, then use W/A/S/D or arrow keys to move
              </span>
            )}

            {/* Per-tower color swatches */}
            <div className="flex items-center gap-1.5 ml-auto">
              {[
                { id: 1, hue: 270, name: "T1 · Violet" },
                { id: 2, hue: 185, name: "T2 · Cyan"   },
                { id: 3, hue:  35, name: "T3 · Amber"  },
              ].map(({ id, hue, name }) => (
                <span
                  key={id}
                  className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border"
                  style={{
                    color:            `hsl(${hue},70%,80%)`,
                    borderColor:      `hsla(${hue},65%,55%,0.5)`,
                    backgroundColor:  `hsla(${hue},70%,30%,0.2)`,
                  }}
                >
                  <span
                    className="inline-block rounded-full border"
                    style={{
                      width: 8, height: 8,
                      backgroundColor: `hsl(${hue},68%,52%)`,
                      borderColor:     `hsl(${hue},70%,75%)`,
                    }}
                  />
                  {name}
                </span>
              ))}
            </div>
          </div>


          <div className="flex-1 min-h-0 flex items-center justify-center relative">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className={`simulator-canvas rounded-lg max-w-full max-h-full cursor-pointer ${
                isInitialLoadRef.current ? "loading" : "ready"
              }`}
              style={{ outline: selectedUserId !== null ? "1px solid hsla(45,80%,55%,0.4)" : "none" }}
            />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Initializing…</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Signal Strength per User ─────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Signal Strength per User
          </h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Loading…</p>
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
                  {userSignalData.map((entry, i) => (
                    <Cell
                      key={`cell-${i}`}
                      fill={
                        entry.name === `User ${selectedUserId}`
                          ? "hsl(45,90%,55%)"
                          : i === 0
                          ? "hsl(270,70%,50%)"
                          : "hsl(320,70%,60%)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Distance vs Signal ───────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Distance vs Signal
          </h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Loading…</p>
                </div>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={distSignalData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis dataKey="distance" tick={{ fontSize: 9 }}
                  label={{ value: "Distance (m)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Signal", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                <Line type="monotone" dataKey="signal" stroke="hsl(280,60%,55%)" strokeWidth={2} dot={{ r: 4, fill: "hsl(320,70%,60%)" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Tower Beam Direction ──────────────────────────────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Tower Beam Direction
          </h3>
          <div className="flex-1 min-h-0 relative">
            {isInitialLoadRef.current && (
              <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Loading…</p>
                </div>
              </div>
            )}
            {result?.data?.beamPatterns && result.data.beamPatterns.length > 0 ? (
              <BeamPlot
                beamPattern={{
                  angles:       result.data.beamPatterns[0].angles     ?? [],
                  magnitudes:   result.data.beamPatterns[0].magnitudes  ?? [],
                  magnitudesDb: (result.data.beamPatterns[0].magnitudes ?? []).map(
                    m => 20 * Math.log10(Math.max(m, 1e-6))
                  ),
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

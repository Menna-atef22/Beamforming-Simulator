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

  // Beam wave animation tuning
  const DASH_LENGTH_PX = 14;
  const DASH_GAP_PX = 10;
  const DASH_SPEED_PX_PER_SEC = 90;
  const PULSE_SPACING_PX = 68;
  const PULSE_SPEED_PX_PER_SEC = 170;

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

  // ─── Canvas drawing (continuous animated beams) ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const apiTowerById = new Map<number, any>((fiveG?.towers ?? []).map((t: any) => [t.id, t]));
    const connectedTowerByUserId = new Map<number, number>();
    for (const u of fiveG?.users ?? []) {
      if ((u as any).connected_tower_id != null) {
        connectedTowerByUserId.set(u.id, (u as any).connected_tower_id);
      }
    }

    const mToPxX = CANVAS_W / 10;
    const mToPxY = CANVAS_H / 8;
    const mToPx = (mToPxX + mToPxY) / 2;
    const arrayGeometry = (params.geometry ?? "linear") as "linear" | "curved";
    const elementCount = Math.max(2, Math.min(64, Math.round(Number(params.numElements ?? 16))));
    const spacingLambda = Number(params.spacing ?? 0.5);
    const wavelengthMeters = Number(params.wavelength ?? 1.0);
    const physicalSpacingMeters = spacingLambda * wavelengthMeters;

    let rafId = 0;

    const drawFrame = (timeMs: number) => {
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

      // Coverage circles
      for (const tower of localTowers) {
        const tx = toCanvasX(tower.x), ty = toCanvasY(tower.y);
        const apiTower = apiTowerById.get(tower.id);
        const radiusM = (apiTower as any)?.coverage_radius_m ?? 4.5;
        const radiusPx = radiusM * mToPx;
        const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

        const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, radiusPx);
        grad.addColorStop(0, `hsla(${hue},70%,45%,0.22)`);
        grad.addColorStop(0.65, `hsla(${hue},70%,40%,0.12)`);
        grad.addColorStop(1, `hsla(${hue},70%,35%,0.0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(tx, ty, radiusPx, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `hsla(${hue},70%,65%,0.5)`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(tx, ty, radiusPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        const colorName = TOWER_COLORS[tower.id]?.name ?? "";
        ctx.fillStyle = `hsla(${hue},65%,78%,0.75)`;
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.textAlign = "left";
        ctx.fillText(`T${tower.id} · ${colorName}  ${radiusM.toFixed(1)} m`, tx + radiusPx + 4, ty + 3);
      }

      // Antenna element coordinates per tower (linear/curved array)
      const towerElementsById = new Map<number, Array<{ x: number; y: number }>>();
      const towerArrayCenterById = new Map<number, { x: number; y: number }>();

      for (const tower of localTowers) {
        const tx = toCanvasX(tower.x);
        const ty = toCanvasY(tower.y);
        const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

        const baseY = ty + 11;
        // Left panel spacing is d/lambda, so convert to physical spacing for rendering.
        const requestedSpacingPx = physicalSpacingMeters * mToPx * 0.34;
        const maxArraySpanPx = 76;
        const spacingPx = Math.max(
          3,
          Math.min(requestedSpacingPx, maxArraySpanPx / Math.max(1, elementCount - 1))
        );

        const elements: Array<{ x: number; y: number }> = [];

        if (arrayGeometry === "curved") {
          const curvatureInput = Number(params.radius ?? 1.4);
          const arcRadius = Math.max(22, Math.min(52, 18 + curvatureInput * 12));
          const totalSweep = Math.min(Math.PI * 0.92, ((elementCount - 1) * spacingPx) / arcRadius);
          const centerX = tx;
          const centerY = baseY + arcRadius;
          const a0 = -totalSweep / 2;

          for (let i = 0; i < elementCount; i++) {
            const t = elementCount === 1 ? 0 : i / (elementCount - 1);
            const a = a0 + t * totalSweep;
            elements.push({
              x: centerX + arcRadius * Math.sin(a),
              y: centerY - arcRadius * Math.cos(a),
            });
          }

          // Faint curved support rail for the array
          ctx.strokeStyle = `hsla(${hue},65%,65%,0.22)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < elements.length; i++) {
            const p = elements[i];
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        } else {
          const span = spacingPx * (elementCount - 1);
          const startX = tx - span / 2;
          for (let i = 0; i < elementCount; i++) {
            elements.push({ x: startX + i * spacingPx, y: baseY });
          }

          // Faint linear support rail for the array
          ctx.strokeStyle = `hsla(${hue},65%,65%,0.22)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, baseY);
          ctx.lineTo(startX + span, baseY);
          ctx.stroke();
        }

        // Element dots
        for (const e of elements) {
          ctx.fillStyle = `hsla(${hue},80%,70%,0.9)`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }

        towerElementsById.set(tower.id, elements);
        towerArrayCenterById.set(tower.id, {
          x: elements.reduce((s, p) => s + p.x, 0) / Math.max(1, elements.length),
          y: elements.reduce((s, p) => s + p.y, 0) / Math.max(1, elements.length),
        });
      }

      // Connected beam lines with moving dashes and traveling pulse dots
      const dashOffset = -((timeMs / 1000) * DASH_SPEED_PX_PER_SEC) % (DASH_LENGTH_PX + DASH_GAP_PX);
      const pulseTravel = ((timeMs / 1000) * PULSE_SPEED_PX_PER_SEC) % PULSE_SPACING_PX;

      for (const user of localUsers) {
        const connTowId = connectedTowerByUserId.get(user.id) ?? currentConnections[user.id] ?? null;
        if (connTowId === null) continue;

        const tower = localTowers.find((t) => t.id === connTowId);
        if (!tower) continue;

        const towerCenter = towerArrayCenterById.get(connTowId);
        const tx = towerCenter?.x ?? toCanvasX(tower.x);
        const ty = towerCenter?.y ?? toCanvasY(tower.y);
        const ux = toCanvasX(user.x), uy = toCanvasY(user.y);
        const hue = TOWER_COLORS[connTowId]?.hue ?? DEFAULT_TOWER_HUE;
        const isSelectedUser = user.id === selectedUserId;

        const dx = ux - tx;
        const dy = uy - ty;
        const len = Math.hypot(dx, dy);
        if (len < 1) continue;

        const dirX = dx / len;
        const dirY = dy / len;

        // Per-element faint wave arcs (individual emissions)
        const emitterElements = towerElementsById.get(connTowId) ?? [{ x: tx, y: ty }];
        const wavePeriodPx = 46;
        const waveTravelPx = ((timeMs / 1000) * (PULSE_SPEED_PX_PER_SEC * 0.58)) % wavePeriodPx;
        for (let ei = 0; ei < emitterElements.length; ei++) {
          const em = emitterElements[ei];
          const exToUser = ux - em.x;
          const eyToUser = uy - em.y;
          const angle = Math.atan2(eyToUser, exToUser);
          const spread = isSelectedUser ? 0.42 : 0.34;

          for (let k = 0; k < 3; k++) {
            const r = 7 + ((waveTravelPx + ei * 2 + k * (wavePeriodPx / 3)) % wavePeriodPx);
            const alpha = (isSelectedUser ? 0.28 : 0.18) * Math.max(0.35, 1 - r / 64);
            ctx.strokeStyle = `hsla(${hue},90%,68%,${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(em.x, em.y, r, angle - spread, angle + spread);
            ctx.stroke();
          }
        }

        // Bold constructive beam (sum of individual emissions)
        const sumGrad = ctx.createLinearGradient(tx, ty, ux, uy);
        sumGrad.addColorStop(0, `hsla(${hue},92%,70%,${isSelectedUser ? 0.55 : 0.35})`);
        sumGrad.addColorStop(1, `hsla(${hue},82%,68%,${isSelectedUser ? 0.26 : 0.14})`);
        ctx.strokeStyle = sumGrad;
        ctx.lineWidth = isSelectedUser ? 5.4 : 4.0;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ux, uy);
        ctx.stroke();

        const lineGrad = ctx.createLinearGradient(tx, ty, ux, uy);
        lineGrad.addColorStop(0, `hsla(${hue},88%,62%,${isSelectedUser ? 0.95 : 0.65})`);
        lineGrad.addColorStop(1, `hsla(${hue},72%,65%,${isSelectedUser ? 0.45 : 0.22})`);
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = isSelectedUser ? 3.2 : 2.2;
        ctx.setLineDash([DASH_LENGTH_PX, DASH_GAP_PX]);
        ctx.lineDashOffset = dashOffset;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ux, uy);
        ctx.stroke();

        // Draw rippling pulse packets moving tower -> user
        const pulseRadius = isSelectedUser ? 2.8 : 2.2;
        const glowRadius = isSelectedUser ? 6.8 : 5.6;
        for (let base = -PULSE_SPACING_PX * 2; base <= len + PULSE_SPACING_PX; base += PULSE_SPACING_PX) {
          const dist = base + pulseTravel;
          if (dist < 0 || dist > len) continue;

          const px = tx + dirX * dist;
          const py = ty + dirY * dist;

          const pulseAlpha = isSelectedUser ? 0.9 : 0.72;
          ctx.fillStyle = `hsla(${hue},95%,72%,${pulseAlpha})`;
          ctx.beginPath();
          ctx.arc(px, py, pulseRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = `hsla(${hue},90%,70%,${isSelectedUser ? 0.35 : 0.24})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, glowRadius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Endpoint focus near connected user
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.strokeStyle = `hsla(${hue},90%,70%,${isSelectedUser ? 0.42 : 0.24})`;
        ctx.lineWidth = isSelectedUser ? 2.2 : 1.4;
        ctx.beginPath();
        ctx.arc(ux, uy, isSelectedUser ? 9 : 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // Tower icons
      for (const tower of localTowers) {
        const tx = toCanvasX(tower.x), ty = toCanvasY(tower.y);
        const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

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

        ctx.fillStyle = `hsl(${hue},70%,88%)`;
        ctx.font = "bold 10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`T${tower.id}`, tx, ty + 22);
      }

      // User markers
      for (const user of localUsers) {
        const ux = toCanvasX(user.x), uy = toCanvasY(user.y);
        const isSelected = user.id === selectedUserId;

        const connTowId = connectedTowerByUserId.get(user.id) ?? currentConnections[user.id] ?? null;
        const connHue = connTowId != null ? (TOWER_COLORS[connTowId]?.hue ?? DEFAULT_TOWER_HUE) : null;
        const connected = connTowId != null;

        const inRange = localTowers.some((tower) => {
          const apiTower = apiTowerById.get(tower.id);
          const radiusM = (apiTower as any)?.coverage_radius_m ?? 4.5;
          return Math.hypot(user.x - tower.x, user.y - tower.y) <= radiusM;
        });

        if (inRange && !isSelected && connHue !== null) {
          ctx.strokeStyle = `hsla(${connHue},75%,60%,0.6)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ux, uy, 12, 0, Math.PI * 2);
          ctx.stroke();
        }

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

        ctx.fillStyle = isSelected
          ? `hsl(${connHue ?? 45},90%,60%)`
          : connected
            ? `hsl(${connHue},68%,58%)`
            : "hsl(320,60%,55%)";
        ctx.beginPath();
        ctx.arc(ux, uy, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isSelected
          ? `hsl(${connHue ?? 45},80%,88%)`
          : connected ? `hsl(${connHue},65%,82%)` : "hsl(320,60%,85%)";
        ctx.font = "bold 10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`U${user.id}`, ux, uy - 17);

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

        if (isSelected) {
          ctx.fillStyle = `hsl(${connHue ?? 45},75%,72%)`;
          ctx.font = "9px JetBrains Mono, monospace";
          ctx.fillText(`(${user.x.toFixed(1)}, ${user.y.toFixed(1)})`, ux, uy - 28);
        }
      }

      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [
    localUsers,
    localTowers,
    selectedUserId,
    fiveG,
    currentConnections,
    CANVAS_W,
    CANVAS_H,
    DASH_LENGTH_PX,
    DASH_GAP_PX,
    DASH_SPEED_PX_PER_SEC,
    PULSE_SPACING_PX,
    PULSE_SPEED_PX_PER_SEC,
    params.geometry,
    params.numElements,
    params.spacing,
    params.radius,
  ]);



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

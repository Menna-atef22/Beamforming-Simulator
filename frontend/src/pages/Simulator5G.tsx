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
import HeatmapView from "@/components/HeatmapView";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TowerConfigPopup, { TowerParams } from "@/components/TowerConfigPopup";
import "./Simulator5G.css";

// ─── World-space bounds for user movement ────────────────────────────────────
const WORLD_MIN_X = -14.0;
const WORLD_MAX_X = 14.0;
const WORLD_MIN_Y = 0.2;
const WORLD_MAX_Y = 10.5;
const STEP = 0.25; // metres per key press

// Convert canvas percentage anchors to world coordinates (y% measured from top of canvas).
const fromCanvasPercent = (px: number, py: number) => {
  const x = WORLD_MIN_X + (px / 100) * (WORLD_MAX_X - WORLD_MIN_X);
  const y = WORLD_MIN_Y + (1 - py / 100) * (WORLD_MAX_Y - WORLD_MIN_Y);
  return { x, y };
};

// ─── Default positions (keep in sync with backend _setup_default_network) ────
const DEFAULT_TOWERS = [
  { id: 1, ...fromCanvasPercent(10, 80) },
  { id: 2, ...fromCanvasPercent(50, 84) },
  { id: 3, ...fromCanvasPercent(90, 80) },
];
const DEFAULT_USERS = [
  { id: 101, ...fromCanvasPercent(35, 40) },
  { id: 102, ...fromCanvasPercent(65, 40) },
];

// ─── Unique color per tower (hue, saturation%, lightness%) ───────────────────
// Each tower gets its own hue used for: coverage circle, beam lines, icon, label
const TOWER_COLORS: Record<number, { hue: number; name: string }> = {
  1: { hue: 270, name: "Violet"  }, // Tower 1 → violet/purple
  2: { hue: 185, name: "Cyan"    }, // Tower 2 → cyan/teal
  3: { hue:  35, name: "Amber"   }, // Tower 3 → amber/orange
};
const DEFAULT_TOWER_HUE = 270; // fallback if id not in palette

// ─── Unique color per user (for element-subset coloring) ─────────────────────
const USER_COLORS: Record<number, { hue: number; name: string }> = {
  101: { hue: 340, name: "Rose"    }, // User 101 → rose/pink
  102: { hue: 150, name: "Green"   }, // User 102 → emerald green
};
const DEFAULT_USER_HUE = 340;


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
  geometry: "linear",
  radius: 50,
  autoSteer: false,
  gridSize: 80,
};

export default function Simulator5G() {
  const [params, setParams] = useState<BeamformingParams & Record<string, any>>(defaultParams);
  const debouncedParams = useDebounce(params, 300);

  // ─── Local user / tower state (drives both canvas and API) ───────────────
  const [localUsers, setLocalUsers] = useState(DEFAULT_USERS.map(u => ({ ...u })));
  // Extended tower state: positions + per-tower params
  const [localTowers, setLocalTowers] = useState<TowerParams[]>(
    DEFAULT_TOWERS.map(t => ({
      ...t,
      coverage_radius_m: 5.0,
      num_elements: defaultParams.numElements,
      frequency: defaultParams.frequency,
      spacing: defaultParams.spacing,
      wavelength: defaultParams.wavelength,
      steering_angle_deg: defaultParams.steeringAngleDeg,
      amplitude: defaultParams.amplitude,
      snr_db: defaultParams.snrDb,
      window_type: defaultParams.windowType,
      noise_enabled: defaultParams.noiseEnabled,
      apodization_enabled: defaultParams.apodizationEnabled,
      geometry: defaultParams.geometry ?? "linear",
      radius: Number.isFinite(Number(defaultParams.radius)) ? Number(defaultParams.radius) : 50,
    }))
  );
  const [selectedUserId, setSelectedUserId]   = useState<number | null>(null);
  const [selectedTowerId, setSelectedTowerId] = useState<number | null>(null);
  const [panelTowerId, setPanelTowerId] = useState<number>(1);
  // Canvas-space anchor for tower popup (in viewport px)
  const [towerPopupAnchor, setTowerPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [analysisViewMode, setAnalysisViewMode] = useState<"heatmap" | "beam">("heatmap");

  // ─── Handoff state: {userId: towerId} – updated from API, sent back for hysteresis
  const [currentConnections, setCurrentConnections] = useState<Record<number, number>>({});
  const currentConnectionsRef = useRef<Record<number, number>>({});
  currentConnectionsRef.current = currentConnections;

  const [result, setResult] = useState<Simulator5GResponse | null>(null);
  const isInitialLoadRef = useRef(true);
  const [isLoading, setIsLoading] = useState(true);
  const { simulate, error } = use5GSimulatorAPI();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 520, height: 520 });

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      setCanvasSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };

    updateSize();

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateSize) : null;
    ro?.observe(container);
    window.addEventListener("resize", updateSize);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  // Ensure T1 starts with the requested defaults.
  useEffect(() => {
    setLocalTowers((prev) => prev.map((t) => {
      if (t.id !== 1) return t;
      return {
        ...t,
        num_elements: 16,
        spacing: 0.5,
        geometry: "linear",
      } as any;
    }));
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const towerById = new Map<number, any>((res.data?.towers ?? []).map((t: any) => [t.id, t]));
        for (const u of (res.data?.users ?? [])) {
          const connTowId = (u as any).connected_tower_id;
          if (connTowId == null) continue;
          const tower = towerById.get(connTowId);
          if (!tower) continue;

          const radiusM = Number((tower as any).coverage_radius_m ?? 4.5);
          const dx = (u as any).x - (tower as any).x;
          const dy = (u as any).y - (tower as any).y;
          if (Math.hypot(dx, dy) <= radiusM) {
            newConns[u.id] = connTowId;
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

  const towerToControlParams = useCallback((tower?: TowerParams | null): BeamformingParams & Record<string, any> => ({
    ...defaultParams,
    numElements: Number(tower?.num_elements ?? defaultParams.numElements),
    spacing: Number((tower as any)?.spacing ?? defaultParams.spacing),
    wavelength: Number((tower as any)?.wavelength ?? defaultParams.wavelength),
    steeringAngleDeg: Number((tower as any)?.steering_angle_deg ?? defaultParams.steeringAngleDeg),
    amplitude: Number((tower as any)?.amplitude ?? defaultParams.amplitude),
    snrDb: Number((tower as any)?.snr_db ?? defaultParams.snrDb),
    windowType: ((tower as any)?.window_type ?? defaultParams.windowType),
    noiseEnabled: Boolean((tower as any)?.noise_enabled ?? defaultParams.noiseEnabled),
    apodizationEnabled: Boolean((tower as any)?.apodization_enabled ?? defaultParams.apodizationEnabled),
    frequency: Number((tower as any)?.frequency ?? defaultParams.frequency),
    geometry: ((tower as any)?.geometry ?? defaultParams.geometry),
    radius: Number((tower as any)?.radius ?? defaultParams.radius),
    autoSteer: false,
    gridSize: Number((tower as any)?.grid_size ?? defaultParams.gridSize),
  }), []);

  useEffect(() => {
    const tower = localTowers.find((t) => t.id === panelTowerId);
    if (!tower) return;
    setParams((prev) => {
      const next = towerToControlParams(tower);
      const changed =
        prev.numElements !== next.numElements ||
        prev.spacing !== next.spacing ||
        prev.wavelength !== next.wavelength ||
        prev.steeringAngleDeg !== next.steeringAngleDeg ||
        prev.amplitude !== next.amplitude ||
        prev.snrDb !== next.snrDb ||
        prev.windowType !== next.windowType ||
        prev.noiseEnabled !== next.noiseEnabled ||
        prev.apodizationEnabled !== next.apodizationEnabled ||
        prev.frequency !== next.frequency ||
        prev.geometry !== next.geometry ||
        prev.radius !== next.radius;
      return changed ? next : prev;
    });
  }, [panelTowerId, localTowers, towerToControlParams]);

  const updateParam = <K extends keyof BeamformingParams>(key: K, value: BeamformingParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));

    setLocalTowers((prev) => prev.map((tower) => {
      if (tower.id !== panelTowerId) return tower;
      switch (key) {
        case "numElements":
          return { ...tower, num_elements: Number(value) };
        case "spacing":
          return { ...tower, spacing: Number(value) };
        case "wavelength":
          return { ...tower, wavelength: Number(value) };
        case "steeringAngleDeg":
          return { ...tower, steering_angle_deg: Number(value) };
        case "amplitude":
          return { ...tower, amplitude: Number(value) };
        case "snrDb":
          return { ...tower, snr_db: Number(value) };
        case "windowType":
          return { ...tower, window_type: value as any };
        case "noiseEnabled":
          return { ...tower, noise_enabled: Boolean(value) };
        case "apodizationEnabled":
          return { ...tower, apodization_enabled: Boolean(value) };
        case "frequency":
          return { ...tower, frequency: Number(value) };
        case "geometry":
          return { ...tower, geometry: value as any };
        case "radius":
          return { ...tower, radius: Number(value) };
        default:
          return tower;
      }
    }));
  };

  // ─── Extract 5G data from API response for charts ─────────────────────────
  const fiveG = useMemo(() =>
    result?.data
      ? {
          towers:      result.data.towers      || [],
          users:       result.data.users       || [],
          connectivityMap: result.data.connectivityMap || [],
          beamPatterns: result.data.beamPatterns || [],
        }
      : null,
    [result?.data]
  );

  // {towerId: [{user_id, num_elements, element_start, element_end, angle_deg, fraction}]}
  const elementAllocsByTowerId = useMemo(() => {
    const out = new Map<number, Array<{
      user_id: number; num_elements: number;
      element_start: number; element_end: number;
      angle_deg: number; fraction: number;
    }>>();
    for (const bp of (fiveG?.beamPatterns as any[] ?? [])) {
      const tid = Number(bp.tower_id ?? bp.towerId ?? 0);
      const allocs = bp.element_allocations ?? bp.elementAllocations ?? [];
      out.set(tid, allocs);
    }
    return out;
  }, [fiveG?.beamPatterns]);



  // ─── Canvas coordinate helpers ────────────────────────────────────────────
  const CANVAS_W = canvasSize.width;
  const CANVAS_H = canvasSize.height;

  const towerCoverageRadiusByTowerId = useMemo(() => {
    const apiTowerById = new Map<number, any>((fiveG?.towers ?? []).map((t: any) => [t.id, t]));
    const radiusById = new Map<number, number>();

    for (const tower of localTowers) {
      const apiTower = apiTowerById.get(tower.id);
      const radiusM = Number((apiTower as any)?.coverage_radius_m ?? 4.5);
      radiusById.set(tower.id, radiusM);
    }

    return radiusById;
  }, [fiveG?.towers, localTowers]);

  const effectiveConnectedTowerByUserId = useMemo(() => {
    const connectedByApi = new Map<number, number>();
    for (const u of fiveG?.users ?? []) {
      const connTowId = (u as any).connected_tower_id ?? (u as any).connectedTowerId;
      if (connTowId != null) connectedByApi.set(u.id, connTowId);
    }

    const towerById = new Map<number, { id: number; x: number; y: number }>(localTowers.map((t) => [t.id, t]));
    const effective = new Map<number, number>();

    for (const user of localUsers) {
      const candidateTowerId = connectedByApi.get(user.id) ?? currentConnections[user.id] ?? null;
      if (candidateTowerId == null) continue;

      const tower = towerById.get(candidateTowerId);
      if (!tower) continue;

      const radiusM = towerCoverageRadiusByTowerId.get(candidateTowerId) ?? 4.5;
      const d = Math.hypot(user.x - tower.x, user.y - tower.y);
      if (d <= radiusM) {
        effective.set(user.id, candidateTowerId);
      }
    }

    return effective;
  }, [fiveG?.users, localUsers, localTowers, currentConnections, towerCoverageRadiusByTowerId]);

  // Immediate fallback connectivity from current map geometry.
  // Keeps labels/charts responsive while API responses are in-flight.
  const nearestInRangeTowerByUserId = useMemo(() => {
    const out = new Map<number, number>();
    for (const user of localUsers) {
      let bestTowerId: number | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const tower of localTowers) {
        const radiusM = towerCoverageRadiusByTowerId.get(tower.id) ?? 4.5;
        const d = Math.hypot(user.x - tower.x, user.y - tower.y);
        if (d <= radiusM && d < bestDist) {
          bestDist = d;
          bestTowerId = tower.id;
        }
      }
      if (bestTowerId != null) out.set(user.id, bestTowerId);
    }
    return out;
  }, [localUsers, localTowers, towerCoverageRadiusByTowerId]);

  const liveConnectedTowerByUserId = useMemo(() => {
    const merged = new Map<number, number>();
    for (const user of localUsers) {
      const apiConn = effectiveConnectedTowerByUserId.get(user.id);
      if (apiConn != null) {
        merged.set(user.id, apiConn);
        continue;
      }
      const fallbackConn = nearestInRangeTowerByUserId.get(user.id);
      if (fallbackConn != null) merged.set(user.id, fallbackConn);
    }
    return merged;
  }, [localUsers, effectiveConnectedTowerByUserId, nearestInRangeTowerByUserId]);

  // Radius-aware viewport fit so all towers and coverage circles remain fully visible.
  const mapViewport = useMemo(() => {
    let minX = WORLD_MIN_X;
    let maxX = WORLD_MAX_X;
    let minY = WORLD_MIN_Y;
    let maxY = WORLD_MAX_Y;

    for (const t of localTowers) {
      const radiusM = towerCoverageRadiusByTowerId.get(t.id) ?? 4.5;
      minX = Math.min(minX, t.x - radiusM);
      maxX = Math.max(maxX, t.x + radiusM);
      minY = Math.min(minY, t.y - radiusM);
      maxY = Math.max(maxY, t.y + radiusM);
    }

    for (const u of localUsers) {
      minX = Math.min(minX, u.x);
      maxX = Math.max(maxX, u.x);
      minY = Math.min(minY, u.y);
      maxY = Math.max(maxY, u.y);
    }

    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const padX = Math.max(0.6, spanX * 0.06);
    const padY = Math.max(0.6, spanY * 0.06);

    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    };
  }, [towerCoverageRadiusByTowerId, localTowers, localUsers]);

  const toCanvasX = useCallback((x: number) => {
    const spanX = Math.max(1e-6, mapViewport.maxX - mapViewport.minX);
    return ((x - mapViewport.minX) / spanX) * CANVAS_W;
  }, [mapViewport]);

  const toCanvasY = useCallback((y: number) => {
    const spanY = Math.max(1e-6, mapViewport.maxY - mapViewport.minY);
    return CANVAS_H - ((y - mapViewport.minY) / spanY) * CANVAS_H;
  }, [mapViewport]);

  // ─── Canvas click → select tower (priority) or user ─────────────────────
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top)  * scaleY;

    // 1. Check towers first (click radius = 18px for the triangle icon)
    let bestTowerId: number | null = null;
    let bestTowerDist = 18;
    for (const t of localTowers) {
      const tx = toCanvasX(t.x);
      const ty = toCanvasY(t.y);
      const dist = Math.hypot(cx - tx, cy - ty);
      if (dist < bestTowerDist) { bestTowerDist = dist; bestTowerId = t.id; }
    }

    if (bestTowerId !== null) {
      setSelectedTowerId(bestTowerId);
      setPanelTowerId(bestTowerId);
      setSelectedUserId(null);
      // Anchor popup to viewport coordinates of the tower icon
      const clickedTower = localTowers.find(t => t.id === bestTowerId)!;
      const tx = toCanvasX(clickedTower.x);
      const ty = toCanvasY(clickedTower.y);
      // Convert canvas-space tx,ty to viewport pixels
      const vpX = rect.left + (tx / CANVAS_W) * rect.width;
      const vpY = rect.top  + (ty / CANVAS_H) * rect.height - 14;
      setTowerPopupAnchor({ x: vpX, y: vpY });
      return;
    }

    // 2. Check users (click radius = 14px)
    let bestUserId: number | null = null;
    let bestUserDist = 14;
    for (const u of localUsers) {
      const ux = toCanvasX(u.x);
      const uy = toCanvasY(u.y);
      const dist = Math.hypot(cx - ux, cy - uy);
      if (dist < bestUserDist) { bestUserDist = dist; bestUserId = u.id; }
    }

    if (bestUserId !== null) {
      setSelectedUserId(bestUserId);
      setSelectedTowerId(null);
      setTowerPopupAnchor(null);
    } else {
      // Click on empty space → deselect everything
      setSelectedUserId(null);
      setSelectedTowerId(null);
      setTowerPopupAnchor(null);
    }
  }, [localUsers, localTowers, toCanvasX, toCanvasY, CANVAS_W, CANVAS_H]);


  // ─── Canvas drawing (continuous animated beams) ─────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    const apiTowerById = new Map<number, any>((fiveG?.towers ?? []).map((t: any) => [t.id, t]));
    const drawCoverageRadiusByTowerId = towerCoverageRadiusByTowerId;

    const mToPxX = CANVAS_W / Math.max(1e-6, (mapViewport.maxX - mapViewport.minX));
    const mToPxY = CANVAS_H / Math.max(1e-6, (mapViewport.maxY - mapViewport.minY));
    const mToPx = (mToPxX + mToPxY) / 2;

    const besselI0 = (x: number) => {
      let sum = 1;
      let term = 1;
      const half = x / 2;
      for (let k = 1; k < 16; k++) {
        term *= (half * half) / (k * k);
        sum += term;
      }
      return sum;
    };

    const buildWindowWeights = (count: number, wTypeInput: string, apodizationEnabled: boolean) => {
      const n = Math.max(1, count);
      const wType = String(wTypeInput ?? "rectangular").toLowerCase();
      if (n === 1) return [1];

      if (!apodizationEnabled || wType === "rectangular") {
        return Array.from({ length: n }, () => 1);
      }

      if (wType === "hamming") {
        return Array.from({ length: n }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
      }
      if (wType === "hanning") {
        return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      }
      if (wType === "blackman") {
        return Array.from(
          { length: n },
          (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1))
        );
      }
      if (wType === "kaiser") {
        const beta = 6.0;
        const denom = besselI0(beta);
        return Array.from({ length: n }, (_, i) => {
          const t = (2 * i) / (n - 1) - 1;
          return besselI0(beta * Math.sqrt(Math.max(0, 1 - t * t))) / Math.max(denom, 1e-12);
        });
      }
      return Array.from({ length: n }, () => 1);
    };

    const computeArrayFactorNorm = (
      thetaDeg: number,
      steeringDeg: number,
      elemCount: number,
      spacingOverLambda: number,
      weights: number[]
    ) => {
      const th = (thetaDeg * Math.PI) / 180;
      const th0 = (steeringDeg * Math.PI) / 180;
      const d = spacingOverLambda;
      const center = (elemCount - 1) / 2;
      const psi = 2 * Math.PI * d * (Math.sin(th) - Math.sin(th0));

      let re = 0;
      let im = 0;
      let wSum = 0;
      for (let n = 0; n < elemCount; n++) {
        const w = weights[n] ?? 1;
        const phase = psi * (n - center);
        re += w * Math.cos(phase);
        im += w * Math.sin(phase);
        wSum += Math.abs(w);
      }

      const mag = Math.hypot(re, im);
      return mag / Math.max(wSum, 1e-9);
    };

    const lobeAngles = Array.from({ length: 181 }, (_, i) => i - 90);

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
        const radiusM = drawCoverageRadiusByTowerId.get(tower.id) ?? 4.5;
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
        const towerGeometry = ((tower as any).geometry ?? "linear") as "linear" | "curved";
        const towerElemCount = Math.max(2, Math.min(64, Math.round(Number((tower as any).num_elements ?? 16))));
        const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
        const towerFreqHz = Number((tower as any).frequency ?? 28e9);
        const towerWavelengthMeters = Number((tower as any).wavelength ?? (3e8 / Math.max(1.0, towerFreqHz)));
        const towerPhysicalSpacingMeters = towerSpacingLambda * towerWavelengthMeters;

        // Keep aperture centered at the tower point.
        const baseY = ty;

        // Scale aperture from physical spacing x (N-1), with a strict safety cap.
        // Keep dotted element line clearly shorter than tower-to-tower spacing.
        const desiredAperturePx = towerPhysicalSpacingMeters * Math.max(1, towerElemCount - 1) * mToPx * 0.45;
        const aperturePx = Math.max(8, Math.min(desiredAperturePx, CANVAS_W * 0.18));
        const spacingPx = towerElemCount > 1 ? (aperturePx / (towerElemCount - 1)) : 0;

        const elements: Array<{ x: number; y: number }> = [];

        if (towerGeometry === "curved") {
          const curvatureInput = Number((tower as any).radius ?? 1.4);
          const arcRadius = Math.max(18, Math.min(52, 12 + curvatureInput * 10));
          const totalSweep = Math.min(Math.PI * 0.96, (aperturePx / Math.max(1, arcRadius)));
          const centerX = tx;
          const centerY = baseY + arcRadius;
          const a0 = -totalSweep / 2;

          for (let i = 0; i < towerElemCount; i++) {
            const t = towerElemCount === 1 ? 0 : i / (towerElemCount - 1);
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
          // Linear aperture is centered at tower and oriented perpendicular to beam direction.
          const connectedUsersForTower = localUsers.filter((u) => {
            const connTowId = liveConnectedTowerByUserId.get(u.id) ?? null;
            return connTowId === tower.id;
          });

          let beamDirX = 0;
          let beamDirY = -1;
          if (connectedUsersForTower.length > 0) {
            for (const u of connectedUsersForTower) {
              const ux = toCanvasX(u.x);
              const uy = toCanvasY(u.y);
              const dx = ux - tx;
              const dy = uy - ty;
              const mag = Math.hypot(dx, dy);
              if (mag > 1e-6) {
                beamDirX += dx / mag;
                beamDirY += dy / mag;
              }
            }
            const meanMag = Math.hypot(beamDirX, beamDirY);
            if (meanMag > 1e-6) {
              beamDirX /= meanMag;
              beamDirY /= meanMag;
            } else {
              beamDirX = 0;
              beamDirY = -1;
            }
          }

          // Aperture axis = beam axis rotated +90° (perpendicular line through tower center).
          const axisX = -beamDirY;
          const axisY = beamDirX;
          const centerOffset = (towerElemCount - 1) / 2;
          for (let i = 0; i < towerElemCount; i++) {
            const offset = (i - centerOffset) * spacingPx;
            elements.push({
              x: tx + axisX * offset,
              y: baseY + axisY * offset,
            });
          }

          // Faint linear support rail for the array
          const start = elements[0];
          const end = elements[elements.length - 1];
          ctx.strokeStyle = `hsla(${hue},65%,65%,0.22)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }

        // Element dots — colored by user allocation when multiple users share this tower
        const allocs = elementAllocsByTowerId.get(tower.id) ?? [];
        const hasAllocations = allocs.length > 1; // only split when 2+ users share tower

        for (let ei = 0; ei < elements.length; ei++) {
          const e = elements[ei];

          // Find which user this element index belongs to
          let dotHue = hue; // default: tower color
          let dotAlpha = 0.9;
          if (hasAllocations) {
            const alloc = allocs.find(a => ei >= a.element_start && ei < a.element_end);
            if (alloc) {
              dotHue   = USER_COLORS[alloc.user_id]?.hue ?? DEFAULT_USER_HUE;
              dotAlpha = 1.0;
            }
          }

          ctx.fillStyle = `hsla(${dotHue},85%,72%,${dotAlpha})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, hasAllocations ? 2.5 : 2.1, 0, Math.PI * 2);
          ctx.fill();

          // Draw a faint separator line between sub-array groups
          if (hasAllocations && allocs.some(a => a.element_start === ei && ei > 0)) {
            const prev = elements[ei - 1];
            const mpX = (e.x + prev.x) / 2;
            const mpY = (e.y + prev.y) / 2;
            ctx.strokeStyle = "hsla(0,0%,100%,0.35)";
            ctx.lineWidth = 1;
            const perpX = (e.y - prev.y);
            const perpY = -(e.x - prev.x);
            const pLen = Math.hypot(perpX, perpY) || 1;
            ctx.beginPath();
            ctx.moveTo(mpX + (perpX / pLen) * 5, mpY + (perpY / pLen) * 5);
            ctx.lineTo(mpX - (perpX / pLen) * 5, mpY - (perpY / pLen) * 5);
            ctx.stroke();
          }
        }

        // Compute per-alloc sub-array centroid for beam origin (used later in beam-line pass)
        const subArrayCenterByUserId = new Map<number, {x: number; y:number}>();
        if (hasAllocations) {
          for (const alloc of allocs) {
            const slice = elements.slice(alloc.element_start, alloc.element_end);
            if (slice.length === 0) continue;
            subArrayCenterByUserId.set(alloc.user_id, {
              x: slice.reduce((s, p) => s + p.x, 0) / slice.length,
              y: slice.reduce((s, p) => s + p.y, 0) / slice.length,
            });
          }
        }

        towerElementsById.set(tower.id, elements);
        towerArrayCenterById.set(tower.id, {
          x: elements.reduce((s, p) => s + p.x, 0) / Math.max(1, elements.length),
          y: elements.reduce((s, p) => s + p.y, 0) / Math.max(1, elements.length),
        });
        // Store sub-array centers keyed as "towerId:userId"
        for (const [uid, center] of subArrayCenterByUserId) {
          towerArrayCenterById.set(Number(`${tower.id}0000${uid}`), center);
        }
      }

      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // Tower icons
      for (const tower of localTowers) {
        const tx = toCanvasX(tower.x), ty = toCanvasY(tower.y);
        const hue = TOWER_COLORS[tower.id]?.hue ?? DEFAULT_TOWER_HUE;

        // Pick nearest connected user for this tower (if multiple users attach to same tower).
        let connectedUser: (typeof localUsers)[number] | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const u of localUsers) {
          const connTowId = liveConnectedTowerByUserId.get(u.id) ?? null;
          if (connTowId !== tower.id) continue;
          const d = Math.hypot(u.x - tower.x, u.y - tower.y);
          if (d < bestDist) {
            bestDist = d;
            connectedUser = u;
          }
        }

        // Build telemetry label — show per-user element allocation when tower is shared
        const towerAllocs = elementAllocsByTowerId.get(tower.id) ?? [];
        let statusLine1: string;
        let statusLine2: string | null = null;

        if (towerAllocs.length >= 2) {
          // Multi-user: show element split
          statusLine1 = towerAllocs
            .map(a => `${a.num_elements} elements → U${a.user_id}`)
            .join(", ");
          statusLine2 = null;
        } else if (connectedUser) {
          const thetaRad = Math.atan2(connectedUser.x - tower.x, connectedUser.y - tower.y);
          statusLine1 = `θ ${((thetaRad * 180) / Math.PI).toFixed(1)}°`;
          const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
          const deltaPhiRad = 2 * Math.PI * towerSpacingLambda * Math.sin(thetaRad);
          statusLine2 = `Δφ ${deltaPhiRad.toFixed(2)} rad`;
        } else {
          statusLine1 = "No user";
        }

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

        // Draw AF lobe above tower body so the beam base is never visually clipped.
        if (connectedUser) {
          const lobeOrigin = towerArrayCenterById.get(tower.id);
          const lx = lobeOrigin?.x ?? tx;
          // Emit from just below the tower glyph so the beam is visible under the triangle body.
          const ly = (lobeOrigin?.y ?? ty) + 8;
          const steerDeg = (Math.atan2(connectedUser.x - tower.x, connectedUser.y - tower.y) * 180) / Math.PI;

          const elemN = Math.max(2, Math.min(64, Math.round(Number((tower as any).num_elements ?? 16))));
          const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
          const towerWindowType = String((tower as any).window_type ?? "rectangular");
          const towerApodizationEnabled = Boolean((tower as any).apodization_enabled ?? false);
          const weights = buildWindowWeights(elemN, towerWindowType, towerApodizationEnabled);
          const coverPx = (drawCoverageRadiusByTowerId.get(tower.id) ?? 4.5) * mToPx;
          const maxLobeRadiusPx = Math.max(26, Math.min(coverPx * 0.96, CANVAS_W * 0.24));

          const points: Array<{ x: number; y: number }> = [];
          const baseLobeRadiusPx = 6;
          for (const rel of lobeAngles) {
            const absDeg = steerDeg + rel;
            const af = computeArrayFactorNorm(absDeg, steerDeg, elemN, towerSpacingLambda, weights);
            const r = baseLobeRadiusPx + maxLobeRadiusPx * Math.pow(af, 0.92);
            const a = (absDeg * Math.PI) / 180;
            points.push({ x: lx + Math.sin(a) * r, y: ly - Math.cos(a) * r });
          }

          if (points.length > 1) {
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            for (const p of points) ctx.lineTo(p.x, p.y);
            ctx.closePath();

            const lobeFillAlpha = towerApodizationEnabled ? 0.20 : 0.14;
            ctx.fillStyle = `hsla(${hue},88%,62%,${lobeFillAlpha})`;
            ctx.fill();

            ctx.strokeStyle = `hsla(${hue},92%,70%,${towerApodizationEnabled ? 0.9 : 0.72})`;
            ctx.lineWidth = towerApodizationEnabled ? 1.7 : 1.4;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
            ctx.stroke();
          }
        }

        ctx.fillStyle = `hsl(${hue},70%,88%)`;
        ctx.font = "bold 10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`T${tower.id}`, tx, ty + 22);

        // Live tower telemetry label: steering angle and phase shift toward connected user.
        ctx.font = "8px JetBrains Mono, monospace";
        const lines = statusLine2 ? [statusLine1, statusLine2] : [statusLine1];
        const lineHeight = 10;
        const padX = 6;
        const padY = 4;
        let labelWidth = 0;
        for (const line of lines) {
          labelWidth = Math.max(labelWidth, ctx.measureText(line).width);
        }

        const boxW = Math.ceil(labelWidth + padX * 2);
        const boxH = Math.ceil(lines.length * lineHeight + padY * 2);
        const boxX = tx + 13;
        const boxY = ty - 16 - boxH;

        ctx.fillStyle = `hsla(${hue},35%,10%,0.82)`;
        ctx.strokeStyle = `hsla(${hue},70%,65%,0.65)`;
        ctx.lineWidth = 1;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.textAlign = "left";
        ctx.fillStyle = connectedUser ? `hsla(${hue},85%,82%,0.95)` : "hsla(0,0%,85%,0.95)";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], boxX + padX, boxY + padY + (i + 1) * lineHeight - 2);
        }
      }

      // User markers
      for (const user of localUsers) {
        const ux = toCanvasX(user.x), uy = toCanvasY(user.y);
        const isSelected = user.id === selectedUserId;

        const connTowId = liveConnectedTowerByUserId.get(user.id) ?? null;
        const connHue = connTowId != null ? (TOWER_COLORS[connTowId]?.hue ?? DEFAULT_TOWER_HUE) : null;
        const connected = connTowId != null;

        const inRange = localTowers.some((tower) => {
          const radiusM = drawCoverageRadiusByTowerId.get(tower.id) ?? ((apiTowerById.get(tower.id) as any)?.coverage_radius_m ?? 4.5);
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
            : "hsl(0,0%,60%)";
        ctx.beginPath();
        ctx.arc(ux, uy, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isSelected
          ? `hsl(${connHue ?? 45},80%,88%)`
          : connected ? `hsl(${connHue},65%,82%)` : "hsl(0,0%,82%)";
        ctx.font = "bold 10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`U${user.id}`, ux, uy - 17);

        if (connected) {
          const tName = TOWER_COLORS[connTowId!]?.name ?? `T${connTowId}`;
          ctx.fillStyle = `hsla(${connHue},65%,72%,0.85)`;
          ctx.font = "8px JetBrains Mono, monospace";
          ctx.fillText(`→ T${connTowId} ${tName}`, ux, uy + 20);
        } else {
          ctx.fillStyle = "hsla(0,0%,78%,0.9)";
          ctx.font = "8px JetBrains Mono, monospace";
          ctx.fillText("No signal", ux, uy + 20);
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
    selectedTowerId,
    fiveG,
    elementAllocsByTowerId,
    liveConnectedTowerByUserId,
    towerCoverageRadiusByTowerId,
    mapViewport,
    CANVAS_W,
    CANVAS_H,
  ]);


  // ─── Tower param change → update state + re-simulate ─────────────────────
  const handleTowerParamChange = useCallback((updated: TowerParams) => {
    setLocalTowers(prev => prev.map(t => t.id === updated.id ? updated : t));
    // Trigger re-simulation with short debounce (done via useEffect on localTowers)
  }, []);

  // Escape key closes tower popup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTowerId(null);
        setTowerPopupAnchor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Re-run simulation whenever localTowers params change
  const localTowersRef = useRef(localTowers);
  localTowersRef.current = localTowers;
  useEffect(() => {
    // Small delay so rapid slider drags are batched
    const t = setTimeout(() =>
      runSimulation(debouncedParams, localUsersRef.current, localTowersRef.current),
      80
    );
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTowers]);

  const initialBackendError = error && isInitialLoadRef.current ? error : null;

  const userSignalData = useMemo(() =>
    {
      const userById = new Map<number, any>((fiveG?.users ?? []).map((u: any) => [u.id, u]));
      const localTowerById = new Map<number, { x: number; y: number }>(
        localTowers.map((t) => [t.id, { x: t.x, y: t.y }])
      );
      const signalByUserTower = new Map<string, number>();
      const bestSignalByUser = new Map<number, number>();

      for (const c of (fiveG?.connectivityMap as any[] ?? [])) {
        const userId = (c as any).userId ?? (c as any).user_id;
        const towerId = (c as any).towerId ?? (c as any).tower_id;
        const signal = (c as any).signalStrength ?? (c as any).signal_strength ?? 0;
        if (typeof userId === "number" && typeof towerId === "number") {
          const s = Number(signal) || 0;
          signalByUserTower.set(`${userId}:${towerId}`, s);
          const prevBest = bestSignalByUser.get(userId) ?? 0;
          if (s > prevBest) bestSignalByUser.set(userId, s);
        }
      }

      return localUsers.map((u) => {
        const connectedTowerId = liveConnectedTowerByUserId.get(u.id) ?? null;
        const connectedSignal = connectedTowerId != null
          ? signalByUserTower.get(`${u.id}:${connectedTowerId}`)
          : undefined;
        const fallbackSignal = Number(
          (userById.get(u.id) as any)?.signal_strength ??
          (userById.get(u.id) as any)?.signalStrength ??
          0
        ) || 0;
        const bestKnownSignal = bestSignalByUser.get(u.id) ?? fallbackSignal;
        let signal = connectedTowerId != null
          ? (connectedSignal ?? bestKnownSignal)
          : 0;

        // Distance-dominant proxy for robust UI behavior:
        // when users share a tower, closer users must read stronger than farther users.
        if (connectedTowerId != null) {
          const tower = localTowerById.get(connectedTowerId);
          if (tower) {
            const d = Math.max(0.25, Math.hypot(u.x - tower.x, u.y - tower.y));
            const allocs = elementAllocsByTowerId.get(connectedTowerId) ?? [];
            const alloc = allocs.find((a) => Number(a.user_id) === u.id);
            const allocFraction = alloc?.fraction ?? 1.0;
            const distanceProxy = allocFraction / (d * d);

            if (!Number.isFinite(signal) || signal <= 1e-6 || alloc != null) {
              signal = distanceProxy;
            } else {
              // Keep physically computed signal, but clamp with proxy floor to avoid inversions.
              signal = Math.max(signal, distanceProxy * 0.5);
            }
          }
        }

        return {
          id: u.id,
          name: `User ${u.id}`,
          // Preserve dynamic range so bars don't disappear from aggressive rounding.
          signal: parseFloat(signal.toFixed(6)),
          connectedTowerId,
        };
      });
    },
    [fiveG?.users, fiveG?.connectivityMap, localUsers, localTowers, liveConnectedTowerByUserId, elementAllocsByTowerId]
  );

  const activeTowerIds = useMemo(() => new Set<number>(Array.from(liveConnectedTowerByUserId.values())), [liveConnectedTowerByUserId]);

  const interferenceHeatmapData = useMemo(() => {
    const GRID_N = 180;
    const C = 3e8;
    const besselI0 = (x: number) => {
      let sum = 1;
      let term = 1;
      const half = x / 2;
      for (let k = 1; k < 16; k++) {
        term *= (half * half) / (k * k);
        sum += term;
      }
      return sum;
    };
    const windowWeights = (nInput: number, wTypeInput: string, apodizationEnabled: boolean) => {
      const n = Math.max(1, nInput);
      const wType = String(wTypeInput ?? "rectangular").toLowerCase();
      if (n === 1) return [1];
      if (!apodizationEnabled || wType === "rectangular") return Array.from({ length: n }, () => 1);
      if (wType === "hamming") return Array.from({ length: n }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
      if (wType === "hanning") return Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      if (wType === "blackman") return Array.from({ length: n }, (_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1)));
      if (wType === "kaiser") {
        const beta = 6.0;
        const denom = besselI0(beta);
        return Array.from({ length: n }, (_, i) => {
          const t = (2 * i) / (n - 1) - 1;
          return besselI0(beta * Math.sqrt(Math.max(0, 1 - t * t))) / Math.max(denom, 1e-12);
        });
      }
      return Array.from({ length: n }, () => 1);
    };
    const activeIds = new Set<number>(Array.from(liveConnectedTowerByUserId.values()));
    const participatingTowers = localTowers.filter((t) => activeIds.has(t.id));
    const localUsersById = new Map<number, { id: number; x: number; y: number }>(localUsers.map((u) => [u.id, u]));
    const allocsByTower = elementAllocsByTowerId;
    const kEpsilon = 1e-6;

    const spanX = Math.max(1e-6, mapViewport.maxX - mapViewport.minX);
    const spanY = Math.max(1e-6, mapViewport.maxY - mapViewport.minY);
    const xRange = Array.from({ length: GRID_N }, (_, i) => mapViewport.minX + (i / (GRID_N - 1)) * spanX);
    const yRange = Array.from({ length: GRID_N }, (_, i) => mapViewport.minY + (i / (GRID_N - 1)) * spanY);

    if (participatingTowers.length === 0) {
      return {
        grid: Array.from({ length: GRID_N }, () => Array.from({ length: GRID_N }, () => 0)),
        xRange,
        yRange,
        maxVal: 1,
        extent: Math.max(spanX, spanY),
      };
    }

    const elementEmitters: Array<{ x: number; y: number; amp: number; phase: number; k: number }> = [];

    for (const tower of participatingTowers) {
      const nElem = Math.max(2, Math.min(64, Math.round(Number((tower as any).num_elements ?? 16))));
      const freqHz = Number((tower as any).frequency ?? 28e9);
      const wavelength = Math.max(1e-9, C / Math.max(1.0, freqHz));
      const spacingMeters = Math.max(1e-6, Number((tower as any).spacing ?? 0.5) * wavelength);
      const amplitude = Math.max(1e-6, Number((tower as any).amplitude ?? 1.0));
      const weights = windowWeights(
        nElem,
        String((tower as any).window_type ?? "rectangular"),
        Boolean((tower as any).apodization_enabled ?? false)
      );
      const wNorm = Math.max(1e-9, weights.reduce((s, w) => s + Math.abs(w), 0));
      const kWave = (2 * Math.PI) / wavelength;
      const centerOffset = (nElem - 1) / 2;
      const allocs = allocsByTower.get(tower.id) ?? [];

      // Beam axis follows average direction of connected users.
      let beamDirX = 0;
      let beamDirY = 1;
      const connectedUsers = localUsers.filter((u) => liveConnectedTowerByUserId.get(u.id) === tower.id);
      if (connectedUsers.length > 0) {
        let sx = 0;
        let sy = 0;
        for (const u of connectedUsers) {
          const dx = u.x - tower.x;
          const dy = u.y - tower.y;
          const mag = Math.hypot(dx, dy);
          if (mag > 1e-6) {
            sx += dx / mag;
            sy += dy / mag;
          }
        }
        const smag = Math.hypot(sx, sy);
        if (smag > 1e-6) {
          beamDirX = sx / smag;
          beamDirY = sy / smag;
        }
      }
      const axisX = -beamDirY;
      const axisY = beamDirX;

      for (let i = 0; i < nElem; i++) {
        const offset = (i - centerOffset) * spacingMeters;
        const ex = tower.x + axisX * offset;
        const ey = tower.y + axisY * offset;

        let steerX = beamDirX;
        let steerY = beamDirY;
        const alloc = allocs.find((a: any) => i >= a.element_start && i < a.element_end);
        if (alloc) {
          const target = localUsersById.get(Number(alloc.user_id));
          if (target) {
            const dx = target.x - ex;
            const dy = target.y - ey;
            const mag = Math.hypot(dx, dy);
            if (mag > 1e-6) {
              steerX = dx / mag;
              steerY = dy / mag;
            }
          }
        }

        // Simple steering phase term for each element against its selected beam direction.
        const phase = -kWave * (ex * steerX + ey * steerY);
        const elemAmp = amplitude * ((weights[i] ?? 1) / wNorm);
        elementEmitters.push({ x: ex, y: ey, amp: elemAmp, phase, k: kWave });
      }
    }

    const rawGrid: number[][] = [];
    const flatVals: number[] = [];

    for (let yi = 0; yi < GRID_N; yi++) {
      const y = yRange[yi];
      const row: number[] = [];
      for (let xi = 0; xi < GRID_N; xi++) {
        const x = xRange[xi];
        let real = 0;
        let imag = 0;
        for (const em of elementEmitters) {
          const r = Math.max(kEpsilon, Math.hypot(x - em.x, y - em.y));
          const phase = (em.k * r) + em.phase;
          const a = em.amp / Math.sqrt(r);
          real += a * Math.cos(phase);
          imag += a * Math.sin(phase);
        }
        // True interference intensity from complex superposition.
        const intensity = real * real + imag * imag;
        row.push(intensity);
        flatVals.push(intensity);
      }
      rawGrid.push(row);
    }

    // Robust normalization: use a high percentile instead of absolute max
    // to avoid a single hotspot turning the whole map bright.
    flatVals.sort((a, b) => a - b);
    const p = 0.99;
    const idx = Math.min(flatVals.length - 1, Math.max(0, Math.floor(p * (flatVals.length - 1))));
    const maxVal = Math.max(1e-12, flatVals[idx] ?? 1e-12);

    return {
      grid: rawGrid,
      xRange,
      yRange,
      maxVal: Math.max(1e-9, maxVal),
      extent: Math.max(spanX, spanY),
    };
  }, [
    localUsers,
    localTowers,
    liveConnectedTowerByUserId,
    elementAllocsByTowerId,
    mapViewport,
  ]);

  const activeBeamSeries = useMemo(() => {
    const rows = (result?.data?.beamPatterns ?? []).map((bp: any, idx: number) => {
      const towerId = Number((bp as any).towerId ?? (bp as any).tower_id ?? idx + 1);
      const angles = (bp as any).angles ?? [];
      const magnitudes = (bp as any).magnitudes ?? [];
      const magnitudesDb = (bp as any).magnitudesDb
        ?? (bp as any).magnitudes_db
        ?? magnitudes.map((m: number) => 20 * Math.log10(Math.max(m, 1e-6)));
      const hue = TOWER_COLORS[towerId]?.hue ?? DEFAULT_TOWER_HUE;
      const colorName = TOWER_COLORS[towerId]?.name ?? `Tower ${towerId}`;
      return {
        towerId,
        angles,
        magnitudes,
        magnitudesDb,
        color: `hsl(${hue},80%,62%)`,
        label: `T${towerId} ${colorName}`,
      };
    }).filter((r) => r.angles.length > 0 && r.magnitudes.length > 0);

    const activeRows = rows.filter((r) => activeTowerIds.has(r.towerId));
    return (activeRows.length > 0 ? activeRows : rows).sort((a, b) => a.towerId - b.towerId);
  }, [result?.data?.beamPatterns, activeTowerIds]);

  const distanceChart = useMemo(() => {
    const SAMPLE_COUNT = 40;
    const connectedTowerIds = Array.from(new Set(Array.from(liveConnectedTowerByUserId.values())));
    const towers = localTowers.filter((t) => connectedTowerIds.includes(t.id));

    if (towers.length === 0) {
      return { curveData: [] as Array<Record<string, number>>, markers: [] as Array<{ userId: number; towerId: number; distance: number; signal: number }> };
    }

    const towerRadiusById = new Map<number, number>();
    for (const t of towers) {
      towerRadiusById.set(t.id, towerCoverageRadiusByTowerId.get(t.id) ?? Number(t.coverage_radius_m ?? 4.5));
    }
    const maxRadius = Math.max(...Array.from(towerRadiusById.values()), 1);
    const minDist = 0.25;

    const curveData = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
      const d = minDist + (i / (SAMPLE_COUNT - 1)) * (maxRadius - minDist);
      const row: Record<string, number> = { distance: parseFloat(d.toFixed(2)) };
      for (const t of towers) {
        const radius = towerRadiusById.get(t.id) ?? maxRadius;
        const key = `tower_${t.id}`;
        row[key] = d <= radius ? (1 / (d * d)) : 0;
      }
      return row;
    });

    const markers = localUsers
      .map((u) => {
        const towerId = liveConnectedTowerByUserId.get(u.id);
        if (towerId == null) return null;
        const tower = localTowers.find((t) => t.id === towerId);
        if (!tower) return null;
        const d = Math.max(minDist, Math.hypot(u.x - tower.x, u.y - tower.y));
        const allocs = elementAllocsByTowerId.get(towerId) ?? [];
        const alloc = allocs.find((a) => Number(a.user_id) === u.id);
        const allocFraction = alloc?.fraction ?? 1.0;
        return {
          userId: u.id,
          towerId,
          distance: parseFloat(d.toFixed(2)),
          signal: parseFloat((allocFraction / (d * d)).toFixed(6)),
        };
      })
      .filter((m): m is { userId: number; towerId: number; distance: number; signal: number } => m !== null);

    return { curveData, markers };
  }, [localUsers, localTowers, liveConnectedTowerByUserId, elementAllocsByTowerId, towerCoverageRadiusByTowerId]);

  const panelControl = useMemo(() => (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border/50 bg-card/70">
        <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground mb-2">Tower Selector</div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((id) => {
            const selected = panelTowerId === id;
            const hue = TOWER_COLORS[id]?.hue ?? DEFAULT_TOWER_HUE;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPanelTowerId(id)}
                className="h-8 rounded-md border text-[11px] font-mono font-semibold transition-colors"
                style={{
                  borderColor: selected ? `hsla(${hue},70%,60%,0.9)` : "hsla(240,10%,35%,0.6)",
                  backgroundColor: selected ? `hsla(${hue},70%,42%,0.35)` : "hsla(240,10%,18%,0.55)",
                  color: selected ? `hsl(${hue},80%,85%)` : "hsl(240,8%,78%)",
                }}
              >
                {`T${id}`}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ControlPanel params={params} onParamChange={updateParam} />
      </div>
    </div>
  ), [panelTowerId, params]);

  return (
    <MainLayout controlPanel={panelControl}>
      {initialBackendError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>Backend Error: {initialBackendError}</AlertDescription>
        </Alert>
      )}
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


          <div ref={canvasContainerRef} className="flex-1 min-h-0 relative">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className={`simulator-canvas absolute inset-0 w-full h-full rounded-lg cursor-pointer ${
                isInitialLoadRef.current ? "loading" : "ready"
              }`}
              style={{
                outline: selectedTowerId !== null
                  ? `1px solid hsla(${TOWER_COLORS[selectedTowerId]?.hue ?? 270},70%,55%,0.55)`
                  : selectedUserId !== null
                  ? "1px solid hsla(45,80%,55%,0.4)"
                  : "none"
              }}
            />
            {isInitialLoadRef.current && (
              <div className="absolute text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Initializing…</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Tower Config Popup (rendered outside canvas flow, fixed position) ── */}
        {selectedTowerId !== null && towerPopupAnchor !== null && (() => {
          const tow = localTowers.find(t => t.id === selectedTowerId);
          if (!tow) return null;
          const color = TOWER_COLORS[selectedTowerId];
          return (
            <TowerConfigPopup
              key={selectedTowerId}
              tower={tow}
              towerHue={color?.hue ?? DEFAULT_TOWER_HUE}
              towerName={color?.name ?? `Tower ${selectedTowerId}`}
              anchorPx={towerPopupAnchor}
              onClose={() => { setSelectedTowerId(null); setTowerPopupAnchor(null); }}
              onChange={handleTowerParamChange}
            />
          );
        })()}

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
                        entry.connectedTowerId != null
                          ? `hsl(${TOWER_COLORS[entry.connectedTowerId]?.hue ?? DEFAULT_TOWER_HUE},70%,50%)`
                          : "hsl(0,0%,55%)"
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
              <LineChart data={distanceChart.curveData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis dataKey="distance" tick={{ fontSize: 9 }}
                  label={{ value: "Distance (m)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Signal", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                {Array.from(new Set(Array.from(liveConnectedTowerByUserId.values()))).sort((a, b) => a - b).map((towerId) => (
                  <Line
                    key={`curve-${towerId}`}
                    type="monotone"
                    dataKey={`tower_${towerId}`}
                    stroke={`hsl(${TOWER_COLORS[towerId]?.hue ?? DEFAULT_TOWER_HUE},75%,58%)`}
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                ))}
                {distanceChart.markers.map((m) => (
                  <Line
                    key={`marker-${m.userId}`}
                    data={[{ distance: m.distance, signal: m.signal }]}
                    type="linear"
                    dataKey="signal"
                    stroke="transparent"
                    dot={{
                      r: 5,
                      fill: `hsl(${TOWER_COLORS[m.towerId]?.hue ?? DEFAULT_TOWER_HUE},85%,70%)`,
                      stroke: "hsl(0,0%,10%)",
                      strokeWidth: 1.2,
                    }}
                    isAnimationActive={false}
                    legendType="none"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Interference / Beam Direction Toggle Panel ───────────────── */}
        <div className="glass-panel p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2 gap-2">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
              {analysisViewMode === "heatmap" ? "2D Interference Heatmap" : "Tower Beam Direction"}
            </h3>
            <button
              type="button"
              onClick={() => setAnalysisViewMode((prev) => (prev === "heatmap" ? "beam" : "heatmap"))}
              className="text-[9px] font-mono px-2 py-1 rounded border border-white/20 bg-white/5 hover:bg-white/10 text-muted-foreground"
            >
              Show {analysisViewMode === "heatmap" ? "Beam Direction" : "Interference Heatmap"}
            </button>
          </div>
          <div className="flex-1 min-h-0 relative">
            {analysisViewMode === "heatmap" ? (
              <HeatmapView
                data={interferenceHeatmapData}
                title=""
              />
            ) : (
              <>
                {isInitialLoadRef.current && (
                  <div className="absolute inset-0 flex items-center justify-center z-10 rounded loading-overlay">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    </div>
                  </div>
                )}
                {activeBeamSeries.length > 0 ? (
                  <BeamPlot
                    beamPattern={{
                      angles:       activeBeamSeries[0].angles,
                      magnitudes:   activeBeamSeries[0].magnitudes,
                      magnitudesDb: activeBeamSeries[0].magnitudesDb ?? activeBeamSeries[0].magnitudes.map(
                        m => 20 * Math.log10(Math.max(m, 1e-6))
                      ),
                    }}
                    beamPatterns={activeBeamSeries.map((s) => ({
                      id: s.towerId,
                      angles: s.angles,
                      magnitudes: s.magnitudes,
                      magnitudesDb: s.magnitudesDb,
                      color: s.color,
                      label: s.label,
                    }))}
                    title=""
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs text-muted-foreground">No beam data</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </MainLayout>
  );
}

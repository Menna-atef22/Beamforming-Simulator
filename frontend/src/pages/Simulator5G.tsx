import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import MainLayout from "@/components/layout/MainLayout";
import ControlPanel from "@/components/ControlPanel";
import { BeamformingParams } from "@/types/beamforming";
import { use5GSimulatorAPI, Simulator5GResponse, Tower, User } from "@/hooks/use5GSimulatorAPI";
import { useDebounce } from "@/hooks/useDebounce";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  LineChart, Line, ReferenceLine,
} from "recharts";
import BeamPlot from "@/components/BeamPlot";
import HeatmapView from "@/components/HeatmapView";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import TowerConfigPopup, { TowerParams } from "@/components/TowerConfigPopup";
import "./Simulator5G.css";

// ─── World-space bounds for user movement ────────────────────────────────────
const WORLD_MIN_X = -14.0;
const WORLD_MAX_X = 14.0;
const WORLD_MIN_Y = -10.0;
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

// ─── Limits ───────────────────────────────────────────────────────────────────
const MIN_TOWERS = 1;
const MAX_TOWERS = 5;
const MIN_USERS = 1;
const MAX_USERS = 4;

// ─── Unique color per tower (hue, saturation%, lightness%) ───────────────────
const TOWER_COLORS: Record<number, { hue: number; name: string }> = {
  1: { hue: 270, name: "Violet" },
  2: { hue: 185, name: "Cyan" },
  3: { hue: 35, name: "Amber" },
  4: { hue: 320, name: "Pink" },
  5: { hue: 160, name: "Teal" },
};
const DEFAULT_TOWER_HUE = 270;

// ─── Unique color per user ────────────────────────────────────────────────────
const USER_COLORS: Record<number, { hue: number; name: string }> = {
  101: { hue: 340, name: "Rose" },
  102: { hue: 150, name: "Green" },
  103: { hue: 45, name: "Gold" },
  104: { hue: 200, name: "Sky" },
};
const DEFAULT_USER_HUE = 340;

// ─── Default tower params factory ────────────────────────────────────────────
const makeTowerParams = (id: number, x: number, y: number) => ({
  id,
  x,
  y,
  coverage_radius_m: 5.0,
  num_elements: 16,
  frequency: 28e9,
  spacing: 0.5,
  wavelength: 1.0,
  steering_angle_deg: 0,
  manual_steering_deg: 0,
  amplitude: 1.0,
  snr_db: 30,
  window_type: "rectangular" as const,
  noise_enabled: true,
  apodization_enabled: false,
  geometry: "linear" as const,
  radius: 50,
});


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
      manual_steering_deg: 0,
      amplitude: defaultParams.amplitude,
      snr_db: defaultParams.snrDb,
      window_type: defaultParams.windowType,
      noise_enabled: defaultParams.noiseEnabled,
      apodization_enabled: defaultParams.apodizationEnabled,
      geometry: defaultParams.geometry ?? "linear",
      radius: Number.isFinite(Number(defaultParams.radius)) ? Number(defaultParams.radius) : 50,
      currentSteeringAngle: defaultParams.steeringAngleDeg ?? 0,
    }))
  );
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedTowerId, setSelectedTowerId] = useState<number | null>(null);
  const [panelTowerId, setPanelTowerId] = useState<number>(1);
  const [towerPopupAnchor, setTowerPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [analysisViewMode, setAnalysisViewMode] = useState<"heatmap" | "beam">("heatmap");

  // ─── Handoff state: {userId: towerId} – updated from API, sent back for hysteresis
  const [currentConnections, setCurrentConnections] = useState<Record<number, number>>({});
  const currentConnectionsRef = useRef<Record<number, number>>({});
  currentConnectionsRef.current = currentConnections;

  // ─── Add / Remove towers ─────────────────────────────────────────────────────
  const addTower = useCallback(() => {
    setLocalTowers(prev => {
      if (prev.length >= MAX_TOWERS) return prev;
      // Pick an id not already used (1-5)
      const usedIds = new Set(prev.map(t => t.id));
      const newId = [1, 2, 3, 4, 5].find(i => !usedIds.has(i)) ?? (prev.length + 1);
      // Spread towers evenly along the bottom band, offset by slot
      const slot = prev.length; // 0-based index
      const xFrac = (slot + 0.5) / MAX_TOWERS; // 0.1 … 0.9
      const x = WORLD_MIN_X + xFrac * (WORLD_MAX_X - WORLD_MIN_X);
      const y = fromCanvasPercent(0, 82).y;
      return [...prev, makeTowerParams(newId, x, y)];
    });
  }, []);

  const removeTower = useCallback(() => {
    setLocalTowers(prev => {
      if (prev.length <= MIN_TOWERS) return prev;
      const removed = prev[prev.length - 1];
      // Deselect if this tower was selected
      setSelectedTowerId(s => s === removed.id ? null : s);
      setTowerPopupAnchor(null);
      setPanelTowerId(p => p === removed.id ? prev[prev.length - 2].id : p);
      // Drop connections to this tower so users reconnect
      setCurrentConnections(c => {
        const next = { ...c };
        for (const [uid, tid] of Object.entries(next)) {
          if (Number(tid) === removed.id) delete next[Number(uid)];
        }
        return next;
      });
      return prev.slice(0, -1);
    });
  }, []);

  // ─── Add / Remove users ──────────────────────────────────────────────────────
  const addUser = useCallback(() => {
    setLocalUsers(prev => {
      if (prev.length >= MAX_USERS) return prev;
      const usedIds = new Set(prev.map(u => u.id));
      const newId = [101, 102, 103, 104].find(i => !usedIds.has(i)) ?? (100 + prev.length + 1);
      // Spawn at map centre with small random offset so they don't stack
      const cx = (WORLD_MIN_X + WORLD_MAX_X) / 2 + (Math.random() - 0.5) * 1.5;
      const cy = (WORLD_MIN_Y + WORLD_MAX_Y) / 2 + (Math.random() - 0.5) * 1.5;
      return [...prev, { id: newId, x: cx, y: cy }];
    });
  }, []);

  const removeUser = useCallback(() => {
    setLocalUsers(prev => {
      if (prev.length <= MIN_USERS) return prev;
      const removed = prev[prev.length - 1];
      setSelectedUserId(s => s === removed.id ? null : s);
      setCurrentConnections(c => { const n = { ...c }; delete n[removed.id]; return n; });
      return prev.slice(0, -1);
    });
  }, []);

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

        // Sync steering angles: update localTowers with the backend's computed
        // auto-steering angles so the Control Panel slider stays in sync.
        // REMOVED: Frontend animation loop now handles this exclusively to prevent oscillation.
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
      // Only intercept movement keys
      const moveKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"];
      if (!moveKeys.includes(e.key)) return;

      // Move selected user if one is active.
      if (selectedUserId !== null) {
        e.preventDefault(); // stop page scroll

        setLocalUsers(prev => prev.map(u => {
          if (u.id !== selectedUserId) return u;
          let nx = u.x;
          let ny = u.y;
          switch (e.key) {
            case "ArrowUp": case "w": case "W": ny += STEP; break;
            case "ArrowDown": case "s": case "S": ny -= STEP; break;
            case "ArrowLeft": case "a": case "A": nx -= STEP; break;
            case "ArrowRight": case "d": case "D": nx += STEP; break;
          }
          nx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, nx));
          ny = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y, ny));
          return { ...u, x: nx, y: ny };
        }));

        triggerSimAfterMove();
        return;
      }

      // Move selected tower if one is active.
      if (selectedTowerId !== null) {
        e.preventDefault(); // stop page scroll

        setLocalTowers(prev => prev.map(t => {
          if (t.id !== selectedTowerId) return t;
          let nx = t.x;
          let ny = t.y;
          switch (e.key) {
            case "ArrowUp": case "w": case "W": ny += STEP; break;
            case "ArrowDown": case "s": case "S": ny -= STEP; break;
            case "ArrowLeft": case "a": case "A": nx -= STEP; break;
            case "ArrowRight": case "d": case "D": nx += STEP; break;
          }
          nx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, nx));
          ny = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y, ny));
          return { ...t, x: nx, y: ny };
        }));

        triggerSimAfterMove();
      }

    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedUserId, selectedTowerId, triggerSimAfterMove]);

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
    frequency: Number((tower as any)?.frequency != null
      ? (tower as any).frequency / 1e9  // convert Hz → GHz for ControlPanel slider
      : defaultParams.frequency),
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
          // Also update manual_steering_deg so the popup slider stays in sync
          // AND currentSteeringAngle so the manual input takes immediate effect on the UI
          return { 
            ...tower, 
            steering_angle_deg: Number(value), 
            manual_steering_deg: Number(value),
            currentSteeringAngle: Number(value) 
          };
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
          return { ...tower, frequency: Number(value) * 1e9 }; // GHz → Hz
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
        towers: result.data.towers || [],
        users: result.data.users || [],
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
    const cy = (e.clientY - rect.top) * scaleY;

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
      const vpY = rect.top + (ty / CANVAS_H) * rect.height - 14;
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

  // ─── Tower drag ─────────────────────────────────────────────────────────
  const draggingTowerIdRef = useRef<number | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toWorldX = (canvasX: number) => {
      const span = Math.max(1e-6, mapViewport.maxX - mapViewport.minX);
      return mapViewport.minX + (canvasX / CANVAS_W) * span;
    };
    const toWorldY = (canvasY: number) => {
      const span = Math.max(1e-6, mapViewport.maxY - mapViewport.minY);
      return mapViewport.minY + (1 - canvasY / CANVAS_H) * span;
    };

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;

      let bestId: number | null = null;
      let bestDist = 22; // px hit radius for drag
      for (const t of localTowersRef.current) {
        const tx = ((t.x - mapViewport.minX) / Math.max(1e-6, mapViewport.maxX - mapViewport.minX)) * CANVAS_W;
        const ty = CANVAS_H - ((t.y - mapViewport.minY) / Math.max(1e-6, mapViewport.maxY - mapViewport.minY)) * CANVAS_H;
        const d = Math.hypot(cx - tx, cy - ty);
        if (d < bestDist) { bestDist = d; bestId = t.id; }
      }
      if (bestId !== null) {
        draggingTowerIdRef.current = bestId;
        e.preventDefault();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const id = draggingTowerIdRef.current;
      if (id === null) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / rect.width;
      const scaleY = CANVAS_H / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const wx = toWorldX(cx);
      const wy = toWorldY(cy);
      setLocalTowers(prev => prev.map(t => t.id === id ? { ...t, x: wx, y: wy } : t));
      // Move popup anchor with the tower
      setTowerPopupAnchor(prev => {
        if (!prev) return prev;
        const vpX = rect.left + (cx / CANVAS_W) * rect.width;
        const vpY = rect.top + (cy / CANVAS_H) * rect.height - 14;
        return { x: vpX, y: vpY };
      });
    };

    const onMouseUp = () => {
      if (draggingTowerIdRef.current !== null) {
        draggingTowerIdRef.current = null;
        triggerSimAfterMove();
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [mapViewport, CANVAS_W, CANVAS_H, triggerSimAfterMove]);

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
      weights: number[],
      isCurved: boolean = false,
      curvatureRadiusLambda: number = 1.4
    ) => {
      const th = (thetaDeg * Math.PI) / 180;
      const th0 = (steeringDeg * Math.PI) / 180;
      const center = (elemCount - 1) / 2;

      let re = 0;
      let im = 0;
      let wSum = 0;
      for (let n = 0; n < elemCount; n++) {
        let w = weights[n] ?? 1;
        let phase = 0;
        
        if (isCurved) {
          const alpha_n = ((n - center) * spacingOverLambda) / curvatureRadiusLambda;
          const x_n = curvatureRadiusLambda * Math.sin(alpha_n);
          const y_n = curvatureRadiusLambda * (1.0 - Math.cos(alpha_n));
          
          const obsPhase = 2 * Math.PI * (x_n * Math.cos(th) + y_n * Math.sin(th));
          const steerPhase = 2 * Math.PI * (x_n * Math.cos(th0) + y_n * Math.sin(th0));
          phase = obsPhase - steerPhase;
          
          const elemFactor = Math.max(0, Math.cos(th - alpha_n));
          w *= elemFactor;
        } else {
          const d = spacingOverLambda;
          const psi = 2 * Math.PI * d * (Math.sin(th) - Math.sin(th0));
          phase = psi * (n - center);
        }

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
      // ─── Real-time Auto-Steering sync ─────────────────────────────────────
      // We compute the physical angle toward the connected user on every frame
      // so the UI sliders and arcs update smoothly without waiting for API ticks.
      let towersChanged = false;
      const nextTowers = localTowers.map(t => {
        const connUser = localUsers.find(u => liveConnectedTowerByUserId.get(u.id) === t.id);
        if (connUser) {
          const dx = connUser.x - t.x;
          const dy = connUser.y - t.y;
          // 0° = North (up), CW positive. atan2(dx, dy) matches this perfectly.
          const angleDeg = Math.atan2(dx, dy) * 180 / Math.PI;
          // Threshold of 0.05 degrees to avoid micro-jitter state updates
          if (Math.abs((t.currentSteeringAngle ?? 0) - angleDeg) > 0.05) {
            towersChanged = true;
            return { ...t, currentSteeringAngle: angleDeg };
          }
        } else if (t.currentSteeringAngle !== undefined && t.currentSteeringAngle !== t.steering_angle_deg) {
           // If user disconnected, revert currentSteeringAngle to the manual setting (which was synced via slider)
           towersChanged = true;
           return { ...t, currentSteeringAngle: t.steering_angle_deg };
        }
        return t;
      });

      if (towersChanged) {
        setLocalTowers(nextTowers);
      }

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
              facing: a,
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
              facing: Math.atan2(beamDirX, -beamDirY),
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
              dotHue = USER_COLORS[alloc.user_id]?.hue ?? DEFAULT_USER_HUE;
              dotAlpha = 1.0;
            }
          }

          // Draw wave arc representing the element, perpendicular to its facing direction
          const arcSpread = 0.85; // radians (how wide the wave is)
          const canvasFacing = (e as any).facing - Math.PI / 2; // Convert 0=Up to canvas standard 0=Right
          ctx.strokeStyle = `hsla(${dotHue},85%,72%,${dotAlpha})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(e.x, e.y, hasAllocations ? 3.5 : 2.8, canvasFacing - arcSpread, canvasFacing + arcSpread);
          ctx.stroke();

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
        const subArrayCenterByUserId = new Map<number, { x: number; y: number }>();
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

        // ── Alpha/Beta/Gamma Sectors ────────────────────────────────────────────────
        const coverageRadiusM = drawCoverageRadiusByTowerId.get(tower.id) ?? ((tower as any).coverage_radius_m ?? 5.0);
        const radiusPx = coverageRadiusM * mToPx;

        // Draw colored wedge zones
        const sectors = [
          { name: "Alpha", start: 0, end: 120, color: "hsla(210, 70%, 50%, 0.08)", label: "α", labelDeg: 60 },
          { name: "Beta", start: 120, end: 240, color: "hsla(120, 70%, 50%, 0.08)", label: "β", labelDeg: 180 },
          { name: "Gamma", start: 240, end: 360, color: "hsla(0, 70%, 50%, 0.08)", label: "γ", labelDeg: 300 },
        ];

        sectors.forEach(s => {
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          // Convert compass degrees (0=North, CW) to canvas radians (0=East, CW)
          const startRad = (s.start - 90) * Math.PI / 180;
          const endRad = (s.end - 90) * Math.PI / 180;
          ctx.arc(tx, ty, radiusPx, startRad, endRad);
          ctx.closePath();
          ctx.fillStyle = s.color;
          ctx.fill();
        });

        // Sector boundary lines
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = `hsla(${hue},50%,65%,0.35)`;
        ctx.lineWidth = 1.2;
        [0, 120, 240].forEach(deg => {
          const rad = (deg - 90) * Math.PI / 180;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(tx + Math.cos(rad) * radiusPx, ty + Math.sin(rad) * radiusPx);
          ctx.stroke();
        });
        ctx.setLineDash([]);

        // Sector Labels (α, β, γ)
        ctx.font = "italic 12px serif";
        ctx.textAlign = "center";
        ctx.fillStyle = `hsla(${hue},60%,90%,0.6)`;
        sectors.forEach(s => {
          const r = (s.labelDeg - 90) * Math.PI / 180;
          const labelDist = radiusPx * 0.65;
          ctx.fillText(s.label, tx + Math.cos(r) * labelDist, ty + Math.sin(r) * labelDist + 4);
        });

        // ── Steering and Lobe logic (Multi-Beam) ────────────────────────────────────
        const towerAllocs = elementAllocsByTowerId.get(tower.id) ?? [];
        const isAutoSteering = towerAllocs.length > 0;

        let statusLine1: string;
        let statusLine2: string | null = null;

        if (towerAllocs.length >= 2) {
          statusLine1 = towerAllocs
            .map(a => `${a.num_elements} elements → U${a.user_id}`)
            .join(", ");
        } else if (isAutoSteering) {
          const alloc = towerAllocs[0];
          const displayDeg = tower.currentSteeringAngle ?? alloc.angle_deg ?? 0;
          statusLine1 = `θ ${displayDeg.toFixed(1)}° AUTO`;
          const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
          const deltaPhiRad = 2 * Math.PI * towerSpacingLambda * Math.sin((displayDeg * Math.PI) / 180);
          statusLine2 = `Δφ ${deltaPhiRad.toFixed(2)} rad`;
        } else {
          const displayDeg = tower.currentSteeringAngle ?? tower.manual_steering_deg ?? 0;
          statusLine1 = `θ ${displayDeg.toFixed(1)}° MANUAL`;
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

        // Draw Lobe for EACH user allocation (Independent sub-arrays)
        for (const alloc of towerAllocs) {
          const user = localUsers.find(u => u.id === alloc.user_id);
          if (!user) continue;

          // Beams originate exactly from the tower's center position
          const lx = tx;
          const ly = ty;

          const ux = toCanvasX(user.x);
          const uy = toCanvasY(user.y);
          const dxC = ux - lx;
          const dyC = uy - ly;
          const distPx = Math.hypot(dxC, dyC);
          const canvasAngle = Math.atan2(dxC, -dyC);
          const lobeMaxRadiusPx = distPx;

          const elemN = Math.max(1, Math.round(alloc.num_elements));
          const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
          const towerWindowType = String((tower as any).window_type ?? "rectangular");
          const towerApodizationEnabled = Boolean((tower as any).apodization_enabled ?? false);
          const weights = buildWindowWeights(elemN, towerWindowType, towerApodizationEnabled);
          
          const isCurved = ((tower as any).geometry ?? "linear") === "curved";
          const curvatureInput = Number((tower as any).radius ?? 1.4);

          const points: Array<{ x: number; y: number }> = [];
          const baseLobeRadiusPx = 0;
          for (const rel of lobeAngles) {
            const af = computeArrayFactorNorm(rel, 0, elemN, towerSpacingLambda, weights, isCurved, curvatureInput);
            const r = baseLobeRadiusPx + lobeMaxRadiusPx * Math.pow(af, 0.92);
            const a = (rel * Math.PI) / 180;
            points.push({ x: Math.sin(a) * r, y: -Math.cos(a) * r });
          }

          if (points.length > 1) {
            ctx.save();
            ctx.translate(lx, ly);
            ctx.rotate(canvasAngle);

            // Draw the gain lobe pattern — brighter when apodization shows clear sidelobe suppression
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (const p of points) ctx.lineTo(p.x, p.y);
            ctx.closePath();

            let beamHue = 210; // Default to Alpha (blue)
            const sec = String(alloc.sector || "alpha").toLowerCase();
            if (sec === "alpha") beamHue = 210;
            else if (sec === "beta") beamHue = 120;
            else if (sec === "gamma") beamHue = 0;

            // Apodization ON: show lobe shape more clearly so sidelobe suppression is visible
            const lobeFillAlpha = towerApodizationEnabled ? 0.12 : 0.06;
            const lobeStrokeAlpha = towerApodizationEnabled ? 0.45 : 0.2;
            ctx.fillStyle = `hsla(${beamHue},88%,62%,${lobeFillAlpha})`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${beamHue},92%,70%,${lobeStrokeAlpha})`;
            ctx.lineWidth = towerApodizationEnabled ? 1.5 : 0.8;
            ctx.stroke();

            // ── Main Beam: Straight Bold Line ───────────────────────────────────────
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(ux, uy);

            // Outer glow / shadow
            ctx.shadowBlur = 8;
            ctx.shadowColor = `hsla(${beamHue},90%,65%,0.6)`;
            ctx.strokeStyle = `hsla(${beamHue},95%,75%,0.95)`;
            ctx.lineWidth = 3.5;
            ctx.lineCap = "round";
            ctx.stroke();

            // Inner core
            ctx.shadowBlur = 0;
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.restore();
          }
        }

        // Draw manual fallback beam if NO users connected
        if (!isAutoSteering) {
          const displayDeg = tower.currentSteeringAngle ?? tower.manual_steering_deg ?? 0;
          const canvasAngle = (displayDeg * Math.PI) / 180;
          const coverPx = (drawCoverageRadiusByTowerId.get(tower.id) ?? 4.5) * mToPx;
          const lobeMaxRadiusPx = Math.max(26, Math.min(coverPx, CANVAS_W * 0.2));

          const lx = tx;
          const ly = ty;

          const elemN = Math.max(2, Math.min(64, Math.round(Number((tower as any).num_elements ?? 16))));
          const towerSpacingLambda = Number((tower as any).spacing ?? 0.5);
          const weights = buildWindowWeights(elemN, "rectangular", false);

          const isCurved = ((tower as any).geometry ?? "linear") === "curved";
          const curvatureInput = Number((tower as any).radius ?? 1.4);

          const points: Array<{ x: number; y: number }> = [];
          const baseLobeRadiusPx = 0;
          for (const rel of lobeAngles) {
            const af = computeArrayFactorNorm(rel, 0, elemN, towerSpacingLambda, weights, isCurved, curvatureInput);
            const r = baseLobeRadiusPx + lobeMaxRadiusPx * Math.pow(af, 0.92);
            const a = (rel * Math.PI) / 180;
            points.push({ x: Math.sin(a) * r, y: -Math.cos(a) * r });
          }

          if (points.length > 1) {
            ctx.save();
            ctx.translate(lx, ly);
            ctx.rotate(canvasAngle);

            // Faint lobe background for manual
            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (const p of points) ctx.lineTo(p.x, p.y);
            ctx.closePath();
            ctx.fillStyle = `hsla(${hue},88%,62%,0.04)`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${hue},92%,70%,0.15)`;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Straight manual beam
            const targetX = Math.sin(0) * lobeMaxRadiusPx; // 0 because we rotated by canvasAngle
            const targetY = -Math.cos(0) * lobeMaxRadiusPx;

            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(targetX, targetY);
            ctx.strokeStyle = `hsla(${hue},90%,75%,0.5)`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.restore();
          }
        }

        ctx.fillStyle = `hsl(${hue},70%,88%)`;
        ctx.font = "bold 10px JetBrains Mono, monospace";
        ctx.textAlign = "center";
        ctx.fillText(`T${tower.id}`, tx, ty + 22);

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
        ctx.strokeStyle = isAutoSteering ? `hsla(140,65%,50%,0.65)` : `hsla(${hue},70%,65%,0.65)`;
        ctx.lineWidth = 1;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        ctx.textAlign = "left";
        ctx.fillStyle = isAutoSteering ? `hsla(140,80%,80%,0.95)` : `hsla(${hue},85%,82%,0.95)`;
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
    // Bidirectional steering sync: when manual_steering_deg changes in the
    // popup, promote it to steering_angle_deg so the Control Panel slider
    // stays in sync (towerToControlParams reads steering_angle_deg).
    const synced: TowerParams = {
      ...updated,
      steering_angle_deg: updated.manual_steering_deg ?? updated.steering_angle_deg,
      currentSteeringAngle: updated.manual_steering_deg ?? updated.steering_angle_deg,
    };
    setLocalTowers(prev => prev.map(t => t.id === synced.id ? synced : t));
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

  const userSignalData = useMemo(() => {
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

      let beamHue = 210; // Default Alpha
      if (connectedTowerId != null) {
        const allocs = elementAllocsByTowerId.get(connectedTowerId) ?? [];
        const alloc = allocs.find((a) => Number(a.user_id) === u.id);
        const sec = String(alloc?.sector || "alpha").toLowerCase();
        if (sec === "alpha") beamHue = 210;
        else if (sec === "beta") beamHue = 120;
        else if (sec === "gamma") beamHue = 0;
      }

      return {
        id: u.id,
        name: `User ${u.id}`,
        // Preserve dynamic range so bars don't disappear from aggressive rounding.
        signal: parseFloat(signal.toFixed(6)),
        connectedTowerId,
        beamHue,
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

    const elementEmitters: Array<{
      x: number;
      y: number;
      amp: number;
      phase: number;
      k: number;
      facingAngle: number;
      isCurved: boolean;
    }> = [];

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
      const beamAxisAngle = Math.atan2(beamDirY, beamDirX);

      const isCurved = ((tower as any).geometry ?? "linear") === "curved";
      const curvatureRadiusMeters = Number((tower as any).radius ?? 1.4) * wavelength;
      const arcLength = spacingMeters * (nElem - 1);
      const totalSweep = arcLength / Math.max(1e-6, curvatureRadiusMeters);
      const a0 = -totalSweep / 2;

      for (let i = 0; i < nElem; i++) {
        const t = nElem === 1 ? 0 : i / (nElem - 1);
        const alpha_n = a0 + t * totalSweep;
        let localX = 0; // lateral axis (array tangent)
        let localY = 0; // forward axis (beam direction)
        let ex = tower.x;
        let ey = tower.y;
        
        if (isCurved) {
          // Physical curved coordinates relative to tower
          localX = curvatureRadiusMeters * Math.sin(alpha_n);
          localY = curvatureRadiusMeters * (1.0 - Math.cos(alpha_n));
          
          // Rotate local (lateral, forward) coordinates into world space.
          ex = tower.x + localX * axisX + localY * beamDirX;
          ey = tower.y + localX * axisY + localY * beamDirY;
        } else {
          localX = (i - centerOffset) * spacingMeters;
          localY = 0;
          ex = tower.x + axisX * localX;
          ey = tower.y + axisY * localX;
        }

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

        // Steering phase from local element position projection:
        // phi_n = -k * (x_n*u_lateral + y_n*u_forward)
        const steerLateral = steerX * axisX + steerY * axisY;
        const steerForward = steerX * beamDirX + steerY * beamDirY;
        const phase = -kWave * (localX * steerLateral + localY * steerForward);
        const facingAngle = isCurved ? (beamAxisAngle + alpha_n) : beamAxisAngle;
        const elemAmp = amplitude * ((weights[i] ?? 1) / wNorm);
        elementEmitters.push({ x: ex, y: ey, amp: elemAmp, phase, k: kWave, facingAngle, isCurved: ((tower as any).geometry ?? "linear") === "curved" });
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
          const dx = x - em.x;
          const dy = y - em.y;
          const r = Math.max(kEpsilon, Math.hypot(dx, dy));
          const phase = (em.k * r) + em.phase;
          
          let elemFactor = 1.0;
          if (em.isCurved) {
             const angleToPixel = Math.atan2(dy, dx);
             elemFactor = Math.max(0, Math.cos(angleToPixel - em.facingAngle));
          }
          
          const a = (em.amp * elemFactor) / Math.sqrt(r);
          real += a * Math.cos(phase);
          imag += a * Math.sin(phase);
        }
        const intensity = real * real + imag * imag;
        row.push(intensity);
        flatVals.push(intensity);
      }
      rawGrid.push(row);
    }

    // Percentile normalization (5th to 95th) for robust contrast
    flatVals.sort((a, b) => a - b);
    const minIdx = Math.floor(0.05 * (flatVals.length - 1));
    const maxIdx = Math.floor(0.95 * (flatVals.length - 1));
    const robustMin = flatVals[minIdx];
    const robustMax = Math.max(robustMin + 1e-12, flatVals[maxIdx]);

    const range = robustMax - robustMin;
    const finalGrid = rawGrid.map(row => row.map(v => {
      // Scale and clamp to [0, 1]
      return Math.max(0, Math.min(1, (v - robustMin) / range));
    }));

    return {
      grid: finalGrid,
      xRange,
      yRange,
      maxVal: 1.0,
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
    const SAMPLE_COUNT = 50;
    const minDist = 0.1;

    // Find max coverage radius among ALL local towers
    const maxRadius = Math.max(
      ...localTowers.map(t => towerCoverageRadiusByTowerId.get(t.id) ?? (t as any).coverage_radius_m ?? 5.0),
      10 // fallback floor
    );

    const connectedUsers = localUsers.filter(u => liveConnectedTowerByUserId.has(u.id));
    if (connectedUsers.length === 0) {
      return {
        curveData: [] as Array<Record<string, number>>,
        markers: [] as Array<{ userId: number; towerId: number; distance: number; signal: number }>
      };
    }

    const curveData = Array.from({ length: SAMPLE_COUNT }, (_, i) => {
      const d = minDist + (i / (SAMPLE_COUNT - 1)) * (maxRadius - minDist);
      const row: Record<string, number> = { distance: parseFloat(d.toFixed(1)) };

      for (const u of connectedUsers) {
        const towerId = liveConnectedTowerByUserId.get(u.id);
        if (towerId == null) continue;
        const tower = localTowers.find(t => t.id === towerId);
        if (!tower) continue;

        const allocs = elementAllocsByTowerId.get(towerId) ?? [];
        const alloc = allocs.find(a => Number(a.user_id) === u.id);
        const allocFraction = alloc?.fraction ?? (1.0 / (allocs.length || 1));

        const signal = allocFraction / (d * d);
        row[`user_${u.id}`] = parseFloat(signal.toFixed(6));
      }
      return row;
    });

    const mToPxX = CANVAS_W / Math.max(1e-6, mapViewport.maxX - mapViewport.minX);
    const mToPxY = CANVAS_H / Math.max(1e-6, mapViewport.maxY - mapViewport.minY);
    const mToPx = (mToPxX + mToPxY) / 2;

    const markers = connectedUsers
      .map((u) => {
        const towerId = liveConnectedTowerByUserId.get(u.id)!;
        const tower = localTowers.find((t) => t.id === towerId)!;
        
        // Convert world coordinates to canvas pixels
        const spanX = Math.max(1e-6, mapViewport.maxX - mapViewport.minX);
        const spanY = Math.max(1e-6, mapViewport.maxY - mapViewport.minY);
        const uxCanvas = ((u.x - mapViewport.minX) / spanX) * CANVAS_W;
        const txCanvas = ((tower.x - mapViewport.minX) / spanX) * CANVAS_W;
        const uyCanvas = CANVAS_H - ((u.y - mapViewport.minY) / spanY) * CANVAS_H;
        const tyCanvas = CANVAS_H - ((tower.y - mapViewport.minY) / spanY) * CANVAS_H;

        // Calculate pixel distance and convert to meters using canvas scale
        const distPx = Math.hypot(uxCanvas - txCanvas, uyCanvas - tyCanvas);
        const d = Math.max(minDist, distPx / mToPx);

        const allocs = elementAllocsByTowerId.get(towerId) ?? [];
        const alloc = allocs.find((a) => Number(a.user_id) === u.id);
        const allocFraction = alloc?.fraction ?? (1.0 / (allocs.length || 1));
        
        let beamHue = 210;
        const sec = String(alloc?.sector || "alpha").toLowerCase();
        if (sec === "alpha") beamHue = 210;
        else if (sec === "beta") beamHue = 120;
        else if (sec === "gamma") beamHue = 0;

        return {
          userId: u.id,
          towerId,
          distance: parseFloat(d.toFixed(2)),
          signal: parseFloat((allocFraction / (d * d)).toFixed(6)),
          beamHue,
        };
      });

    return { curveData, markers };
  }, [localUsers, localTowers, liveConnectedTowerByUserId, elementAllocsByTowerId, towerCoverageRadiusByTowerId, mapViewport, CANVAS_W, CANVAS_H]);

  const panelTower = useMemo(
    () => localTowers.find((t) => t.id === panelTowerId) ?? null,
    [localTowers, panelTowerId],
  );

  const fiveGControlExtras = useMemo(() => (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Coverage Radius
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {Number(panelTower?.coverage_radius_m ?? 5).toFixed(1)} m
          </span>
        </div>
        <Slider
          value={[Number(panelTower?.coverage_radius_m ?? 5)]}
          min={1}
          max={12}
          step={0.1}
          onValueChange={([v]) => {
            setLocalTowers((prev) =>
              prev.map((t) =>
                t.id === panelTowerId ? { ...t, coverage_radius_m: v } : t,
              ),
            );
          }}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Heatmap Resolution
          </Label>
          <span className="text-xs font-mono text-foreground tabular-nums">
            {Math.round(Number(params.gridSize ?? 80))}
          </span>
        </div>
        <Slider
          value={[Math.round(Number(params.gridSize ?? 80))]}
          min={40}
          max={180}
          step={10}
          onValueChange={([v]) => updateParam("gridSize", Math.round(v))}
        />
      </div>
    </div>
  ), [panelTower, panelTowerId, params.gridSize, updateParam]);

  const panelControl = useMemo(() => (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border/50 bg-card/70">
        {/* Tower selector header with +/- */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Tower Selector</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={removeTower}
              disabled={localTowers.length <= MIN_TOWERS}
              className="w-5 h-5 rounded border text-[13px] font-mono leading-none flex items-center justify-center transition-colors"
              style={{
                borderColor: localTowers.length <= MIN_TOWERS ? "hsla(0,0%,35%,0.4)" : "hsla(0,65%,60%,0.55)",
                color: localTowers.length <= MIN_TOWERS ? "hsl(0,0%,40%)" : "hsl(0,70%,72%)",
                background: localTowers.length <= MIN_TOWERS ? "hsla(0,0%,15%,0.3)" : "hsla(0,50%,25%,0.3)",
              }}
              title="Remove last tower"
            >−</button>
            <span className="text-[9px] font-mono text-muted-foreground tabular-nums w-8 text-center">
              {localTowers.length}/{MAX_TOWERS}
            </span>
            <button
              type="button"
              onClick={addTower}
              disabled={localTowers.length >= MAX_TOWERS}
              className="w-5 h-5 rounded border text-[13px] font-mono leading-none flex items-center justify-center transition-colors"
              style={{
                borderColor: localTowers.length >= MAX_TOWERS ? "hsla(0,0%,35%,0.4)" : "hsla(140,65%,45%,0.55)",
                color: localTowers.length >= MAX_TOWERS ? "hsl(0,0%,40%)" : "hsl(140,70%,68%)",
                background: localTowers.length >= MAX_TOWERS ? "hsla(0,0%,15%,0.3)" : "hsla(140,50%,22%,0.3)",
              }}
              title="Add tower"
            >+</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {localTowers.map((t) => {
            const selected = panelTowerId === t.id;
            const hue = TOWER_COLORS[t.id]?.hue ?? DEFAULT_TOWER_HUE;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setPanelTowerId(t.id)}
                className="h-8 px-3 rounded-md border text-[11px] font-mono font-semibold transition-colors"
                style={{
                  borderColor: selected ? `hsla(${hue},70%,60%,0.9)` : "hsla(240,10%,35%,0.6)",
                  backgroundColor: selected ? `hsla(${hue},70%,42%,0.35)` : "hsla(240,10%,18%,0.55)",
                  color: selected ? `hsl(${hue},80%,85%)` : "hsl(240,8%,78%)",
                }}
              >{`T${t.id}`}</button>
            );
          })}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ControlPanel 
          params={{ 
            ...params, 
            autoSteer: localUsers.some(u => liveConnectedTowerByUserId.get(u.id) === panelTowerId) 
          }} 
          onParamChange={updateParam}
          hiddenSliders={{
            amplitude: true,
            profileDepth: true,
          }}
          extra={fiveGControlExtras}
        />
      </div>
    </div>
  ), [panelTowerId, params, localTowers, localUsers, liveConnectedTowerByUserId, addTower, removeTower, fiveGControlExtras]);

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
          {/* Header row: title + add/remove controls */}
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground">
              5G Coverage Map — {localTowers.length} Tower{localTowers.length !== 1 ? "s" : ""} · {localUsers.length} User{localUsers.length !== 1 ? "s" : ""}
            </h3>
            {/* +/- buttons for towers and users */}
            <div className="flex items-center gap-2">
              {/* Towers */}
              <div className="flex items-center gap-1">
                <span className="text-[8px] font-mono text-muted-foreground">T</span>
                <button type="button" onClick={removeTower} disabled={localTowers.length <= MIN_TOWERS}
                  className="w-5 h-5 rounded border text-[12px] font-mono leading-none flex items-center justify-center"
                  style={{ borderColor: localTowers.length <= MIN_TOWERS ? "hsla(0,0%,30%,0.4)" : "hsla(0,65%,55%,0.6)", color: localTowers.length <= MIN_TOWERS ? "hsl(0,0%,38%)" : "hsl(0,70%,68%)", background: "hsla(0,0%,12%,0.5)" }}
                  title="Remove tower">−</button>
                <span className="text-[9px] font-mono text-muted-foreground tabular-nums">{localTowers.length}</span>
                <button type="button" onClick={addTower} disabled={localTowers.length >= MAX_TOWERS}
                  className="w-5 h-5 rounded border text-[12px] font-mono leading-none flex items-center justify-center"
                  style={{ borderColor: localTowers.length >= MAX_TOWERS ? "hsla(0,0%,30%,0.4)" : "hsla(140,65%,42%,0.6)", color: localTowers.length >= MAX_TOWERS ? "hsl(0,0%,38%)" : "hsl(140,70%,65%)", background: "hsla(0,0%,12%,0.5)" }}
                  title="Add tower">+</button>
              </div>
              <span className="text-muted-foreground text-[8px]">·</span>
              {/* Users */}
              <div className="flex items-center gap-1">
                <span className="text-[8px] font-mono text-muted-foreground">U</span>
                <button type="button" onClick={removeUser} disabled={localUsers.length <= MIN_USERS}
                  className="w-5 h-5 rounded border text-[12px] font-mono leading-none flex items-center justify-center"
                  style={{ borderColor: localUsers.length <= MIN_USERS ? "hsla(0,0%,30%,0.4)" : "hsla(30,65%,55%,0.6)", color: localUsers.length <= MIN_USERS ? "hsl(0,0%,38%)" : "hsl(30,80%,68%)", background: "hsla(0,0%,12%,0.5)" }}
                  title="Remove user">−</button>
                <span className="text-[9px] font-mono text-muted-foreground tabular-nums">{localUsers.length}</span>
                <button type="button" onClick={addUser} disabled={localUsers.length >= MAX_USERS}
                  className="w-5 h-5 rounded border text-[12px] font-mono leading-none flex items-center justify-center"
                  style={{ borderColor: localUsers.length >= MAX_USERS ? "hsla(0,0%,30%,0.4)" : "hsla(200,65%,45%,0.6)", color: localUsers.length >= MAX_USERS ? "hsl(0,0%,38%)" : "hsl(200,75%,68%)", background: "hsla(0,0%,12%,0.5)" }}
                  title="Add user">+</button>
              </div>
            </div>
          </div>

          {/* Keyboard hint + dynamic color legend */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {selectedUserId !== null ? (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                ✦ U{selectedUserId} selected — W/A/S/D or ↑↓←→ to move
              </span>
            ) : selectedTowerId !== null ? (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30">
                ✦ T{selectedTowerId} selected — W/A/S/D or ↑↓←→ to move
              </span>
            ) : (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground border border-white/10">
                Click a user (●) or tower (▲) to select · W/A/S/D or arrows to move
              </span>
            )}
            {/* Dynamic tower color swatches */}
            <div className="flex items-center gap-1.5 ml-auto flex-wrap">
              {localTowers.map(t => {
                const hue = TOWER_COLORS[t.id]?.hue ?? DEFAULT_TOWER_HUE;
                const name = TOWER_COLORS[t.id]?.name ?? `T${t.id}`;
                return (
                  <span key={t.id}
                    className="flex items-center gap-1 text-[8px] font-mono px-1.5 py-0.5 rounded border"
                    style={{ color: `hsl(${hue},70%,80%)`, borderColor: `hsla(${hue},65%,55%,0.5)`, backgroundColor: `hsla(${hue},70%,30%,0.2)` }}
                  >
                    <span className="inline-block rounded-full border" style={{ width: 8, height: 8, backgroundColor: `hsl(${hue},68%,52%)`, borderColor: `hsl(${hue},70%,75%)` }} />
                    {`T${t.id} · ${name}`}
                  </span>
                );
              })}
            </div>
          </div>


          <div ref={canvasContainerRef} className="flex-1 min-h-0 relative">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className={`simulator-canvas absolute inset-0 w-full h-full rounded-lg cursor-pointer ${isInitialLoadRef.current ? "loading" : "ready"
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
              allocations={(elementAllocsByTowerId.get(selectedTowerId) ?? []).map(a => ({
                user_id: a.user_id,
                num_elements: a.num_elements,
                sector: a.sector,
                userHue: USER_COLORS[a.user_id]?.hue ?? DEFAULT_USER_HUE
              }))}
              isAutoSteering={localUsers.some(
                (u) => liveConnectedTowerByUserId.get(u.id) === selectedTowerId,
              )}
              liveSteeringDeg={(() => {
                const connUser = localUsers.find(
                  (u) => liveConnectedTowerByUserId.get(u.id) === selectedTowerId
                );
                if (!connUser) return undefined;
                const twr = localTowers.find(t => t.id === selectedTowerId);
                if (!twr) return undefined;
                const dx = connUser.x - twr.x;
                const dy = connUser.y - twr.y;
                // Convert to degrees: 0° = North (up), CW positive — matches steering convention
                const angleDeg = Math.atan2(dx, dy) * 180 / Math.PI;
                return parseFloat(angleDeg.toFixed(1));
              })()}
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
                          ? `hsl(${entry.beamHue},90%,65%)`
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
              <LineChart data={distanceChart.curveData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }} isAnimationActive={false}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
                <XAxis 
                  dataKey="distance" 
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fontSize: 9 }}
                  label={{ value: "Distance (m)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} 
                />
                <YAxis tick={{ fontSize: 9 }}
                  label={{ value: "Signal", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
                {localUsers.filter(u => liveConnectedTowerByUserId.has(u.id)).map((u) => {
                  const m = distanceChart.markers.find(m => m.userId === u.id);
                  const hue = m?.beamHue ?? 210;
                  return (
                    <Line
                      key={`curve-${u.id}`}
                      type="monotone"
                      dataKey={`user_${u.id}`}
                      stroke={`hsl(${hue},75%,58%)`}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  );
                })}
                {distanceChart.markers.map((m) => (
                  <ReferenceLine
                    key={`v-line-${m.userId}`}
                    x={m.distance}
                    stroke={`hsla(${m.beamHue},80%,60%,0.4)`}
                    strokeDasharray="4 4"
                    isAnimationActive={false}
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
                      fill: `hsl(${m.beamHue},85%,70%)`,
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
                      angles: activeBeamSeries[0].angles,
                      magnitudes: activeBeamSeries[0].magnitudes,
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

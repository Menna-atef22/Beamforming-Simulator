/**
 * 5G Simulator Module
 *
 * - 3 towers on a 2D grid
 * - 2 movable users (arrow keys + tab to switch)
 * - Beam connectivity based on distance
 * - Auto beam steering toward users
 * - Signal strength visualization
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { ParameterSlider } from "@/components/ParameterSlider";
import { computeArrayFactor, type WindowType } from "@/lib/beamforming-engine";

interface Tower {
  x: number;
  y: number;
  numElements: number;
  elementSpacing: number;
  steeringAngle: number;
  frequency: number;
  windowType: WindowType;
  influenceRadius: number;
}

interface User {
  x: number;
  y: number;
  label: string;
}

const CANVAS_W = 600;
const CANVAS_H = 500;
const MOVE_STEP = 5;

// Frequency for 5G: ~3.5 GHz, distances in meters scale
const INITIAL_TOWERS: Tower[] = [
  {
    x: 150,
    y: 100,
    numElements: 8,
    elementSpacing: 0.5,
    steeringAngle: 0,
    frequency: 3.5e9,
    windowType: "hamming",
    influenceRadius: 200,
  },
  {
    x: 450,
    y: 100,
    numElements: 8,
    elementSpacing: 0.5,
    steeringAngle: 0,
    frequency: 3.5e9,
    windowType: "hamming",
    influenceRadius: 200,
  },
  {
    x: 300,
    y: 400,
    numElements: 8,
    elementSpacing: 0.5,
    steeringAngle: 0,
    frequency: 3.5e9,
    windowType: "hamming",
    influenceRadius: 200,
  },
];

const INITIAL_USERS: User[] = [
  { x: 200, y: 300, label: "User A" },
  { x: 400, y: 250, label: "User B" },
];

export function FiveGSimulator() {
  const [towers, setTowers] = useState<Tower[]>(INITIAL_TOWERS);
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [activeUser, setActiveUser] = useState(0);
  const [snr, setSnr] = useState(100);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keyboard control for user movement
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        setActiveUser((prev) => (prev + 1) % users.length);
        return;
      }
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, -MOVE_STEP],
        ArrowDown: [0, MOVE_STEP],
        ArrowLeft: [-MOVE_STEP, 0],
        ArrowRight: [MOVE_STEP, 0],
      };
      const d = deltas[e.key];
      if (d) {
        e.preventDefault();
        setUsers((prev) =>
          prev.map((u, i) =>
            i === activeUser
              ? {
                  ...u,
                  x: Math.max(10, Math.min(CANVAS_W - 10, u.x + d[0])),
                  y: Math.max(10, Math.min(CANVAS_H - 10, u.y + d[1])),
                }
              : u,
          ),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeUser, users.length]);

  // Auto-steer towers toward users & render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Auto-steer: each tower steers toward the closest user
    const updatedTowers = towers.map((tower) => {
      let closestAngle = 0;
      let closestDist = Infinity;
      for (const user of users) {
        const dx = user.x - tower.x;
        const dy = user.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist && dist < tower.influenceRadius) {
          closestDist = dist;
          closestAngle = Math.atan2(dx, dy) * (180 / Math.PI);
        }
      }
      return {
        ...tower,
        steeringAngle: closestDist < tower.influenceRadius ? closestAngle : tower.steeringAngle,
      };
    });

    // Clear
    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = "#151d30";
    ctx.lineWidth = 1;
    for (let x = 0; x < CANVAS_W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }

    // Draw influence radius
    updatedTowers.forEach((tower) => {
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, tower.influenceRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(77, 166, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Draw beams from towers to users in range
    updatedTowers.forEach((tower) => {
      users.forEach((user) => {
        const dx = user.x - tower.x;
        const dy = user.y - tower.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > tower.influenceRadius) return;

        // Signal strength based on distance and array factor
        const angle = Math.atan2(dx, dy) * (180 / Math.PI);
        const af = computeArrayFactor(
          tower.numElements,
          tower.elementSpacing,
          tower.steeringAngle,
          angle,
          tower.windowType,
        );
        const distanceFactor = 1 - dist / tower.influenceRadius;
        const signalStrength = af * distanceFactor;
        const noiseEffect = snr > 0 ? 1 / (1 + 1 / snr) : 0;
        const finalStrength = signalStrength * noiseEffect;

        // Draw beam
        const gradient = ctx.createLinearGradient(tower.x, tower.y, user.x, user.y);
        gradient.addColorStop(0, `rgba(77, 166, 255, ${0.8 * finalStrength})`);
        gradient.addColorStop(1, `rgba(77, 255, 166, ${0.4 * finalStrength})`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2 + finalStrength * 4;
        ctx.beginPath();
        ctx.moveTo(tower.x, tower.y);
        ctx.lineTo(user.x, user.y);
        ctx.stroke();

        // Signal strength label at midpoint
        ctx.fillStyle = "rgba(200,220,255,0.7)";
        ctx.font = "10px monospace";
        ctx.fillText(
          `${(finalStrength * 100).toFixed(0)}%`,
          (tower.x + user.x) / 2 + 5,
          (tower.y + user.y) / 2 - 5,
        );
      });
    });

    // Draw towers
    updatedTowers.forEach((tower, i) => {
      ctx.fillStyle = "#4da6ff";
      ctx.beginPath();
      // Tower icon: triangle
      ctx.moveTo(tower.x, tower.y - 14);
      ctx.lineTo(tower.x - 10, tower.y + 6);
      ctx.lineTo(tower.x + 10, tower.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8899bb";
      ctx.font = "10px monospace";
      ctx.fillText(
        `T${i + 1} [${tower.numElements}el, ${tower.steeringAngle.toFixed(0)}°]`,
        tower.x - 30,
        tower.y + 20,
      );
    });

    // Draw users
    users.forEach((user, i) => {
      const isActive = i === activeUser;
      ctx.fillStyle = isActive ? "#ff6b6b" : "#ffaa44";
      ctx.beginPath();
      ctx.arc(user.x, user.y, isActive ? 8 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ccddff";
      ctx.font = "11px monospace";
      ctx.fillText(user.label + (isActive ? " ◄" : ""), user.x + 12, user.y + 4);
    });

    // Update tower state for display
    setTowers(updatedTowers);
  }, [users, activeUser, snr]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-full">
      <div className="sim-control-panel p-4 space-y-4 lg:w-64 shrink-0 overflow-y-auto">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          5G Controls
        </h3>
        <p className="text-xs text-muted-foreground">
          Arrow keys to move user. Tab to switch user.
        </p>
        <ParameterSlider label="SNR" value={snr} min={0} max={1000} step={1} onChange={setSnr} />

        <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
          <p className="font-semibold text-foreground">Tower Parameters</p>
          {towers.map((t, i) => (
            <div key={i} className="bg-accent/30 rounded p-2 space-y-0.5">
              <p className="text-foreground text-xs font-medium">Tower {i + 1}</p>
              <p>Elements: {t.numElements}</p>
              <p>Steering: {t.steeringAngle.toFixed(1)}°</p>
              <p>Window: {t.windowType}</p>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground border-t border-border pt-3">
          <p className="font-semibold text-foreground">Active User</p>
          <p>
            {users[activeUser]?.label} at ({users[activeUser]?.x}, {users[activeUser]?.y})
          </p>
        </div>
      </div>

      <div className="flex-1 sim-canvas-container p-3 flex flex-col items-center">
        <h4 className="sim-param-label mb-2">5G Network Coverage</h4>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="rounded" />
      </div>
    </div>
  );
}

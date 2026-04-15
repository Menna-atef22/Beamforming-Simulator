/**
 * Main Beamforming Simulator — Professional Engineering UI
 *
 * Layout: Control Panel (left) | Visualization Area (right)
 * Features: 7+ parameters, heatmap, beam profile, before/after comparison,
 *           noise & apodization toggles, real-time updates
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ParameterSlider } from "@/components/ParameterSlider";
import { Switch } from "@/components/ui/switch";
import {
  type BeamformingParams,
  type WindowType,
  computeBeamProfile,
  computeHeatmap,
  heatmapToImageData,
  analyzeBeamProfile,
} from "@/lib/beamforming-engine";

const HEATMAP_SIZE = 280;
const PROFILE_W = 380;
const PROFILE_H = 220;
const WINDOW_TYPES: WindowType[] = ["rectangular", "hamming", "hanning", "blackman", "kaiser"];

/* ─── Purple palette constants for canvas drawing ─── */
const BG = "#0d0a14";
const GRID = "#1a1528";
const AXIS_TEXT = "#8878a8";
const BEAM_COLOR = "#b366ff";
const BEAM_GLOW = "rgba(153, 51, 255, 0.35)";
const REF_LINE = "#ff5577";
const BEFORE_COLOR = "#ff7755";
const METRIC_COLOR = "#d4b8ff";

export function BeamformingSimulator() {
  const [params, setParams] = useState<BeamformingParams>({
    frequency: 1e9,
    numElements: 8,
    elementSpacing: 0.5,
    phaseShift: 0,
    amplitude: 1,
    steeringAngle: 0,
    snr: 100,
    windowType: "rectangular",
  });
  const [noiseEnabled, setNoiseEnabled] = useState(true);
  const [apodEnabled, setApodEnabled] = useState(false);

  const heatmapRef = useRef<HTMLCanvasElement>(null);
  const profileRef = useRef<HTMLCanvasElement>(null);
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);

  const update = useCallback((key: keyof BeamformingParams, value: number | string) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  // Effective params (with toggles applied)
  const effectiveParams = useMemo<BeamformingParams>(
    () => ({
      ...params,
      snr: noiseEnabled ? params.snr : 10000,
      windowType: apodEnabled ? params.windowType : "rectangular",
    }),
    [params, noiseEnabled, apodEnabled],
  );

  // "Before" params — no steering, no SNR, no apodization
  const beforeParams = useMemo<BeamformingParams>(
    () => ({
      ...params,
      steeringAngle: 0,
      snr: 10000,
      windowType: "rectangular",
    }),
    [params],
  );

  // ── Render heatmap ──
  useEffect(() => {
    const canvas = heatmapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const heatmap = computeHeatmap(effectiveParams, HEATMAP_SIZE, HEATMAP_SIZE);
    const imgData = heatmapToImageData(heatmap, HEATMAP_SIZE, HEATMAP_SIZE);
    ctx.putImageData(imgData, 0, 0);

    // Overlay axis labels
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.fillText("← Angle →", HEATMAP_SIZE / 2 - 28, HEATMAP_SIZE - 4);
    ctx.save();
    ctx.translate(10, HEATMAP_SIZE / 2 + 16);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Distance ↑", 0, 0);
    ctx.restore();
  }, [effectiveParams]);

  // ── Render beam profile ──
  useEffect(() => {
    const canvas = profileRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 18, bottom: 28, left: 40, right: 16 };
    const pw = w - pad.left - pad.right;
    const ph = h - pad.top - pad.bottom;

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * ph;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + pw, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 6; i++) {
      const x = pad.left + (i / 6) * pw;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + ph);
      ctx.stroke();
    }

    const profile = computeBeamProfile(effectiveParams);
    const metrics = analyzeBeamProfile(profile);

    // Glow under curve
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = BEAM_COLOR;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + ph);
    for (let i = 0; i < profile.length; i++) {
      const x = pad.left + ((profile[i].angle + 90) / 180) * pw;
      const y = pad.top + ph - profile[i].magnitude * ph;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(pad.left + pw, pad.top + ph);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Beam line
    ctx.strokeStyle = BEAM_COLOR;
    ctx.lineWidth = 2;
    ctx.shadowColor = BEAM_GLOW;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < profile.length; i++) {
      const x = pad.left + ((profile[i].angle + 90) / 180) * pw;
      const y = pad.top + ph - profile[i].magnitude * ph;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // -3dB line
    const y3db = pad.top + ph - 0.707 * ph;
    ctx.strokeStyle = REF_LINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y3db);
    ctx.lineTo(pad.left + pw, y3db);
    ctx.stroke();
    ctx.setLineDash([]);

    // Axis labels
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = "9px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const a of [-90, -60, -30, 0, 30, 60, 90]) {
      const x = pad.left + ((a + 90) / 180) * pw;
      ctx.fillText(`${a}°`, x, pad.top + ph + 14);
    }
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (i / 4) * ph + 3;
      ctx.fillText((1 - i / 4).toFixed(1), pad.left - 4, y);
    }

    // Axis titles
    ctx.textAlign = "center";
    ctx.fillText("Angle (θ)", pad.left + pw / 2, h - 2);
    ctx.save();
    ctx.translate(10, pad.top + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Magnitude", 0, 0);
    ctx.restore();

    // Metrics overlay
    ctx.fillStyle = METRIC_COLOR;
    ctx.font = "10px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Beamwidth: ${metrics.mainLobeWidth.toFixed(1)}°`, pad.left + 4, pad.top + 12);
    ctx.fillText(
      `SLL: ${metrics.peakSidelobeLevel.toFixed(1)} dB`,
      pad.left + pw - 80,
      pad.top + 12,
    );

    // Legend
    ctx.fillStyle = REF_LINE;
    ctx.fillText("−3 dB", pad.left + pw - 38, y3db - 4);
  }, [effectiveParams]);

  // ── Before / After comparison ──
  const drawComparisonProfile = useCallback(
    (canvas: HTMLCanvasElement | null, p: BeamformingParams, color: string, label: string) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const pad = { top: 20, bottom: 22, left: 32, right: 8 };
      const pw = w - pad.left - pad.right;
      const ph = h - pad.top - pad.bottom;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // Light grid
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 3; i++) {
        const y = pad.top + (i / 3) * ph;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + pw, y);
        ctx.stroke();
      }

      const profile = computeBeamProfile(p);
      const metrics = analyzeBeamProfile(profile);

      // Glow fill
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top + ph);
      for (const pt of profile) {
        ctx.lineTo(pad.left + ((pt.angle + 90) / 180) * pw, pad.top + ph - pt.magnitude * ph);
      }
      ctx.lineTo(pad.left + pw, pad.top + ph);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < profile.length; i++) {
        const x = pad.left + ((profile[i].angle + 90) / 180) * pw;
        const y = pad.top + ph - profile[i].magnitude * ph;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Label badge
      ctx.fillStyle = color;
      ctx.font = "bold 9px Inter, system-ui, sans-serif";
      ctx.fillText(label, pad.left + 2, pad.top + 12);

      // Metrics
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = "9px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`BW ${metrics.mainLobeWidth.toFixed(1)}°`, pad.left + pw, pad.top + 12);
      ctx.fillText(`SLL ${metrics.peakSidelobeLevel.toFixed(1)}dB`, pad.left + pw, pad.top + 24);
      ctx.textAlign = "left";

      // X axis ticks
      ctx.fillStyle = AXIS_TEXT;
      ctx.textAlign = "center";
      ctx.font = "8px Inter, system-ui, sans-serif";
      for (const a of [-90, 0, 90]) {
        ctx.fillText(`${a}°`, pad.left + ((a + 90) / 180) * pw, h - 4);
      }
      ctx.textAlign = "left";
    },
    [],
  );

  useEffect(() => {
    drawComparisonProfile(beforeRef.current, beforeParams, BEFORE_COLOR, "BEFORE");
    drawComparisonProfile(afterRef.current, effectiveParams, BEAM_COLOR, "AFTER");
  }, [beforeParams, effectiveParams, drawComparisonProfile]);

  // Metrics for display
  const metrics = useMemo(() => {
    const profile = computeBeamProfile(effectiveParams);
    return analyzeBeamProfile(profile);
  }, [effectiveParams]);

  return (
    <div className="flex h-full gap-4">
      {/* ═══ LEFT: Control Panel ═══ */}
      <div className="sim-control-panel p-4 w-72 shrink-0 overflow-y-auto flex flex-col gap-3">
        {/* Header */}
        <div className="pb-2 border-b border-border">
          <h3 className="text-sm font-bold text-foreground tracking-wide">Control Panel</h3>
          <p className="text-[0.6rem] text-muted-foreground mt-0.5">
            Adjust parameters for real-time simulation
          </p>
        </div>

        {/* Section: Beamforming Controls */}
        <div className="sim-section space-y-2.5">
          <div className="sim-section-title">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
            Beamforming Controls
          </div>
          <ParameterSlider
            label="Elements (N)"
            value={params.numElements}
            min={2}
            max={32}
            step={1}
            onChange={(v) => update("numElements", v)}
          />
          <ParameterSlider
            label="Spacing (d/λ)"
            value={params.elementSpacing}
            min={0.1}
            max={2}
            step={0.05}
            onChange={(v) => update("elementSpacing", v)}
          />
          <ParameterSlider
            label="Frequency"
            value={params.frequency / 1e9}
            min={0.1}
            max={30}
            step={0.1}
            unit="GHz"
            onChange={(v) => update("frequency", v * 1e9)}
          />
          <ParameterSlider
            label="Steering Angle (θ)"
            value={params.steeringAngle}
            min={-90}
            max={90}
            step={1}
            unit="°"
            onChange={(v) => update("steeringAngle", v)}
          />
          <ParameterSlider
            label="Amplitude"
            value={params.amplitude}
            min={0}
            max={1}
            step={0.01}
            onChange={(v) => update("amplitude", v)}
          />
        </div>

        {/* Section: Signal Quality */}
        <div className="sim-section space-y-2.5">
          <div className="sim-section-title">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sim-accent" />
            Signal Quality
          </div>
          <ParameterSlider
            label="SNR"
            value={params.snr}
            min={0}
            max={1000}
            step={1}
            onChange={(v) => update("snr", v)}
          />
          <ParameterSlider
            label="Phase Shift"
            value={params.phaseShift}
            min={-Math.PI}
            max={Math.PI}
            step={0.01}
            unit="rad"
            onChange={(v) => update("phaseShift", v)}
          />
        </div>

        {/* Section: Apodization */}
        <div className="sim-section space-y-2.5">
          <div className="sim-section-title">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sim-warning" />
            Windowing / Apodization
          </div>
          <select
            aria-label="Window type selection"
            value={params.windowType}
            onChange={(e) => update("windowType", e.target.value)}
            className="w-full rounded-md bg-input px-3 py-1.5 text-xs text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {WINDOW_TYPES.map((w) => (
              <option key={w} value={w}>
                {w.charAt(0).toUpperCase() + w.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Section: Toggles */}
        <div className="sim-section space-y-2">
          <div className="sim-section-title">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-sim-success" />
            Toggles
          </div>
          <div className="sim-toggle-row">
            <span className="sim-param-label">Noise (SNR)</span>
            <Switch checked={noiseEnabled} onCheckedChange={setNoiseEnabled} />
          </div>
          <div className="sim-toggle-row">
            <span className="sim-param-label">Apodization</span>
            <Switch checked={apodEnabled} onCheckedChange={setApodEnabled} />
          </div>
        </div>

        {/* Metrics readout */}
        <div className="border-t border-border pt-3 flex justify-around">
          <div className="sim-metric">
            <span className="sim-metric-value">{metrics.mainLobeWidth.toFixed(1)}°</span>
            <span className="sim-metric-label">Beamwidth</span>
          </div>
          <div className="sim-metric">
            <span className="sim-metric-value">{metrics.peakSidelobeLevel.toFixed(1)}</span>
            <span className="sim-metric-label">SLL (dB)</span>
          </div>
        </div>
      </div>

      {/* ═══ RIGHT: Visualization Area ═══ */}
      <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 min-w-0 min-h-0">
        {/* 1. Interference Heatmap */}
        <div className="sim-viz-card items-center">
          <div className="sim-viz-title">Interference Heatmap</div>
          <canvas
            ref={heatmapRef}
            width={HEATMAP_SIZE}
            height={HEATMAP_SIZE}
            className="rounded sim-glow-border max-w-full"
          />
        </div>

        {/* 2. Beam Profile Plot */}
        <div className="sim-viz-card items-center">
          <div className="sim-viz-title">Beam Pattern (Array Factor)</div>
          <canvas
            ref={profileRef}
            width={PROFILE_W}
            height={PROFILE_H}
            className="rounded max-w-full"
          />
        </div>

        {/* 3. Before comparison */}
        <div className="sim-viz-card items-center">
          <div className="sim-viz-title flex items-center gap-2">
            <span className="sim-badge sim-badge-before">Before</span>
            No Steering / No Noise Reduction
          </div>
          <canvas ref={beforeRef} width={PROFILE_W} height={180} className="rounded max-w-full" />
        </div>

        {/* 4. After comparison */}
        <div className="sim-viz-card items-center">
          <div className="sim-viz-title flex items-center gap-2">
            <span className="sim-badge sim-badge-after">After</span>
            With Steering & SNR Applied
          </div>
          <canvas ref={afterRef} width={PROFILE_W} height={180} className="rounded max-w-full" />
        </div>
      </div>
    </div>
  );
}

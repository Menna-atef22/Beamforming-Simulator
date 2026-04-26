import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TowerParams {
  id: number;
  x: number;
  y: number;
  coverage_radius_m: number;
  num_elements: number;
  frequency: number;         // Hz
  spacing?: number;
  wavelength?: number;
  steering_angle_deg?: number;
  manual_steering_deg?: number; // user-set manual override (−90 to +90)
  amplitude?: number;
  snr_db?: number;
  window_type?: "rectangular" | "hamming" | "hanning" | "blackman" | "kaiser";
  noise_enabled?: boolean;
  apodization_enabled?: boolean;
  geometry?: "linear" | "curved";
  radius?: number;
}

interface TowerConfigPopupProps {
  tower: TowerParams;
  towerHue: number;
  towerName: string;
  /** Pixel position on the canvas host container (top-left anchor) */
  anchorPx: { x: number; y: number };
  onClose: () => void;
  onChange: (updated: TowerParams) => void;
  isAutoSteering?: boolean;
  allocations?: Array<{
    user_id: number;
    num_elements: number;
    sector: string;
    userHue?: number;
  }>;
}

// ─── Slider row ───────────────────────────────────────────────────────────────
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  hue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hue: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: `hsl(${hue},65%,72%)` }}>
          {label}
        </span>
        <span
          className="text-[10px] font-mono font-semibold tabular-nums"
          style={{ color: `hsl(${hue},70%,82%)` }}
        >
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          accentColor: `hsl(${hue},70%,55%)`,
          background: `linear-gradient(to right, hsl(${hue},70%,50%) 0%, hsl(${hue},70%,50%) ${((value - min) / (max - min)) * 100
            }%, hsl(240,10%,30%) ${((value - min) / (max - min)) * 100}%, hsl(240,10%,30%) 100%)`,
        }}
      />
    </div>
  );
}

// ─── Main popup ───────────────────────────────────────────────────────────────
export default function TowerConfigPopup({
  tower,
  towerHue,
  towerName,
  anchorPx,
  onClose,
  onChange,
  isAutoSteering = false,
  allocations = [],
}: TowerConfigPopupProps) {
  // Keep popup inside viewport — flip to left if too close to right edge
  const popupW = 220;
  const left = anchorPx.x + popupW > window.innerWidth - 20
    ? anchorPx.x - popupW - 8
    : anchorPx.x + 8;

  const update = (patch: Partial<TowerParams>) =>
    onChange({ ...tower, ...patch });

  const freqGhz = tower.frequency / 1e9;
  const manualDeg = tower.manual_steering_deg ?? 0;

  return (
    <div
      className="fixed z-50 select-none"
      style={{ left, top: Math.max(8, anchorPx.y - 20), width: popupW }}
    >
      {/* Glass card */}
      <div
        className="rounded-xl border shadow-2xl backdrop-blur-md flex flex-col gap-3 p-3"
        style={{
          background: `hsla(240,12%,10%,0.92)`,
          borderColor: `hsla(${towerHue},65%,45%,0.4)`,
          boxShadow: `0 0 24px hsla(${towerHue},65%,40%,0.25)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Tower icon dot */}
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: `hsl(${towerHue},70%,55%)` }}
            />
            <span
              className="text-[11px] font-mono font-bold"
              style={{ color: `hsl(${towerHue},70%,82%)` }}
            >
              Tower {tower.id} · {towerName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[10px] font-mono rounded-md px-1.5 py-0.5 transition-colors"
            style={{
              color: `hsl(${towerHue},50%,65%)`,
              background: `hsla(${towerHue},40%,20%,0.4)`,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = `hsla(${towerHue},40%,25%,0.7)`)}
            onMouseLeave={e => (e.currentTarget.style.background = `hsla(${towerHue},40%,20%,0.4)`)}
          >
            ✕
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: `hsla(${towerHue},50%,40%,0.3)` }} />

        {/* Sliders */}
        <SliderRow
          label="Coverage Radius"
          value={tower.coverage_radius_m}
          min={1}
          max={10}
          step={0.1}
          format={v => `${v.toFixed(1)} m`}
          hue={towerHue}
          onChange={v => update({ coverage_radius_m: v })}
        />

        <SliderRow
          label="Antenna Elements"
          value={tower.num_elements}
          min={4}
          max={64}
          step={1}
          format={v => `${v}`}
          hue={towerHue}
          onChange={v => update({ num_elements: Math.round(v) })}
        />

        <SliderRow
          label="Frequency"
          value={freqGhz}
          min={0.7}
          max={100}
          step={0.1}
          format={v => `${v.toFixed(1)} GHz`}
          hue={towerHue}
          onChange={v => update({ frequency: v * 1e9 })}
        />

        {/* Divider */}
        <div style={{ height: 1, background: `hsla(${towerHue},50%,40%,0.25)` }} />

        {/* Manual steering section */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span
              className="text-[9px] font-mono uppercase tracking-wider"
              style={{ color: `hsl(${towerHue},65%,72%)` }}
            >
              Manual Steering
            </span>
            {/* AUTO / MANUAL badge */}
            <span
              className="text-[8px] font-mono font-semibold px-1.5 py-0.5 rounded-full border"
              style={isAutoSteering
                ? {
                  color: `hsl(140,75%,72%)`,
                  borderColor: `hsla(140,65%,45%,0.55)`,
                  background: `hsla(140,60%,30%,0.25)`,
                }
                : {
                  color: `hsl(${towerHue},80%,80%)`,
                  borderColor: `hsla(${towerHue},65%,50%,0.55)`,
                  background: `hsla(${towerHue},60%,30%,0.3)`,
                }
              }
            >
              {isAutoSteering ? "AUTO" : "MANUAL"}
            </span>
          </div>

          {isAutoSteering && (
            <p className="text-[8px] font-mono" style={{ color: `hsla(${towerHue},50%,65%,0.7)` }}>
              Auto-steering toward connected user.
              Slider sets fallback when no user is connected.
            </p>
          )}

          <SliderRow
            label="Angle (no-user fallback)"
            value={manualDeg}
            min={-90}
            max={90}
            step={1}
            format={v => `${v >= 0 ? "+" : ""}${v.toFixed(0)}°`}
            hue={towerHue}
            onChange={v => update({ manual_steering_deg: v })}
          />
        </div>


        {/* Sector Allocations */}
        {allocations.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                Connected Users
              </span>
              <span className="text-[9px] font-mono text-muted-foreground/60">
                {allocations.length} total
              </span>
            </div>
            <div className="flex flex-col gap-1.5 max-h-32 overflow-y-auto pr-1">
              {allocations.map((a) => (
                <div
                  key={a.user_id}
                  className="flex items-center justify-between p-1.5 rounded bg-white/5 border border-white/10"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: `hsl(${a.userHue ?? 0}, 70%, 60%)` }}
                    />
                    <span className="text-[10px] font-mono font-medium">U{a.user_id}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[8px] font-mono px-1 py-0.5 rounded border border-white/20 bg-white/10 text-white/80"
                    >
                      {a.sector}
                    </span>
                    <span className="text-[10px] font-mono text-white/60">
                      {a.num_elements} elements
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position read-out */}
        <div
          className="flex justify-between text-[8px] font-mono pt-0.5"
          style={{ color: `hsla(${towerHue},50%,60%,0.7)` }}
        >
          <span>x = {tower.x.toFixed(1)} m</span>
          <span>y = {tower.y.toFixed(1)} m</span>
        </div>
      </div>
    </div>
  );
}

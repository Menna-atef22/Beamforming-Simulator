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
}: TowerConfigPopupProps) {
  // Keep popup inside viewport — flip to left if too close to right edge
  const popupW = 220;
  const left = anchorPx.x + popupW > window.innerWidth - 20
    ? anchorPx.x - popupW - 8
    : anchorPx.x + 8;

  const update = (patch: Partial<TowerParams>) =>
    onChange({ ...tower, ...patch });

  const freqGhz = tower.frequency / 1e9;

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

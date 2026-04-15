import type { BeamformingRequest, WindowType } from '../types'

interface ControlPanelProps {
  value: BeamformingRequest
  onChange: (next: BeamformingRequest) => void
}

function updateNumber(
  value: BeamformingRequest,
  key: keyof BeamformingRequest,
  raw: string,
  onChange: (next: BeamformingRequest) => void,
) {
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) {
    onChange({ ...value, [key]: parsed })
  }
}

function SliderRow(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onValue: (value: string) => void
}) {
  const { label, value, min, max, step, onValue } = props
  return (
    <label className="control-row">
      <div className="control-row-head">
        <span>{label}</span>
        <strong>{value.toFixed(2)}</strong>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onValue(e.target.value)} />
    </label>
  )
}

export function ControlPanel({ value, onChange }: ControlPanelProps) {
  return (
    <section className="panel controls-panel">
      <h2>Beamforming Controls</h2>
      <p className="muted">
        Delay/phase steering, aperture shaping, and apodization are synced to every simulator.
      </p>

      <div className="control-grid">
        <SliderRow
          label="Elements"
          value={value.num_elements}
          min={2}
          max={128}
          step={1}
          onValue={(v) => updateNumber(value, 'num_elements', v, onChange)}
        />
        <SliderRow
          label="Element spacing (m)"
          value={value.element_spacing_m}
          min={0.005}
          max={0.5}
          step={0.005}
          onValue={(v) => updateNumber(value, 'element_spacing_m', v, onChange)}
        />
        <SliderRow
          label="Carrier frequency (GHz)"
          value={value.carrier_frequency_hz / 1e9}
          min={0.5}
          max={15}
          step={0.1}
          onValue={(v) => {
            const parsed = Number(v)
            if (Number.isFinite(parsed)) {
              onChange({ ...value, carrier_frequency_hz: parsed * 1e9 })
            }
          }}
        />
        <SliderRow
          label="Steering angle (deg)"
          value={value.steering_angle_deg}
          min={-89}
          max={89}
          step={1}
          onValue={(v) => updateNumber(value, 'steering_angle_deg', v, onChange)}
        />
        <SliderRow
          label="Phase offset (deg)"
          value={value.phase_offset_deg}
          min={-180}
          max={180}
          step={1}
          onValue={(v) => updateNumber(value, 'phase_offset_deg', v, onChange)}
        />
        <SliderRow
          label="Amplitude"
          value={value.amplitude}
          min={0.1}
          max={10}
          step={0.1}
          onValue={(v) => updateNumber(value, 'amplitude', v, onChange)}
        />
        <SliderRow
          label="Aperture (m)"
          value={value.aperture_m}
          min={0.2}
          max={20}
          step={0.1}
          onValue={(v) => updateNumber(value, 'aperture_m', v, onChange)}
        />
        <SliderRow
          label="Resolution samples"
          value={value.sample_points}
          min={40}
          max={220}
          step={1}
          onValue={(v) => updateNumber(value, 'sample_points', v, onChange)}
        />
        <SliderRow
          label="View extent (m)"
          value={value.view_extent_m}
          min={1}
          max={500}
          step={1}
          onValue={(v) => updateNumber(value, 'view_extent_m', v, onChange)}
        />
        <SliderRow
          label="Apodization alpha"
          value={value.apodization_alpha}
          min={0}
          max={1}
          step={0.01}
          onValue={(v) => updateNumber(value, 'apodization_alpha', v, onChange)}
        />
        <SliderRow
          label="Assumed SNR"
          value={value.snr}
          min={0}
          max={1000}
          step={1}
          onValue={(v) => updateNumber(value, 'snr', v, onChange)}
        />
      </div>

      <label className="control-row select-row">
        <div className="control-row-head">
          <span>Windowing / Apodization</span>
        </div>
        <select
          value={value.window_type}
          onChange={(e) => onChange({ ...value, window_type: e.target.value as WindowType })}
        >
          <option value="rectangular">Rectangular</option>
          <option value="hann">Hann</option>
          <option value="hamming">Hamming</option>
          <option value="blackman">Blackman</option>
          <option value="tukey">Tukey</option>
        </select>
      </label>
    </section>
  )
}

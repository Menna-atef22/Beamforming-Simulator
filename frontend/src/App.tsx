import { useEffect, useMemo, useState } from 'react'

import { simulateBeamforming } from './api'
import { BeamMapCanvas } from './components/BeamMapCanvas'
import { BeamProfilePlot } from './components/BeamProfilePlot'
import { ControlPanel } from './components/ControlPanel'
import { FiveGSimulator } from './components/FiveGSimulator'
import { RadarSimulator } from './components/RadarSimulator'
import { UltrasoundSimulator } from './components/UltrasoundSimulator'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import type { BeamformingRequest, BeamformingResponse } from './types'

type Tab = 'beam' | 'fiveg' | 'ultrasound' | 'radar'

const tabLabels: Record<Tab, string> = {
  beam: 'Beam Lab',
  fiveg: '5G Application',
  ultrasound: 'Ultrasound Application',
  radar: 'Radar Application',
}

function App() {
  const [tab, setTab] = useState<Tab>('beam')
  const [beamParams, setBeamParams] = useState<BeamformingRequest>({
    num_elements: 24,
    element_spacing_m: 0.06,
    carrier_frequency_hz: 3.5e9,
    steering_angle_deg: 12,
    phase_offset_deg: 0,
    amplitude: 1,
    aperture_m: 1.5,
    sample_points: 95,
    view_extent_m: 18,
    window_type: 'hann',
    apodization_alpha: 0.35,
    snr: 120,
  })

  const [beamData, setBeamData] = useState<BeamformingResponse | null>(null)
  const [loadingBeam, setLoadingBeam] = useState(false)
  const debouncedBeamParams = useDebouncedValue(beamParams, 120)

  useEffect(() => {
    const controller = new AbortController()
    setLoadingBeam(true)

    simulateBeamforming(debouncedBeamParams, controller.signal)
      .then((response) => setBeamData(response))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        console.error(err)
      })
      .finally(() => setLoadingBeam(false))

    return () => controller.abort()
  }, [debouncedBeamParams])

  const beamFacts = useMemo(() => {
    if (!beamData) {
      return null
    }

    return [
      `Main lobe: ${beamData.main_lobe_deg.toFixed(1)} deg`,
      `Half power BW: ${beamData.half_power_bw_deg.toFixed(1)} deg`,
      `Windowing: ${beamParams.window_type}`,
      `SNR: ${beamParams.snr.toFixed(0)}`,
    ]
  }, [beamData, beamParams.snr, beamParams.window_type])

  return (
    <div className="app-shell">
      <header className="hero-head">
        <p className="eyebrow">Task 4</p>
        <h1>2D Beamforming Simulator</h1>
        <p>
          Real-time phased array simulation with controllable delays, phase shifts, apodization/windowing, and synchronized application views across 5G, ultrasound, and radar.
        </p>
      </header>

      <section className="top-grid">
        <ControlPanel value={beamParams} onChange={setBeamParams} />

        <article className="panel">
          <h2>Constructive and Destructive Field</h2>
          <p className="muted">
            Viewer 1 (2D interference map) and Viewer 2 (beam profile) update from the same steering and apodization state.
          </p>

          {loadingBeam && <p className="muted">Simulating field...</p>}
          {!beamData && !loadingBeam && <p className="muted">No beam data yet.</p>}
          {beamData && (
            <div className="sim-grid two-col">
              <div className="stack-col">
                <BeamMapCanvas map={beamData.constructive_map} />
                <p className="caption">Blue regions indicate destructive behavior and amber regions indicate constructive buildup.</p>
              </div>
              <div className="stack-col">
                <BeamProfilePlot
                  angles={beamData.beam_angles_deg}
                  profile={beamData.beam_profile_db}
                  mainLobeDeg={beamData.main_lobe_deg}
                />
                <p className="caption">Apply windowing/apodization to reduce side lobes and inspect half-power bandwidth trade-offs.</p>
              </div>
            </div>
          )}

          {beamFacts && (
            <div className="stats-inline">
              {beamFacts.map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="tab-strip">
        {(Object.keys(tabLabels) as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === tab ? 'tab active' : 'tab'}
            onClick={() => setTab(item)}
          >
            {tabLabels[item]}
          </button>
        ))}
      </section>

      {tab === 'beam' && (
        <section className="panel app-panel">
          <h3>Beamforming Summary</h3>
          <p className="muted">
            This base lab shares the same adjustable oscillator and array controls used by all application simulators. Changing SNR, steering angle, element count, spacing, or apodization is reflected in each simulator output.
          </p>
          <div className="mini-card">
            <h4>Included Parameter Set</h4>
            <p>
              Number of elements, spacing, carrier frequency, steering angle, phase offset, amplitude, aperture, sampling resolution, view extent, window type, apodization alpha, and SNR.
            </p>
          </div>
        </section>
      )}
      {tab === 'fiveg' && <FiveGSimulator snr={beamParams.snr} />}
      {tab === 'ultrasound' && <UltrasoundSimulator snr={beamParams.snr} />}
      {tab === 'radar' && <RadarSimulator snr={beamParams.snr} />}
    </div>
  )
}

export default App

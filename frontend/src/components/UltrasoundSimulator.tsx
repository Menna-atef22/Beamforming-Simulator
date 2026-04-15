import { useEffect, useMemo, useRef, useState } from 'react'

import { getUltrasoundPhantom, simulateUltrasound } from '../api'
import type {
  PhantomShape,
  ProbeState,
  ScanLine,
  UltrasoundResponse,
  VesselState,
} from '../types'

interface UltrasoundSimulatorProps {
  snr: number
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function shapeContains(shape: PhantomShape, x: number, y: number) {
  const theta = (shape.angle_deg * Math.PI) / 180
  const dx = x - shape.cx
  const dy = y - shape.cy
  const xr = dx * Math.cos(theta) + dy * Math.sin(theta)
  const yr = -dx * Math.sin(theta) + dy * Math.cos(theta)
  return (xr / shape.rx) ** 2 + (yr / shape.ry) ** 2 <= 1
}

export function UltrasoundSimulator({ snr }: UltrasoundSimulatorProps) {
  const phantomRef = useRef<HTMLCanvasElement>(null)
  const aModeRef = useRef<HTMLCanvasElement>(null)
  const bModeRef = useRef<HTMLCanvasElement>(null)
  const dopplerRef = useRef<HTMLCanvasElement>(null)

  const [shapes, setShapes] = useState<PhantomShape[]>([])
  const [vessel, setVessel] = useState<VesselState>({
    x: 0.35,
    y: -0.2,
    radius: 0.08,
    velocity_cm_s: 30,
    direction_deg: 20,
  })
  const [probe, setProbe] = useState<ProbeState>({
    surface_angle_deg: 270,
    beam_direction_deg: 90,
    frequency_mhz: 5,
    max_depth_mm: 120,
  })
  const [scanLines, setScanLines] = useState<ScanLine[]>([])
  const [response, setResponse] = useState<UltrasoundResponse | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedShape = useMemo(
    () => shapes.find((shape) => shape.id === selectedId) ?? null,
    [selectedId, shapes],
  )

  useEffect(() => {
    const controller = new AbortController()
    getUltrasoundPhantom(controller.signal)
      .then((data) => {
        setShapes(data.shapes)
        setVessel(data.vessel)
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          return
        }
        console.error(err)
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (shapes.length === 0) {
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      simulateUltrasound(
        {
          shapes,
          probe,
          scan_lines: scanLines,
          vessel,
          snr,
        },
        controller.signal,
      )
        .then((data) => setResponse(data))
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') {
            return
          }
          console.error(err)
        })
    }, 120)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [probe, scanLines, shapes, snr, vessel])

  const toCanvas = (x: number, y: number, width: number, height: number) => {
    const scale = Math.min(width, height) * 0.42
    return {
      x: width / 2 + x * scale,
      y: height / 2 - y * scale,
      scale,
    }
  }

  const toWorld = (x: number, y: number, width: number, height: number) => {
    const scale = Math.min(width, height) * 0.42
    return {
      x: (x - width / 2) / scale,
      y: -(y - height / 2) / scale,
    }
  }

  useEffect(() => {
    const canvas = phantomRef.current
    if (!canvas) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const bg = ctx.createLinearGradient(0, 0, width, height)
    bg.addColorStop(0, '#141820')
    bg.addColorStop(1, '#0c1118')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, width, height)

    const body = toCanvas(0, 0, width, height)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(body.x, body.y, body.scale, 0, Math.PI * 2)
    ctx.stroke()

    for (const shape of shapes) {
      const p = toCanvas(shape.cx, shape.cy, width, height)
      const rx = shape.rx * p.scale
      const ry = shape.ry * p.scale

      const intensity = clamp(shape.reflectivity * 1.2, 0.1, 1)
      ctx.fillStyle = `rgba(94, 158, 255, ${0.2 + intensity * 0.4})`
      ctx.strokeStyle = shape.id === selectedId ? '#f9c74f' : shape.id === hoveredId ? '#90f3ff' : 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = shape.id === selectedId ? 2.8 : 1.5

      ctx.beginPath()
      ctx.ellipse(p.x, p.y, rx, ry, (shape.angle_deg * Math.PI) / 180, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    const vesselCenter = toCanvas(vessel.x, vessel.y, width, height)
    ctx.strokeStyle = '#f94144'
    ctx.fillStyle = 'rgba(249, 65, 68, 0.26)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(vesselCenter.x, vesselCenter.y, vessel.radius * vesselCenter.scale, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    const vesselDir = (vessel.direction_deg * Math.PI) / 180
    ctx.strokeStyle = '#ff7b7b'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(vesselCenter.x, vesselCenter.y)
    ctx.lineTo(vesselCenter.x + Math.cos(vesselDir) * 30, vesselCenter.y - Math.sin(vesselDir) * 30)
    ctx.stroke()

    const surface = (probe.surface_angle_deg * Math.PI) / 180
    const beam = (probe.beam_direction_deg * Math.PI) / 180
    const probeXY = {
      x: 1.02 * Math.cos(surface),
      y: 1.02 * Math.sin(surface),
    }
    const probeCanvas = toCanvas(probeXY.x, probeXY.y, width, height)

    ctx.fillStyle = '#f9c74f'
    ctx.beginPath()
    ctx.arc(probeCanvas.x, probeCanvas.y, 7, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#f9c74f'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(probeCanvas.x, probeCanvas.y)
    ctx.lineTo(probeCanvas.x + Math.cos(beam) * 150, probeCanvas.y - Math.sin(beam) * 150)
    ctx.stroke()

    const points = response?.intersections ?? []
    ctx.fillStyle = '#9df9c4'
    for (const point of points) {
      const p = toCanvas(point[0], point[1], width, height)
      ctx.beginPath()
      ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [hoveredId, probe.beam_direction_deg, probe.surface_angle_deg, response?.intersections, selectedId, shapes, vessel])

  useEffect(() => {
    const canvas = aModeRef.current
    const amplitudes = response?.a_mode_amplitude
    if (!canvas || !amplitudes || amplitudes.length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#111f1f'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.13)'
    for (let i = 0; i <= 4; i += 1) {
      const y = (i / 4) * height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    ctx.strokeStyle = '#80ffdb'
    ctx.lineWidth = 2
    ctx.beginPath()
    amplitudes.forEach((amp, i) => {
      const x = (i / Math.max(amplitudes.length - 1, 1)) * width
      const y = height - amp * (height - 4)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()
  }, [response?.a_mode_amplitude])

  useEffect(() => {
    const canvas = bModeRef.current
    const image = response?.b_mode_image
    if (!canvas || !image || image.length === 0 || image[0].length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    const rows = image.length
    const cols = image[0].length

    const data = ctx.createImageData(width, height)
    for (let py = 0; py < height; py += 1) {
      const row = Math.floor((py / height) * rows)
      for (let px = 0; px < width; px += 1) {
        const col = Math.floor((px / width) * cols)
        const value = clamp(image[row][col], 0, 1)
        const v = Math.round(value * 255)
        const idx = (py * width + px) * 4
        data.data[idx] = v
        data.data[idx + 1] = v
        data.data[idx + 2] = Math.round(v * 0.92)
        data.data[idx + 3] = 255
      }
    }

    ctx.putImageData(data, 0, 0)
  }, [response?.b_mode_image])

  useEffect(() => {
    const canvas = dopplerRef.current
    const spec = response?.doppler_spectrum
    if (!canvas || !spec || spec.length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#1a1222'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = '#ef476f'
    ctx.lineWidth = 2
    ctx.beginPath()
    spec.forEach((amp, i) => {
      const x = (i / Math.max(spec.length - 1, 1)) * width
      const y = height - amp * (height - 4)
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })
    ctx.stroke()
  }, [response?.doppler_spectrum])

  return (
    <section className="panel app-panel">
      <h3>Ultrasound A/B/Doppler on Shepp-Logan Phantom</h3>
      <p className="muted">
        Hover over phantom structures to inspect. Click a structure to edit impedance, attenuation, reflectivity, and scatter.
      </p>

      <div className="sim-grid three-col">
        <div className="stack-col">
          <canvas
            ref={phantomRef}
            width={360}
            height={360}
            className="viz-canvas"
            onMouseMove={(event) => {
              const canvas = phantomRef.current
              if (!canvas) {
                return
              }
              const rect = canvas.getBoundingClientRect()
              const world = toWorld(
                event.clientX - rect.left,
                event.clientY - rect.top,
                canvas.width,
                canvas.height,
              )
              const hit = shapes.find((shape) => shapeContains(shape, world.x, world.y))
              setHoveredId(hit?.id ?? null)
            }}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(event) => {
              const canvas = phantomRef.current
              if (!canvas) {
                return
              }
              const rect = canvas.getBoundingClientRect()
              const world = toWorld(
                event.clientX - rect.left,
                event.clientY - rect.top,
                canvas.width,
                canvas.height,
              )
              const hit = shapes.find((shape) => shapeContains(shape, world.x, world.y))
              setSelectedId(hit?.id ?? null)
            }}
          />
          <div className="mini-card">
            <h4>Probe and Vessel</h4>
            <label>
              Surface position (deg)
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={probe.surface_angle_deg}
                onChange={(e) => setProbe((prev) => ({ ...prev, surface_angle_deg: Number(e.target.value) }))}
              />
            </label>
            <label>
              Beam direction (deg)
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={probe.beam_direction_deg}
                onChange={(e) => setProbe((prev) => ({ ...prev, beam_direction_deg: Number(e.target.value) }))}
              />
            </label>
            <label>
              Probe frequency (MHz)
              <input
                type="range"
                min={1}
                max={18}
                step={0.1}
                value={probe.frequency_mhz}
                onChange={(e) => setProbe((prev) => ({ ...prev, frequency_mhz: Number(e.target.value) }))}
              />
            </label>
            <label>
              Max depth (mm)
              <input
                type="range"
                min={20}
                max={300}
                step={1}
                value={probe.max_depth_mm}
                onChange={(e) => setProbe((prev) => ({ ...prev, max_depth_mm: Number(e.target.value) }))}
              />
            </label>
            <label>
              Vessel velocity (cm/s)
              <input
                type="range"
                min={0}
                max={180}
                step={1}
                value={vessel.velocity_cm_s}
                onChange={(e) => setVessel((prev) => ({ ...prev, velocity_cm_s: Number(e.target.value) }))}
              />
            </label>
            <label>
              Vessel direction (deg)
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={vessel.direction_deg}
                onChange={(e) => setVessel((prev) => ({ ...prev, direction_deg: Number(e.target.value) }))}
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                onClick={() =>
                  setScanLines((prev) => [
                    ...prev,
                    {
                      surface_angle_deg: probe.surface_angle_deg,
                      beam_direction_deg: probe.beam_direction_deg,
                    },
                  ])
                }
              >
                Capture Scan Line
              </button>
              <button type="button" onClick={() => setScanLines([])}>
                Clear B-Mode
              </button>
            </div>
            <p className="muted">B-mode lines: {scanLines.length}</p>
          </div>
        </div>

        <div className="stack-col">
          <div className="mini-card">
            <h4>A-Mode Echo</h4>
            <canvas ref={aModeRef} width={360} height={180} className="viz-canvas" />
          </div>
          <div className="mini-card">
            <h4>B-Mode Build</h4>
            <canvas ref={bModeRef} width={360} height={180} className="viz-canvas" />
          </div>
          <div className="mini-card">
            <h4>Doppler Spectrum</h4>
            <canvas ref={dopplerRef} width={360} height={160} className="viz-canvas" />
            <p className="muted">Projected blood velocity: {response?.color_flow_velocity_cm_s.toFixed(1) ?? '0.0'} cm/s</p>
          </div>
        </div>

        <div className="stack-col">
          <div className="mini-card">
            <h4>Shape Inspector</h4>
            {hoveredId && <p className="muted">Hover: {shapes.find((shape) => shape.id === hoveredId)?.label}</p>}
            {!selectedShape && <p className="muted">Click a phantom shape to edit its ultrasound properties.</p>}
            {selectedShape && (
              <>
                <p>
                  <strong>{selectedShape.label}</strong>
                </p>
                <label>
                  Acoustic impedance (MRayl)
                  <input
                    type="range"
                    min={1.2}
                    max={2.2}
                    step={0.01}
                    value={selectedShape.acoustic_impedance_mrayl}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      setShapes((current) =>
                        current.map((shape) =>
                          shape.id === selectedShape.id ? { ...shape, acoustic_impedance_mrayl: value } : shape,
                        ),
                      )
                    }}
                  />
                </label>
                <label>
                  Attenuation (dB/cm/MHz)
                  <input
                    type="range"
                    min={0.05}
                    max={2.5}
                    step={0.01}
                    value={selectedShape.attenuation_db_cm_mhz}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      setShapes((current) =>
                        current.map((shape) =>
                          shape.id === selectedShape.id ? { ...shape, attenuation_db_cm_mhz: value } : shape,
                        ),
                      )
                    }}
                  />
                </label>
                <label>
                  Reflectivity
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedShape.reflectivity}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      setShapes((current) =>
                        current.map((shape) =>
                          shape.id === selectedShape.id ? { ...shape, reflectivity: value } : shape,
                        ),
                      )
                    }}
                  />
                </label>
                <label>
                  Scatter
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={selectedShape.scatter}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      setShapes((current) =>
                        current.map((shape) =>
                          shape.id === selectedShape.id ? { ...shape, scatter: value } : shape,
                        ),
                      )
                    }}
                  />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

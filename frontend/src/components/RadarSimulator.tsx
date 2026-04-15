import { useEffect, useMemo, useRef, useState } from 'react'

import { simulateRadar } from '../api'
import type { RadarBody, RadarResponse } from '../types'

interface RadarSimulatorProps {
  snr: number
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function uid() {
  return `B${Math.random().toString(36).slice(2, 6)}`
}

export function RadarSimulator({ snr }: RadarSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const [bodies, setBodies] = useState<RadarBody[]>([
    { id: 'B1', x: 95, y: 40, size_m: 6, reflectivity: 1.4 },
    { id: 'B2', x: -120, y: -70, size_m: 12, reflectivity: 1.2 },
  ])
  const [selectedBodyId, setSelectedBodyId] = useState<string | null>('B1')
  const [scanSpeed, setScanSpeed] = useState(54)
  const [beamWidth, setBeamWidth] = useState(20)
  const [maxRange, setMaxRange] = useState(220)
  const [currentAngle, setCurrentAngle] = useState(0)
  const [response, setResponse] = useState<RadarResponse | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const selectedBody = useMemo(
    () => bodies.find((body) => body.id === selectedBodyId) ?? null,
    [bodies, selectedBodyId],
  )

  const worldToCanvas = (x: number, y: number, width: number, height: number) => {
    const scale = (Math.min(width, height) - 34) / (2 * maxRange)
    return {
      x: width / 2 + x * scale,
      y: height / 2 - y * scale,
      scale,
    }
  }

  const canvasToWorld = (x: number, y: number, width: number, height: number) => {
    const scale = (Math.min(width, height) - 34) / (2 * maxRange)
    return {
      x: (x - width / 2) / scale,
      y: -(y - height / 2) / scale,
    }
  }

  useEffect(() => {
    const interval = window.setInterval(() => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      simulateRadar(
        {
          bodies,
          current_angle_deg: currentAngle,
          scan_speed_deg_s: scanSpeed,
          beam_width_deg: beamWidth,
          delta_time_s: 0.14,
          max_range_m: maxRange,
          snr,
        },
        controller.signal,
      )
        .then((data) => {
          setResponse(data)
          setCurrentAngle(data.next_angle_deg)
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') {
            return
          }
          console.error(err)
        })
    }, 140)

    return () => {
      window.clearInterval(interval)
      controllerRef.current?.abort()
    }
  }, [beamWidth, bodies, currentAngle, maxRange, scanSpeed, snr])

  useEffect(() => {
    const canvas = canvasRef.current
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
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width / 2)
    gradient.addColorStop(0, '#0f1e1a')
    gradient.addColorStop(1, '#08100f')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(135, 255, 163, 0.2)'
    for (let i = 1; i <= 4; i += 1) {
      const r = ((Math.min(width, height) - 34) / 2) * (i / 4)
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    const sweep = response?.sweep_points ?? []
    if (sweep.length > 2) {
      ctx.fillStyle = 'rgba(124, 255, 164, 0.2)'
      ctx.strokeStyle = 'rgba(124, 255, 164, 0.6)'
      ctx.lineWidth = 1.2
      ctx.beginPath()

      sweep.forEach((point, index) => {
        const p = worldToCanvas(point[0], point[1], width, height)
        if (index === 0) {
          ctx.moveTo(p.x, p.y)
        } else {
          ctx.lineTo(p.x, p.y)
        }
      })
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }

    for (const body of bodies) {
      const p = worldToCanvas(body.x, body.y, width, height)
      const selected = body.id === selectedBodyId
      ctx.fillStyle = selected ? '#ffd166' : '#d1f7ff'
      ctx.strokeStyle = selected ? '#ffd166' : '#89ecff'
      ctx.lineWidth = selected ? 2 : 1
      const radius = Math.max(4, body.size_m * 0.35)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = '11px IBM Plex Mono, monospace'
      ctx.fillText(body.id, p.x + 8, p.y - 6)
    }

    for (const detection of response?.detections ?? []) {
      const body = bodies.find((item) => item.id === detection.body_id)
      if (!body) {
        continue
      }
      const p = worldToCanvas(body.x, body.y, width, height)
      ctx.strokeStyle = 'rgba(255, 95, 109, 0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.fillStyle = '#9fffc0'
    ctx.font = '13px IBM Plex Mono, monospace'
    ctx.fillText(`angle ${currentAngle.toFixed(1)} deg`, 12, 18)
  }, [bodies, currentAngle, maxRange, response, selectedBodyId])

  const handleDrag = (clientX: number, clientY: number) => {
    if (!draggingId || !canvasRef.current) {
      return
    }

    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const world = canvasToWorld(clientX - rect.left, clientY - rect.top, canvas.width, canvas.height)

    setBodies((current) =>
      current.map((body) =>
        body.id === draggingId
          ? {
              ...body,
              x: clamp(world.x, -maxRange, maxRange),
              y: clamp(world.y, -maxRange, maxRange),
            }
          : body,
      ),
    )
  }

  return (
    <section className="panel app-panel">
      <h3>360-Degree Phased-Array Radar</h3>
      <p className="muted">
        Wide beams sweep faster. Narrow beams resolve body size better. Add up to 5 bodies, then drag, resize, or delete to test response changes.
      </p>

      <div className="sim-grid two-col">
        <canvas
          ref={canvasRef}
          width={540}
          height={360}
          className="viz-canvas"
          onMouseDown={(event) => {
            const canvas = canvasRef.current
            if (!canvas) {
              return
            }
            const rect = canvas.getBoundingClientRect()
            const world = canvasToWorld(
              event.clientX - rect.left,
              event.clientY - rect.top,
              canvas.width,
              canvas.height,
            )
            const hit = bodies.find((body) => Math.hypot(body.x - world.x, body.y - world.y) <= Math.max(8, body.size_m * 0.6))
            if (hit) {
              setSelectedBodyId(hit.id)
              setDraggingId(hit.id)
            }
          }}
          onMouseMove={(event) => handleDrag(event.clientX, event.clientY)}
          onMouseUp={() => setDraggingId(null)}
          onMouseLeave={() => setDraggingId(null)}
          onDoubleClick={(event) => {
            if (bodies.length >= 5 || !canvasRef.current) {
              return
            }
            const canvas = canvasRef.current
            const rect = canvas.getBoundingClientRect()
            const world = canvasToWorld(
              event.clientX - rect.left,
              event.clientY - rect.top,
              canvas.width,
              canvas.height,
            )
            const newBody: RadarBody = {
              id: uid(),
              x: clamp(world.x, -maxRange, maxRange),
              y: clamp(world.y, -maxRange, maxRange),
              size_m: 8,
              reflectivity: 1,
            }
            setBodies((current) => [...current, newBody])
            setSelectedBodyId(newBody.id)
          }}
        />

        <div className="info-column">
          <div className="mini-card">
            <h4>Scan Controls</h4>
            <label>
              Scan speed (deg/s)
              <input type="range" min={2} max={360} step={1} value={scanSpeed} onChange={(e) => setScanSpeed(Number(e.target.value))} />
            </label>
            <label>
              Beam width (deg)
              <input type="range" min={2} max={120} step={1} value={beamWidth} onChange={(e) => setBeamWidth(Number(e.target.value))} />
            </label>
            <label>
              Max range (m)
              <input type="range" min={40} max={500} step={5} value={maxRange} onChange={(e) => setMaxRange(Number(e.target.value))} />
            </label>
            <p className="muted">Double click in radar scope to add a body (max 5).</p>
          </div>

          <div className="mini-card">
            <h4>Body Editor</h4>
            {!selectedBody && <p className="muted">Select a body from the radar scope.</p>}
            {selectedBody && (
              <>
                <p>
                  <strong>{selectedBody.id}</strong>
                </p>
                <label>
                  Size (m)
                  <input
                    type="range"
                    min={0.4}
                    max={40}
                    step={0.1}
                    value={selectedBody.size_m}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setBodies((current) =>
                        current.map((body) => (body.id === selectedBody.id ? { ...body, size_m: v } : body)),
                      )
                    }}
                  />
                </label>
                <label>
                  Reflectivity
                  <input
                    type="range"
                    min={0.1}
                    max={3}
                    step={0.05}
                    value={selectedBody.reflectivity}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setBodies((current) =>
                        current.map((body) => (body.id === selectedBody.id ? { ...body, reflectivity: v } : body)),
                      )
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setBodies((current) => current.filter((body) => body.id !== selectedBody.id))
                    setSelectedBodyId((current) => (current === selectedBody.id ? null : current))
                  }}
                >
                  Delete Body
                </button>
              </>
            )}
          </div>

          <div className="mini-card">
            <h4>Detected Bodies</h4>
            {(response?.detections ?? []).length === 0 && <p className="muted">No detections this sweep.</p>}
            {(response?.detections ?? []).map((detection) => (
              <div key={detection.body_id} className="stat-row">
                <span>{detection.body_id}</span>
                <span>{detection.range_m.toFixed(1)} m</span>
                <span>{detection.estimated_size_m.toFixed(2)} m</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

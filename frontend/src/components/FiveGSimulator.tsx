import { useEffect, useMemo, useRef, useState } from 'react'

import { simulateFiveg } from '../api'
import type { FiveGResponse, TowerAutoParameters, TowerIn, UserIn } from '../types'

interface FiveGSimulatorProps {
  snr: number
}

const WORLD_EXTENT_M = 140

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function formatAuto(auto: TowerAutoParameters | undefined): string {
  if (!auto) {
    return 'Waiting for update'
  }
  return `Steer ${auto.steering_angle_deg.toFixed(1)} deg | BW ${auto.beam_width_deg.toFixed(1)} deg`
}

export function FiveGSimulator({ snr }: FiveGSimulatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [towers, setTowers] = useState<TowerIn[]>([
    { id: 'T1', x: -65, y: 52, power_dbm: 43, carrier_ghz: 3.5, max_range_m: 100, num_elements: 32 },
    { id: 'T2', x: 0, y: 68, power_dbm: 45, carrier_ghz: 3.5, max_range_m: 120, num_elements: 48 },
    { id: 'T3', x: 72, y: 46, power_dbm: 42, carrier_ghz: 3.6, max_range_m: 110, num_elements: 36 },
  ])
  const [users, setUsers] = useState<UserIn[]>([
    { id: 'U1', x: -20, y: -18 },
    { id: 'U2', x: 36, y: -10 },
  ])
  const [selectedUserId, setSelectedUserId] = useState('U1')
  const [response, setResponse] = useState<FiveGResponse | null>(null)

  const [dragging, setDragging] = useState<{ kind: 'tower' | 'user'; id: string } | null>(null)

  const autoLookup = useMemo(() => {
    return new Map((response?.towers ?? []).map((tower) => [tower.id, tower]))
  }, [response])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      simulateFiveg({ towers, users, snr }, controller.signal)
        .then((data) => setResponse(data))
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') {
            return
          }
          console.error(err)
        })
    }, 100)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [towers, users, snr])

  useEffect(() => {
    if (!response) {
      return
    }

    setTowers((current) => {
      let changed = false
      const next = current.map((tower) => {
        const auto = response.towers.find((item) => item.id === tower.id)
        if (!auto) {
          return tower
        }

        const nextPower = Number(auto.suggested_power_dbm.toFixed(1))
        const nextElements = auto.suggested_num_elements
        if (Math.abs(nextPower - tower.power_dbm) < 0.05 && nextElements === tower.num_elements) {
          return tower
        }

        changed = true
        return {
          ...tower,
          power_dbm: nextPower,
          num_elements: nextElements,
        }
      })

      return changed ? next : current
    })
  }, [response])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === '1') {
        setSelectedUserId('U1')
      } else if (event.key === '2') {
        setSelectedUserId('U2')
      }

      const step = 4
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        return
      }

      event.preventDefault()
      setUsers((current) =>
        current.map((user) => {
          if (user.id !== selectedUserId) {
            return user
          }

          if (event.key === 'ArrowUp') {
            return { ...user, y: clamp(user.y + step, -WORLD_EXTENT_M, WORLD_EXTENT_M) }
          }
          if (event.key === 'ArrowDown') {
            return { ...user, y: clamp(user.y - step, -WORLD_EXTENT_M, WORLD_EXTENT_M) }
          }
          if (event.key === 'ArrowLeft') {
            return { ...user, x: clamp(user.x - step, -WORLD_EXTENT_M, WORLD_EXTENT_M) }
          }
          return { ...user, x: clamp(user.x + step, -WORLD_EXTENT_M, WORLD_EXTENT_M) }
        }),
      )
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedUserId])

  const worldToCanvas = (x: number, y: number, width: number, height: number) => {
    const scale = (Math.min(width, height) - 40) / (2 * WORLD_EXTENT_M)
    return {
      x: width / 2 + x * scale,
      y: height / 2 - y * scale,
      scale,
    }
  }

  const canvasToWorld = (x: number, y: number, width: number, height: number) => {
    const scale = (Math.min(width, height) - 40) / (2 * WORLD_EXTENT_M)
    return {
      x: (x - width / 2) / scale,
      y: -(y - height / 2) / scale,
    }
  }

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
    ctx.fillStyle = '#0f1f2b'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8
      const x = t * width
      const y = t * height
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    const links = response?.links ?? []
    for (const link of links) {
      const tower = towers.find((item) => item.id === link.tower_id)
      const user = users.find((item) => item.id === link.user_id)
      if (!tower || !user) {
        continue
      }

      const p1 = worldToCanvas(tower.x, tower.y, width, height)
      const p2 = worldToCanvas(user.x, user.y, width, height)
      ctx.strokeStyle = link.connected
        ? `rgba(113, 255, 167, ${0.3 + 0.7 * link.quality})`
        : 'rgba(255, 90, 90, 0.25)'
      ctx.lineWidth = link.connected ? 2 + link.quality * 2 : 1
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      ctx.lineTo(p2.x, p2.y)
      ctx.stroke()
    }

    for (const tower of towers) {
      const p = worldToCanvas(tower.x, tower.y, width, height)
      const radiusPx = tower.max_range_m * p.scale
      ctx.strokeStyle = 'rgba(110, 187, 255, 0.2)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = '#70b7ff'
      ctx.beginPath()
      ctx.moveTo(p.x, p.y - 10)
      ctx.lineTo(p.x - 9, p.y + 8)
      ctx.lineTo(p.x + 9, p.y + 8)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = '#d8f0ff'
      ctx.font = '12px IBM Plex Mono, monospace'
      ctx.fillText(tower.id, p.x + 10, p.y - 10)
    }

    for (const user of users) {
      const p = worldToCanvas(user.x, user.y, width, height)
      const selected = user.id === selectedUserId

      ctx.fillStyle = selected ? '#f4cf65' : '#ffffff'
      ctx.beginPath()
      ctx.arc(p.x, p.y, selected ? 7 : 5, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = selected ? '#f4cf65' : 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = selected ? 2 : 1
      ctx.beginPath()
      ctx.arc(p.x, p.y, selected ? 12 : 9, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = '12px IBM Plex Mono, monospace'
      ctx.fillText(user.id, p.x + 10, p.y + 4)
    }
  }, [response, selectedUserId, towers, users])

  const pickNear = (wx: number, wy: number) => {
    const nearTower = towers.find((tower) => Math.hypot(tower.x - wx, tower.y - wy) < 10)
    if (nearTower) {
      return { kind: 'tower' as const, id: nearTower.id }
    }

    const nearUser = users.find((user) => Math.hypot(user.x - wx, user.y - wy) < 9)
    if (nearUser) {
      return { kind: 'user' as const, id: nearUser.id }
    }

    return null
  }

  const handleCanvasPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const rect = canvas.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    const world = canvasToWorld(localX, localY, canvas.width, canvas.height)

    if (!dragging) {
      return
    }

    if (dragging.kind === 'tower') {
      setTowers((current) =>
        current.map((tower) =>
          tower.id === dragging.id
            ? {
                ...tower,
                x: clamp(world.x, -WORLD_EXTENT_M, WORLD_EXTENT_M),
                y: clamp(world.y, -WORLD_EXTENT_M, WORLD_EXTENT_M),
              }
            : tower,
        ),
      )
      return
    }

    setUsers((current) =>
      current.map((user) =>
        user.id === dragging.id
          ? {
              ...user,
              x: clamp(world.x, -WORLD_EXTENT_M, WORLD_EXTENT_M),
              y: clamp(world.y, -WORLD_EXTENT_M, WORLD_EXTENT_M),
            }
          : user,
      ),
    )
  }

  return (
    <section className="panel app-panel">
      <h3>5G Multi-Tower Beam Connectivity</h3>
      <p className="muted">
        Drag towers and users on the map. Keyboard: press <strong>1</strong> or <strong>2</strong> to choose a user, then use arrow keys to move.
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
            const picked = pickNear(world.x, world.y)
            if (picked?.kind === 'user') {
              setSelectedUserId(picked.id)
            }
            setDragging(picked)
          }}
          onMouseMove={(event) => handleCanvasPointer(event.clientX, event.clientY)}
          onMouseUp={() => setDragging(null)}
          onMouseLeave={() => setDragging(null)}
        />

        <div className="info-column">
          <div className="mini-card">
            <h4>Connectivity Snapshot</h4>
            <p className="muted">One tower can connect to both users whenever both are inside coverage and SNR conditions.</p>
            {response?.links.map((link) => (
              <div key={`${link.tower_id}-${link.user_id}`} className="stat-row">
                <span>
                  {link.tower_id} to {link.user_id}
                </span>
                <span className={link.connected ? 'ok' : 'warn'}>
                  {link.connected ? `Connected (${(link.quality * 100).toFixed(0)}%)` : 'Out / weak'}
                </span>
              </div>
            ))}
          </div>

          <div className="mini-card">
            <h4>Tower Auto-Updates</h4>
            {towers.map((tower) => {
              const auto = autoLookup.get(tower.id)
              return (
                <div key={tower.id} className="tower-brief">
                  <strong>{tower.id}</strong>
                  <span>{formatAuto(auto)}</span>
                  <span>
                    Tx {tower.power_dbm.toFixed(1)} dBm | Elements {tower.num_elements}
                  </span>
                  <span>
                    Users: {auto?.connected_user_ids.length ? auto.connected_user_ids.join(', ') : 'none'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

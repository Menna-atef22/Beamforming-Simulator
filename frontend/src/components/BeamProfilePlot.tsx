import { useEffect, useRef } from 'react'

interface BeamProfilePlotProps {
  angles: number[]
  profile: number[]
  mainLobeDeg: number
}

export function BeamProfilePlot({ angles, profile, mainLobeDeg }: BeamProfilePlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || angles.length === 0 || profile.length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    const minDb = -55
    const maxDb = 2

    ctx.fillStyle = '#11221f'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
    for (let i = 0; i < 5; i += 1) {
      const y = (i / 4) * height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    ctx.strokeStyle = '#f9c74f'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < angles.length; i += 1) {
      const x = ((angles[i] + 90) / 180) * width
      const y = ((maxDb - profile[i]) / (maxDb - minDb)) * height
      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    const xMain = ((mainLobeDeg + 90) / 180) * width
    ctx.strokeStyle = '#f94144'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(xMain, 0)
    ctx.lineTo(xMain, height)
    ctx.stroke()

    ctx.fillStyle = '#f94144'
    ctx.font = '12px IBM Plex Mono, monospace'
    ctx.fillText(`Main lobe: ${mainLobeDeg.toFixed(1)} deg`, 12, 18)
  }, [angles, profile, mainLobeDeg])

  return <canvas ref={canvasRef} width={460} height={220} className="viz-canvas" />
}

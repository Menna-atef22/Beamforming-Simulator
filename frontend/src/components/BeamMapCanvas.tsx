import { useEffect, useRef } from 'react'

interface BeamMapCanvasProps {
  map: number[][]
}

function colorForValue(v: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, v))
  if (x >= 0) {
    const r = 180 + Math.round(75 * x)
    const g = 120 - Math.round(70 * x)
    const b = 70 - Math.round(40 * x)
    return [r, g, Math.max(20, b)]
  }

  const m = Math.abs(x)
  const r = 40 + Math.round(30 * m)
  const g = 90 + Math.round(60 * m)
  const b = 130 + Math.round(110 * m)
  return [r, g, b]
}

export function BeamMapCanvas({ map }: BeamMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || map.length === 0 || map[0].length === 0) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const width = canvas.width
    const height = canvas.height
    const rows = map.length
    const cols = map[0].length

    const imageData = ctx.createImageData(width, height)
    for (let py = 0; py < height; py += 1) {
      const rowIndex = Math.floor((py / height) * rows)
      for (let px = 0; px < width; px += 1) {
        const colIndex = Math.floor((px / width) * cols)
        const v = map[rowIndex][colIndex]
        const [r, g, b] = colorForValue(v)

        const idx = (py * width + px) * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(width / 2, 0)
    ctx.lineTo(width / 2, height)
    ctx.stroke()
  }, [map])

  return <canvas ref={canvasRef} width={460} height={320} className="viz-canvas" />
}

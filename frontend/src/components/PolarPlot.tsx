import { useMemo } from "react";

interface PolarPlotProps {
  angles: number[];
  magnitudes: number[];
  magnitudesDb?: number[];
  useDb?: boolean;
  title?: string;
}

export default function PolarPlot({
  angles,
  magnitudes,
  magnitudesDb,
  useDb = false,
  title = "Polar Plot",
}: PolarPlotProps) {
  const SIZE = 300;
  const CENTER = SIZE / 2;
  const MAX_RADIUS = 120;
  const DB_MIN = -40;
  const DB_MAX = 0;

  const plotData = useMemo(() => {
    const mags = useDb && magnitudesDb ? magnitudesDb : magnitudes;
    
    // Normalize magnitudes to 0-1
    let normalized: number[];
    if (useDb && magnitudesDb) {
      // For dB values: -40 dB → 0, 0 dB → 1
      normalized = magnitudesDb.map((db) => Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))));
    } else {
      // For linear magnitudes
      const maxMag = Math.max(...magnitudes);
      normalized = magnitudes.map((m) => (maxMag > 0 ? m / maxMag : 0));
    }

    return { normalized, mags };
  }, [magnitudes, magnitudesDb, useDb]);

  const polarToCartesian = (angleDeg: number, radiusNorm: number) => {
    const angleRad = ((90 - angleDeg) * Math.PI) / 180;
    const r = radiusNorm * MAX_RADIUS;
    const x = CENTER + r * Math.cos(angleRad);
    const y = CENTER - r * Math.sin(angleRad);
    return [x, y];
  };

  // Generate SVG path for beam pattern
  const beamPath = useMemo(() => {
    if (angles.length === 0) return "";
    
    const points = angles.map((angle, i) => {
      const radius = plotData.normalized[i];
      return polarToCartesian(angle, radius);
    });

    if (points.length === 0) return "";
    
    let pathData = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i][0]} ${points[i][1]}`;
    }
    pathData += ` Z`;
    
    return pathData;
  }, [angles, plotData]);

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h3>
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full max-w-sm">
          {/* Background */}
          <rect width={SIZE} height={SIZE} fill="#0f0f1a" />

          {/* Concentric circles (dB reference levels) */}
          {[0, -10, -20, -30, -40].map((dbLevel, idx) => {
            const radius = ((dbLevel - DB_MIN) / (DB_MAX - DB_MIN)) * MAX_RADIUS;
            return (
              <circle
                key={`circle-${idx}`}
                cx={CENTER}
                cy={CENTER}
                r={radius}
                fill="none"
                stroke="#1f1f35"
                strokeWidth="1"
              />
            );
          })}

          {/* Radial gridlines (every 30°) */}
          {[-90, -60, -30, 0, 30, 60, 90].map((angle, idx) => {
            const [x2, y2] = polarToCartesian(angle, 1);
            return (
              <line
                key={`radial-${idx}`}
                x1={CENTER}
                y1={CENTER}
                x2={x2}
                y2={y2}
                stroke="#1f1f35"
                strokeWidth="1"
              />
            );
          })}

          {/* Angle labels */}
          {[-90, -60, -30, 0, 30, 60, 90].map((angle) => {
            const [x, y] = polarToCartesian(angle, 1.15);
            return (
              <text
                key={`label-${angle}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill="#8b8d98"
                fontFamily="JetBrains Mono"
              >
                {angle}°
              </text>
            );
          })}

          {/* dB scale labels */}
          {[0, -10, -20, -30, -40].map((dbLevel) => {
            const radius = ((dbLevel - DB_MIN) / (DB_MAX - DB_MIN)) * MAX_RADIUS;
            return (
              <text
                key={`db-${dbLevel}`}
                x={CENTER + 5}
                y={CENTER - radius}
                fontSize="9"
                fill="#8b8d98"
                fontFamily="JetBrains Mono"
              >
                {dbLevel}dB
              </text>
            );
          })}

          {/* Beam pattern polygon */}
          {beamPath && (
            <>
              <path d={beamPath} fill="#b466ff" fillOpacity="0.2" stroke="#b466ff" strokeWidth="2" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

import { useMemo } from "react";

interface PolarSeries {
  id?: number | string;
  angles: number[];
  magnitudes: number[];
  magnitudesDb?: number[];
  color?: string;
  label?: string;
}

interface PolarPlotProps {
  angles: number[];
  magnitudes: number[];
  magnitudesDb?: number[];
  series?: PolarSeries[];
  useDb?: boolean;
  title?: string;
}

export default function PolarPlot({
  angles,
  magnitudes,
  magnitudesDb,
  series,
  useDb = false,
  title = "Polar Plot",
}: PolarPlotProps) {
  const SIZE = 300;
  const CENTER = SIZE / 2;
  const MAX_RADIUS = 120;
  const DB_MIN = -40;
  const DB_MAX = 0;

  function polarToCartesian(angleDeg: number, radiusNorm: number) {
    const angleRad = ((90 - angleDeg) * Math.PI) / 180;
    const r = radiusNorm * MAX_RADIUS;
    const x = CENTER + r * Math.cos(angleRad);
    const y = CENTER - r * Math.sin(angleRad);
    return [x, y] as const;
  }

  const normalizedSeries = useMemo(() => {
    const source = series && series.length > 0
      ? series
      : [{ id: "single", angles, magnitudes, magnitudesDb, color: "#b466ff", label: "Beam" }];

    const globalMaxMag = Math.max(
      0,
      ...source.flatMap((s) => s.magnitudes ?? [])
    );

    return source.map((s, idx) => {
      const sAngles = s.angles ?? [];
      const sMagnitudes = s.magnitudes ?? [];
      const sMagnitudesDb = s.magnitudesDb;

      let normalized: number[];
      if (useDb && sMagnitudesDb && sMagnitudesDb.length > 0) {
        normalized = sMagnitudesDb.map((db) => Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))));
      } else {
        const scale = globalMaxMag > 0 ? globalMaxMag : Math.max(0, ...sMagnitudes);
        normalized = sMagnitudes.map((m) => (scale > 0 ? m / scale : 0));
      }

      const points = sAngles.map((angle, i) => {
        const radius = normalized[i] ?? 0;
        return polarToCartesian(angle, radius);
      });

      let path = "";
      if (points.length > 0) {
        path = `M ${points[0][0]} ${points[0][1]}`;
        for (let i = 1; i < points.length; i++) {
          path += ` L ${points[i][0]} ${points[i][1]}`;
        }
        path += " Z";
      }

      return {
        id: s.id ?? idx,
        path,
        color: s.color ?? "#b466ff",
        label: s.label,
      };
    }).filter((s) => s.path.length > 0);
  }, [angles, magnitudes, magnitudesDb, series, useDb]);

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

          {/* Beam pattern polygons */}
          {normalizedSeries.map((s) => (
            <path
              key={`beam-${s.id}`}
              d={s.path}
              fill={s.color}
              fillOpacity="0.14"
              stroke={s.color}
              strokeWidth="2"
            />
          ))}
        </svg>
      </div>
      {normalizedSeries.length > 1 && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {normalizedSeries.map((s) => (
            <span
              key={`legend-${s.id}`}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
              style={{ borderColor: s.color, color: s.color, backgroundColor: "hsla(240,10%,15%,0.55)" }}
            >
              {s.label ?? `Beam ${s.id}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

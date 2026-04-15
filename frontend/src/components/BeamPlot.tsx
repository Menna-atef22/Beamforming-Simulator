import { BeamPattern } from "@/types/beamforming";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

interface BeamPlotProps {
  beamPattern: BeamPattern;
  title?: string;
  useDb?: boolean;
}

export default function BeamPlot({ beamPattern, title = "Beam Pattern", useDb = false }: BeamPlotProps) {
  const data = beamPattern.angles
    .filter((_, i) => i % 2 === 0)
    .map((angle, i) => ({
      angle,
      magnitude: useDb ? beamPattern.magnitudesDb[i * 2] : beamPattern.magnitudes[i * 2],
    }));

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
            <XAxis dataKey="angle" tick={{ fontSize: 9 }}
              label={{ value: "Angle (°)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
            <YAxis tick={{ fontSize: 9 }}
              label={{ value: useDb ? "dB" : "Magnitude", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <defs>
              <linearGradient id="beamGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(270,70%,50%)" />
                <stop offset="100%" stopColor="hsl(320,70%,60%)" />
              </linearGradient>
            </defs>
            <Line type="monotone" dataKey="magnitude" stroke="url(#beamGrad)" strokeWidth={2} dot={false} name="Beam" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

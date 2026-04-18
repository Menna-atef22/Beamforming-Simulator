import { BeamPattern } from "@/types/beamforming";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

interface ComparisonViewProps {
  before: BeamPattern;
  after: BeamPattern;
  title?: string;
}

export default function ComparisonView({ before, after, title = "Before vs After" }: ComparisonViewProps) {
  const data = before.angles
    .map((angle, i) => ({
      angle,
      rectangular: before.magnitudesDb[i],
      windowed: after.magnitudesDb[i],
    }));

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
            <XAxis 
              dataKey="angle" 
              tick={{ fontSize: 9 }}
              label={{ value: "Angle (°)", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }}
            />
            <YAxis 
              tick={{ fontSize: 9 }}
              label={{ value: "dB", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }}
            />
            <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "JetBrains Mono" }} />
            <Line type="monotone" dataKey="rectangular" stroke="hsl(240,50%,55%)" strokeWidth={1.5} dot={false} strokeDasharray="5 5" name="Rectangular (High SLL)" />
            <Line type="monotone" dataKey="windowed" stroke="hsl(320,70%,60%)" strokeWidth={2} dot={false} name="Windowed (Low SLL)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

interface SignalProfileViewProps {
  data: { position: number; amplitude: number }[];
  title?: string;
}

export default function SignalProfileView({ data, title = "Signal Profile (Line Cut)" }: SignalProfileViewProps) {
  const chartData = data.map((d) => ({
    position: parseFloat(d.position.toFixed(2)),
    amplitude: parseFloat(d.amplitude.toFixed(4)),
  }));

  return (
    <div className="glass-panel p-3 flex flex-col h-full">
      <h3 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-muted-foreground mb-2">{title}</h3>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 20, left: 10 }}>
            <defs>
              <linearGradient id="sigGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(270,70%,50%)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(320,70%,60%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(240,10%,22%)" />
            <XAxis dataKey="position" tick={{ fontSize: 9 }}
              label={{ value: "Position", position: "bottom", offset: 5, style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
            <YAxis tick={{ fontSize: 9 }} domain={[0, 2.0]}
              label={{ value: "Amplitude", angle: -90, position: "insideLeft", style: { fill: "hsl(240,8%,55%)", fontSize: 10, fontFamily: "JetBrains Mono" } }} />
            <Tooltip contentStyle={{ backgroundColor: "hsl(240,10%,15%)", border: "1px solid hsl(240,10%,22%)", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 11 }} />
            <Area type="monotone" dataKey="amplitude" stroke="hsl(270,70%,50%)" fill="url(#sigGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

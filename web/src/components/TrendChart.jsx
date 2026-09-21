import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from "recharts";

// data: array; xKey; bars:[{key,name,color}]; lines:[{key,name,color}];
// xFormat: optional tick/label formatter (e.g. trims raw ISO timestamps);
// valueFormat(value, name, item): optional per-series value formatter (e.g.
// currency for spend series, plain numbers for counts).
export default function TrendChart({ data, xKey, bars = [], lines = [], height = 280, xFormat, valueFormat }) {
  const fmtVal = (v, name, item) =>
    valueFormat ? valueFormat(v, name, item) : (v == null ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: 1 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11 }} reversed tickFormatter={xFormat} />
        <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
        {/* Second axis on the OPPOSITE side — both used to render stacked on
            the left, overlapping into one unreadable double column of ticks. */}
        <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v, name, item) => [fmtVal(v, name, item), name]} labelFormatter={xFormat} />
        {/* Legend at the top with fixed height — at the bottom it collided
            with the RTL x-axis labels and rendered overlapped/struck-through. */}
        <Legend verticalAlign="top" height={32} />
        {bars.map((b) => (
          <Bar key={b.key} yAxisId="l" dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} />
        ))}
        {lines.map((l) => (
          <Line key={l.key} yAxisId="r" type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

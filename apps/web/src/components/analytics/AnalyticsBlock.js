import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import TrendChart from "@/components/analytics/TrendChart";
import DistributionChart from "@/components/analytics/DistributionChart";
import { formatValue, formatChange, weekLabel } from "@/components/analytics/format";

/*
 * Renders one block from a tab loader (shape documented in lib/analytics/blocks.js): headline
 * tiles, weekly trends (chart plus weekly numbers), breakdowns (bars plus counts and shares),
 * then tables and notes.
 */

function Tile({ tile }) {
  const change = formatChange(tile.current, tile.previous, tile.format);
  const changeColor =
    !change || change.direction === 0
      ? "text-gray-500"
      : change.direction > 0
        ? "text-emerald-700"
        : "text-red-700";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" title={tile.hint}>
      <div className="text-sm text-gray-600">{tile.label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">
        {formatValue(tile.current, tile.format)}
      </div>
      {change && (
        <div className={`mt-1 text-xs ${changeColor}`}>
          {change.text} vs previous period (was {formatValue(tile.previous, tile.format)})
        </div>
      )}
      {tile.hint && <div className="mt-2 text-xs text-gray-500">{tile.hint}</div>}
    </div>
  );
}

function Source({ children }) {
  return <span className="text-xs font-normal text-gray-500">Source: {children}</span>;
}

function Trend({ trend, weekKeys }) {
  const labels = trend.series.map((s) => s.label);
  const data = weekKeys.map((key, i) => ({
    week: weekLabel(key),
    ...Object.fromEntries(trend.series.map((s) => [s.label, s.values[i]])),
  }));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-base">{trend.title}</CardTitle>
        <Source>{trend.source}</Source>
      </CardHeader>
      <CardContent className="space-y-3">
        <TrendChart data={data} seriesLabels={labels} />
        <details>
          <summary className="cursor-pointer text-sm text-gray-600">Weekly numbers</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-1 pr-4 font-medium">Week of</th>
                  {labels.map((l) => (
                    <th key={l} className="py-1 pr-4 text-right font-medium">{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.week} className="border-b border-gray-100">
                    <td className="py-1 pr-4">{row.week}</td>
                    {labels.map((l) => (
                      <td key={l} className="py-1 pr-4 text-right tabular-nums">{formatValue(row[l])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function BreakdownTable({ table }) {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-base">{table.title}</CardTitle>
        <Source>{table.source}</Source>
      </CardHeader>
      <CardContent>
        {table.rows.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  {table.columns.map((c, i) => (
                    <th key={c.label} className={`py-1 pr-4 font-medium ${i ? "text-right" : ""}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr key={String(row[0])} className="border-b border-gray-100">
                    {row.map((cell, i) => {
                      const value = cell?.value !== undefined ? cell.value : cell;
                      const format = cell?.format ?? table.columns[i]?.format;
                      return (
                        <td key={i} className={`py-1 pr-4 ${i ? "text-right tabular-nums" : ""}`}>
                          {i ? formatValue(value, format) : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Distribution({ dist }) {
  const total = dist.rows.reduce((a, [, n]) => a + n, 0);
  const data = dist.rows.map(([label, count]) => ({ label: String(label), count }));
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-base">{dist.title}</CardTitle>
        <Source>{dist.source}</Source>
      </CardHeader>
      <CardContent className="space-y-3">
        {total === 0 ? (
          <p className="text-sm text-gray-500">Nothing recorded in this period.</p>
        ) : (
          <>
            <DistributionChart data={data} />
            <details>
              <summary className="cursor-pointer text-sm text-gray-600">Counts and shares</summary>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="py-1 pr-4 font-medium">Answer</th>
                    <th className="py-1 pr-4 text-right font-medium">Count</th>
                    <th className="py-1 pr-4 text-right font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.label} className="border-b border-gray-100">
                      <td className="py-1 pr-4">{row.label}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{formatValue(row.count)}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{formatValue(row.count / total, "percent")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
        {dist.note && <p className="text-xs text-gray-500">{dist.note}</p>}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsBlock({ block, weekKeys }) {
  const cards = block.trends.length + block.distributions.length + block.tables.length;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{block.title}</h2>
        {block.description && <p className="mt-1 text-sm text-gray-600">{block.description}</p>}
      </div>
      {block.error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This part could not be loaded right now. Try again in a minute.
        </p>
      ) : (
        <>
          {block.tiles.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {block.tiles.map((t) => (
                <Tile key={t.label} tile={t} />
              ))}
            </div>
          )}
          {cards > 0 && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {block.trends.map((t) => (
                <Trend key={t.title} trend={t} weekKeys={weekKeys} />
              ))}
              {block.distributions.map((d) => (
                <Distribution key={d.title} dist={d} />
              ))}
              {block.tables.map((t) => (
                <BreakdownTable key={t.title} table={t} />
              ))}
            </div>
          )}
          {block.notes.map((n) => (
            <p key={n} className="text-sm text-gray-600">{n}</p>
          ))}
        </>
      )}
    </section>
  );
}

import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import TrendChart from "@/components/analytics/TrendChart";
import { formatValue, formatChange, weekLabel } from "@/components/analytics/format";

/*
 * Renders one section model from lib/analytics/sections.js: headline tiles, then each
 * weekly trend as a chart with its numbers in a table underneath, then breakdown tables.
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

export default function AnalyticsSection({ id, title, model, error, weekKeys }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This section could not be loaded right now. Try again in a minute.
        </p>
      ) : (
        <>
          {model.tiles.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {model.tiles.map((t) => (
                <Tile key={t.label} tile={t} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {model.trends.map((t) => (
              <Trend key={t.title} trend={t} weekKeys={weekKeys} />
            ))}
            {model.tables.map((t) => (
              <BreakdownTable key={t.title} table={t} />
            ))}
          </div>
          {model.notes.map((n) => (
            <p key={n} className="text-sm text-gray-600">{n}</p>
          ))}
        </>
      )}
    </section>
  );
}

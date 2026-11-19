"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { formatValue } from "@/components/analytics/format";

/*
 * A sortable table whose rows open into child rows (the Marketing tab's source ->
 * campaign breakdown and its campaign link table). Shape in lib/analytics/blocks.js
 * ("pivots"). Sorting applies to top-level rows and, within each, to its children.
 */

function sortRows(rows, sort) {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  const val = (r) => (sort.key === "_label" ? r.label : r.metrics[sort.key]);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === y) return 0;
    if (x === null || x === undefined) return 1; // n/a always last
    if (y === null || y === undefined) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
  });
}

export default function PivotTable({ pivot }) {
  const [sort, setSort] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const rows = useMemo(() => sortRows(pivot.rows, sort), [pivot.rows, sort]);

  function sortBy(key) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "_label" ? "asc" : "desc" }));
  }
  function toggle(label) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }
  const arrow = (key) => (sort?.key === key ? (sort.dir === "desc" ? " ▼" : " ▲") : "");
  const cells = (metrics) =>
    pivot.columns.map((c) => (
      <td key={c.key} className="whitespace-nowrap py-1.5 pr-4 text-right tabular-nums">
        {formatValue(metrics[c.key], c.format)}
      </td>
    ));

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle className="text-base">{pivot.title}</CardTitle>
        <span className="text-xs font-normal text-gray-500">Source: {pivot.source}</span>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="sticky left-0 min-w-[13rem] bg-white py-1.5 pr-4 font-medium">
                    <button type="button" onClick={() => sortBy("_label")} className="hover:text-gray-900">
                      {pivot.firstColumn}
                      {arrow("_label")}
                    </button>
                  </th>
                  {pivot.columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap py-1.5 pr-4 text-right font-medium">
                      <button type="button" onClick={() => sortBy(c.key)} className="hover:text-gray-900">
                        {c.label}
                        {arrow(c.key)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const children = row.children?.length ? sortRows(row.children, sort) : null;
                  const isOpen = open.has(row.label);
                  return (
                    <Fragment key={row.label}>
                      <tr className="border-b border-gray-100">
                        <td className="sticky left-0 min-w-[13rem] bg-white py-1.5 pr-4">
                          <div className="flex items-start gap-1">
                            {children ? (
                              <button
                                type="button"
                                onClick={() => toggle(row.label)}
                                aria-expanded={isOpen}
                                aria-label={`${isOpen ? "Hide" : "Show"} campaigns for ${row.label}`}
                                className="w-4 shrink-0 text-gray-500 hover:text-gray-900"
                              >
                                {isOpen ? "▾" : "▸"}
                              </button>
                            ) : null}
                            <div className="min-w-0">
                              {row.href ? (
                                <Link href={row.href} className="whitespace-nowrap font-medium text-red-700 hover:underline">
                                  {row.label}
                                </Link>
                              ) : (
                                <span className="whitespace-nowrap font-medium text-gray-900">{row.label}</span>
                              )}
                              {row.sublabel && <div className="text-xs text-gray-500">{row.sublabel}</div>}
                            </div>
                          </div>
                        </td>
                        {cells(row.metrics)}
                      </tr>
                      {isOpen &&
                        children.map((child) => (
                          <tr key={`${row.label}|${child.label}`} className="border-b border-gray-100 bg-gray-50">
                            <td className="sticky left-0 min-w-[13rem] whitespace-nowrap bg-gray-50 py-1.5 pl-6 pr-4 text-gray-700">{child.label}</td>
                            {cells(child.metrics)}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

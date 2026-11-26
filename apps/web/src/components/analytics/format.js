/* Number formatting shared by the /analytics components. */

export function formatValue(value, format = "number") {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (typeof value === "string") return value;
  if (format === "percent") return `${Math.round(value * 100)}%`;
  if (format === "days") return `${value.toFixed(1)} days`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** "+12% vs previous period", or null when there is nothing to compare against. */
export function formatChange(current, previous, format = "number") {
  if (previous === undefined || previous === null || current === null || current === undefined) {
    return null;
  }
  if (format === "percent") {
    const points = Math.round((current - previous) * 100);
    return { text: `${points >= 0 ? "+" : ""}${points} pts`, direction: Math.sign(points) };
  }
  if (previous === 0) {
    return current === 0 ? { text: "no change", direction: 0 } : { text: "new", direction: 1 };
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return { text: `${change >= 0 ? "+" : ""}${change}%`, direction: Math.sign(change) };
}

export function weekLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

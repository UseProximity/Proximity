// ─── Private helpers ─────────────────────────────────────────────────────────

function computeRentRange(unitTypes) {
  const rents = unitTypes
    .map((unit) => Number(unit?.rent))
    .filter((rent) => Number.isFinite(rent) && rent > 0);
  if (rents.length === 0) return null;
  return { min: Math.min(...rents), max: Math.max(...rents) };
}

function formatRentRange(min, max) {
  return min === max
    ? `$${min.toLocaleString()}`
    : `$${min.toLocaleString()}-$${max.toLocaleString()}`;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const getRentRangeLabel = (unitTypes = []) => {
  const range = computeRentRange(unitTypes);
  if (!range) return "Contact for Pricing";
  return formatRentRange(range.min, range.max);
};

export const getRentRangeDisplay = (unitTypes = []) => {
  const range = computeRentRange(unitTypes);
  if (!range) return { label: "Contact for Pricing", hasPrice: false };
  return { label: formatRentRange(range.min, range.max), hasPrice: true };
};

export const getUnitValuesLabel = (unitTypes = [], field) => {
  const values = unitTypes
    .map((unit) => Number(unit?.[field]))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return "N/A";
  }

  const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
  return uniqueSorted.join(", ");
};

export const getAreaRangeLabel = (unitTypes = []) => {
  const areas = unitTypes
    .map((unit) => Number(unit?.area))
    .filter((area) => Number.isFinite(area) && area > 0);

  if (areas.length === 0) {
    return "-";
  }

  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);

  if (minArea === maxArea) {
    return minArea.toLocaleString();
  }

  return `${minArea.toLocaleString()}-${maxArea.toLocaleString()}`;
};

// Converts a Mongoose Map (or plain object) to a plain JS object.
export function serializePlaceWalkMinutes(pwm) {
  if (pwm instanceof Map) return Object.fromEntries(pwm);
  return pwm ?? {};
}

export function calcAge(birthday) {
  if (!birthday) return null;
  const dob = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

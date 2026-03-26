export const getRentRangeLabel = (unitTypes = []) => {
  const rents = unitTypes
    .map((unit) => Number(unit?.rent))
    .filter((rent) => Number.isFinite(rent) && rent > 0);

  if (rents.length === 0) {
    return "TBD";
  }

  const minRent = Math.min(...rents);
  const maxRent = Math.max(...rents);

  if (minRent === maxRent) {
    return `$${minRent.toLocaleString()}`;
  }

  return `$${minRent.toLocaleString()}-$${maxRent.toLocaleString()}`;
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
    return "TBD";
  }

  const minArea = Math.min(...areas);
  const maxArea = Math.max(...areas);

  if (minArea === maxArea) {
    return minArea.toLocaleString();
  }

  return `${minArea.toLocaleString()}-${maxArea.toLocaleString()}`;
};

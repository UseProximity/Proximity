// The amenity and utility pill of the listing details panel and the compare panel.
export function decodeHtml(str) {
  if (typeof document === "undefined" || !str) return str;
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

export default function AmenityPill({ label }) {
  return (
    <span className="inline-block bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full border border-gray-200">
      {decodeHtml(label)}
    </span>
  );
}

export const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher: "Dishwasher",
  gym: "Gym",
  laundry: "Laundry",
  mailroom: "Mailroom",
  microwave: "Microwave",
  oven: "Oven",
  parking: "Parking",
  pets_allowed: "Pets Allowed",
  pool: "Pool",
  refrigerator: "Refrigerator",
  rooftop: "Rooftop",
  storage: "Storage",
  stove: "Stove",
  study_room: "Study Room",
};

export const UTILITY_LABELS = {
  electric: "Electric",
  gas: "Gas",
  heat: "Heat",
  water: "Water",
  internet: "Internet",
  trash: "Trash",
  cable: "Cable",
  sewer: "Sewer",
  cooling: "Cooling",
};

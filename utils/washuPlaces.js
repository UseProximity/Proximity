// Shared WashU points of interest used for walking-time calculations.
// Consumed by the listing modal (display) and the API routes (storage).

export const WASHU_PLACES = [
  { name: "Olin Library",               lat: 38.64851503785516,  lng: -90.30770757138812 },
  { name: "Seigle Hall",                lat: 38.64901252229954,  lng: -90.31234570424581 },
  { name: "Schnucks (Grocery)",         lat: 38.633335917020425, lng: -90.31473611720082 },
  { name: "Danforth University Center", lat: 38.64754193120054,  lng: -90.31037361422699 },
  { name: "Sumers Rec Center",          lat: 38.64933192571885,  lng: -90.31472066027095 },
  { name: "Village House",              lat: 38.65056939432417,  lng: -90.31405161268682 },
];

export const SHUTTLE_STOPS = [
  { name: "Mallinckrodt Center Bus Plaza",           lat: 38.6473, lng: -90.3097 },
  { name: "Brookings Hall",                          lat: 38.6482, lng: -90.3049 },
  { name: "Forsyth @ Hoyt Dr",                       lat: 38.6463, lng: -90.3041 },
  { name: "Olin Library Shuttle",                    lat: 38.6485, lng: -90.3077 },
  { name: "Lopata Hall",                             lat: 38.6491, lng: -90.3061 },
  { name: "Skinker MetroLink / Whitaker Hall",       lat: 38.6492, lng: -90.3006 },
  { name: "Habif Health Center / Shepley Dr",        lat: 38.6457, lng: -90.3152 },
  { name: "Clocktower (South 40)",                   lat: 38.6454, lng: -90.3125 },
  { name: "Beaumont/Dauten (South 40)",              lat: 38.6449, lng: -90.3146 },
  { name: "Univ. City / Big Bend MetroLink",         lat: 38.6517, lng: -90.3153 },
  { name: "West Campus (Jackson & Forsyth)",         lat: 38.6442, lng: -90.3159 },
  { name: "North Campus / Lewis Center",             lat: 38.6582, lng: -90.2977 },
  { name: "Delmar Loop",                             lat: 38.6562, lng: -90.3052 },
  { name: "Delmar DivINe Apartments",                lat: 38.6538, lng: -90.2800 },
  { name: "Forest Park / DeBaliviere MetroLink",     lat: 38.6478, lng: -90.2846 },
  { name: "WashU Medical Campus (Mid Campus Center)",lat: 38.6362, lng: -90.2619 },
];

// Canonical campus destination (Danforth University Center)
export const CAMPUS = WASHU_PLACES.find((p) => p.name === "Danforth University Center");

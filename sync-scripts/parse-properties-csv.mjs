/**
 * parse-properties-csv.mjs
 * Converts the Proximity Property Database CSVs into properties.json.
 *
 * What it does:
 *   Reads two CSV exports from the Proximity Property Database spreadsheet
 *   and merges them into sync-scripts/properties.json, which is the source
 *   of truth used by import-to-dev.mjs and import-to-prod.mjs.
 *
 * Input files (must be in sync-scripts/):
 *   "Proximity Property Database(🏢 Properties).csv"  — building-level data
 *   "Proximity Property Database(🏠 Units).csv"       — unit types & pricing
 *
 * Output:
 *   sync-scripts/properties.json  — MongoDB paste-format documents (overwritten)
 *
 * Backend touched:
 *   - No databases — local file transform only
 *   - sync-scripts/properties.json on disk — overwritten on each run
 *
 * Usage:
 *   node sync-scripts/parse-properties-csv.mjs
 *
 * After running, review properties.json then run import-to-dev.mjs or import-to-prod.mjs.
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Property ID → building name (units CSV → properties CSV) ─────────────────
const PROPERTY_ID_MAP = {
  LOCAL:           'LOCAL on Delmar',
  KINGSBURY:       '6040\uFFFD42 Kingsbury Ave',
  LELAND:          '727 Leland Ave',
  WASHINGTON:      '6044 Washington Blvd',
  LINDELL_7325:    '7325 Lindell Blvd',
  DARTMOUTH:       '7337 Dartmouth Ave',
  INTERDRIVE:      '735 Interdrive',
  LINDELL_7350:    '7350 Lindell Studio (above Colleen\'s)',
  LIMIT_718:       '718 Limit Ave (Mosaic)',
  INTERDRIVE_725:  '725 Interdrive (Mosaic)',
  HEMAN_733:       '733 Heman Ave',
  LINDELL_7326:    '7326 Lindell Blvd (2nd floor)',
  KINGSBURY_6044:  '6044 Kingsbury Ave',
  ROSEBURY:        '6219-6221 Rosebury Ave (Rosebury Rentals)',
  MOORLANDS:       '1173 Moorlands Ave (The Dabby Group)',
  BARTMER:         '6707 Bartmer Ave',
  WASHINGTON_6008: '6008-10 Washington Blvd (Manor RE)',
  KINGSBURY_6025:  '6025 Kingsbury Ave (Manor RE)',
  KINGSBURY_6023:  '6023 Kingsbury Ave (Manor RE)',
  CORBITT:         '6766 Corbitt Ave',
  WASHINGTON_6805: '6805 Washington Ave (Byron Co)',
  DELMAR_7453:     '7453 Delmar Blvd Floor 1',
  DELMAR_7463:     '7463 Delmar Blvd #2W',
  WATERMAN_5803:   '5803 Waterman Blvd Unit 1E (Meramec Valley)',
  MCKENZIE:        'McKenzie',
  NORTHWOOD_6249:  '6249 Northwood Ave APT 2',
  WESTGATE_710:    '710 Westgate Ave #1',
  LELAND_739:      '739 Leland Ave #1',
  KINGSBURY_6651:  '6651 Kingsbury Blvd APT 1W',
  KINGSBURY_6629:  '6629 Kingsbury Blvd APT 2W',
  KINGSLAND_608:   'Kingsland Courtyard',
};

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\r' && next === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; i++; }
      else if (ch === '\n') { row.push(field.trim()); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field || row.length > 0) { row.push(field.trim()); if (row.some(f => f !== '')) rows.push(row); }
  return rows;
}

function skipHeaders(rows, minCols = 8) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] && !r[0].startsWith('PROXIMITY') && r.length >= minCols) return rows.slice(i + 1);
  }
  return [];
}

// ── Contact info parser ───────────────────────────────────────────────────────
// Column format (pipe-separated, order varies): email | Name | phone
function parseContactInfo(raw) {
  if (!raw) return { contactEmail: null, contactPhone: null, contactName: null };
  const parts = raw.split(/\s*\|\s*/);
  let email = null, phone = null, nameParts = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
      email = t.toLowerCase();
    } else if (!phone && /\d{7,}/.test(t.replace(/[^\d]/g, ''))) {
      phone = t;
    } else {
      nameParts.push(t);
    }
  }
  return { contactEmail: email, contactPhone: phone, contactName: nameParts.join(' ') || null };
}

// ── Normalizers ───────────────────────────────────────────────────────────────
function str(v) {
  if (!v) return null;
  const t = v.trim();
  if (!t || /^ask$/i.test(t) || /^no info$/i.test(t) || /^tbd$/i.test(t)) return null;
  return t;
}

function num(v) {
  if (!v) return null;
  const s = v.replace(/[~$,\s]/g, '').replace(/[–—]/g, '-').split('-')[0];
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseBool(v) {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (t === 'yes') return true;
  if (t === 'no') return false;
  return null;
}

function normalizeAvailability(v) {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (t === 'now' || t === 'immediate') return 'Immediate';
  if (t === 'tbd' || t === 'ask') return null;
  return v.trim();
}

function normalizeLeaseStructure(units) {
  // Per-bedroom = individual lease; whole unit = joint lease
  if (units.some(u => u.rawLeaseType?.toLowerCase().includes('per-bedroom') ||
                       u.rawLeaseType?.toLowerCase().includes('per bedroom'))) return 'individual';
  if (units.some(u => u.rawLeaseType?.toLowerCase().includes('per bedroom or whole'))) return 'individual';
  return 'joint';
}

// Valid leaseAvailability values: 'semester' | '10-month' | '12-month'
function normalizeLeaseAvailability(v) {
  if (!v) return null;
  const t = v.toLowerCase();
  if (t.includes('semester') || t.includes('academic')) return 'semester';
  if (t.includes('10-month') || t.includes('10 month')) return '10-month';
  if (t.includes('12-month') || t.includes('12 month') || t.includes('1 year') ||
      t.includes('year') || t.includes('annual')) return '12-month';
  if (t.includes('flexible') || t.includes('flex')) return '12-month';
  return null;
}

// Valid homeType values: 'house' | 'apartment' | 'condo' | 'townhouse' | 'singleBedroom'
function normalizeHomeType(buildingType) {
  if (!buildingType) return 'apartment';
  const t = buildingType.toLowerCase();
  if (t.includes('single-family') || t.includes('single family')) return 'house';
  if (t.includes('condo')) return 'condo';
  if (t.includes('townhouse')) return 'townhouse';
  return 'apartment';
}

// Valid amenity keys: dishwasher | extraStorage | inUnitLaundry | fireplace |
//                     gym | freeParking | mailroom | pool | petsAllowed | studyRooms
function normalizeAmenities(amenitiesText, laundryCol, parkingCol, petsCol) {
  const result = new Set();
  const text = (amenitiesText || '').toLowerCase();
  const laundry = (laundryCol || '').toLowerCase();
  const parking = (parkingCol || '').toLowerCase();
  const pets    = (petsCol    || '').toLowerCase();

  if (text.includes('pool'))                                                  result.add('POOL');
  if (text.includes('gym') || text.includes('fitness'))                      result.add('GYM');
  if (text.includes('study room') || text.includes('study lounge') ||
      text.includes('study rooms') || text.includes('co-working'))           result.add('STUDY ROOMS');
  if (text.includes('dishwasher'))                                            result.add('DISHWASHER');
  if (text.includes('fireplace'))                                             result.add('FIREPLACE');
  if (text.includes('mailroom') || text.includes('mail room') ||
      text.includes('package locker'))                                        result.add('MAILROOM');
  if (text.includes('storage') || text.includes('bike storage'))             result.add('EXTRA STORAGE');
  if (text.includes('parking') || text.includes('garage') ||
      text.includes('off-street'))                                            result.add('FREE PARKING');
  if (text.includes('laundry') || text.includes('w/d') ||
      text.includes('washer'))                                                result.add('IN UNIT LAUNDRY');

  // Laundry column
  if (laundry.includes('in-unit') || laundry.includes('in unit'))            result.add('IN UNIT LAUNDRY');

  // Parking column (non-null and not explicitly "no")
  if (parking && str(parkingCol) && !parking.startsWith('no'))               result.add('FREE PARKING');

  // Pets column
  if (pets && str(petsCol) && !pets.startsWith('no'))                        result.add('PETS ALLOWED');

  return [...result];
}

function normalizeUtilities(v) {
  if (!v) return false;
  const t = v.trim().toLowerCase();
  if (!t || /^ask$/i.test(t) || /none.*tenant/i.test(t) || /not included/i.test(t)) return false;
  return true;
}

// ── Address range expansion ───────────────────────────────────────────────────
function expandAddressRange(name, fullAddress) {
  const m = name.match(/^(\d+)[\-\uFFFD\u2013\u2014](\d+)\s+(.+?)(?:\s*\(.*\))?$/);
  if (!m) return null;

  const start = parseInt(m[1]);
  let endRaw = parseInt(m[2]);
  if (endRaw.toString().length < m[1].length) {
    const prefix = m[1].slice(0, m[1].length - endRaw.toString().length);
    endRaw = parseInt(prefix + endRaw);
  }
  if (endRaw <= start) return null;

  const street = m[3].trim();
  const results = [];
  for (let n = start; n <= endRaw; n += 2) {
    const newAddress = fullAddress
      ? fullAddress.replace(/^\d+[\-\uFFFD\u2013\u2014]\d+/, String(n))
      : null;
    results.push({ num: n, name: `${n} ${street}`, address: newAddress });
  }
  return results.length >= 2 ? results : null;
}

function assignUnitsToAddress(units, addrNum) {
  const numStr = String(addrNum);
  const matched = units.filter(u =>
    (u.name  && u.name.includes(numStr)) ||
    (u.notes && u.notes.includes(numStr))
  );
  return matched.length > 0 ? matched : units;
}

// ── Load & parse both CSVs ────────────────────────────────────────────────────
const propCsvPath = join(__dirname, 'Proximity Property Database(\uD83C\uDFE2 Properties).csv');
const unitCsvPath = join(__dirname, 'Proximity Property Database(\uD83C\uDFE0 Units).csv');
const outPath     = join(__dirname, 'properties.json');

const propRows = skipHeaders(parseCSV(readFileSync(propCsvPath, 'utf8')), 10);
const unitRows = skipHeaders(parseCSV(readFileSync(unitCsvPath, 'utf8')), 8);

// ── Build unit map ────────────────────────────────────────────────────────────
// Units CSV: 0=PropertyID 1=UnitID 2=Layout 3=Beds 4=Baths 5=Sqft 6=TotalPrice
//            7=PerPerson 8=LeaseType 9=Furnished 10=LeaseTerm 11=MoveIn
//            12=Utilities 13=Available 14=Features 15=Notes

const unitsByPropName = {};
for (const r of unitRows) {
  const propId = r[0]?.trim();
  if (!propId) continue;
  const propName = PROPERTY_ID_MAP[propId];
  if (!propName) { console.warn(`  ⚠ Unknown Property ID: ${propId}`); continue; }

  const unit = {
    name:             str(r[2]),
    rent:             num(r[6]),
    area:             num(r[5]),
    bedrooms:         num(r[3]) ?? 0,
    bathrooms:        num(r[4]) ?? 0,
    rawLeaseType:     r[8]?.trim() || '',
    leaseTerm:        r[10]?.trim() || '',
    utilitiesIncluded: normalizeUtilities(r[12]),
    notes:            str(r[15]),
  };

  if (!unitsByPropName[propName]) unitsByPropName[propName] = [];
  unitsByPropName[propName].push(unit);
}

// ── Build listing object ──────────────────────────────────────────────────────
// Properties CSV: 0=Name 1=Address 2=Neighborhood 3=WalkMain 4=WalkMed
//                 5=Shuttle 6=BuildingType 7=Landlord 8=Contact 9=Pets
//                 10=Parking 11=Laundry 12=Amenities 13=Availability
//                 14=Status 15=WashuArea 16=Notes

function buildListing(r, name, address, units) {
  const rents  = units.map(u => u.rent).filter(v => v !== null);
  const areas  = units.map(u => u.area).filter(v => v !== null);
  const beds   = units.map(u => u.bedrooms);
  const baths  = units.map(u => u.bathrooms);

  const leaseStructure   = normalizeLeaseStructure(units);
  const allLeaseTerms    = units.map(u => u.leaseTerm).filter(Boolean).join('; ');
  const leaseAvailability = normalizeLeaseAvailability(allLeaseTerms);

  const utilsTrue = units.filter(u => u.utilitiesIncluded).length;
  const utilitiesIncluded = units.length > 0 ? utilsTrue > units.length / 2 : false;

  const unitTypes = units.map(u => ({
    name:      u.name ?? '',
    rent:      u.rent,
    area:      u.area,
    bedrooms:  u.bedrooms,
    bathrooms: u.bathrooms,
  }));

  const amenities = normalizeAmenities(str(r[12]), str(r[11]), str(r[10]), str(r[9]));
  const { contactEmail, contactPhone, contactName } = parseContactInfo(str(r[8]));

  const listing = {
    address,
    description:   str(r[16]) || str(r[2]) || name,
    unitTypes,
    leaseStructure,
    ...(leaseAvailability ? { leaseAvailability } : {}),
    homeType:      normalizeHomeType(str(r[6])),
    contactEmail,
    contactPhone,
    contactName,
    amenities,
    utilitiesIncluded,
    subleaseFriendly: false,
    minRent:      rents.length ? Math.min(...rents) : null,
    maxRent:      rents.length ? Math.max(...rents) : null,
    minBathrooms: baths.length ? Math.min(...baths) : null,
    maxBathrooms: baths.length ? Math.max(...baths) : null,
    minBedrooms:  beds.length  ? Math.min(...beds)  : null,
    maxBedrooms:  beds.length  ? Math.max(...beds)  : null,
    images:       [],
    numReviews:   0,
    rating:       0,
    reviews:      [],
  };

  return listing;
}

// ── Parse + emit listings ─────────────────────────────────────────────────────
const listings = [];

for (const r of propRows) {
  const name = r[0]?.trim();
  if (!name) continue;

  const allUnits = unitsByPropName[name] || [];
  const splits   = expandAddressRange(name, str(r[1]));

  if (splits) {
    for (const split of splits) {
      const units = assignUnitsToAddress(allUnits, split.num);
      listings.push(buildListing(r, split.name, split.address, units));
    }
    console.log(`  ↳ Split "${name}" → ${splits.map(s => s.name).join(', ')}`);
  } else {
    listings.push(buildListing(r, name, str(r[1]), allUnits));
  }
}

// ── Write MongoDB paste-format output ─────────────────────────────────────────
const docs = listings
  .map(l => JSON.stringify(l, null, 2))
  .join(',\n');

const output = `/**\n * Paste one or more documents here\n */\n[\n${docs}\n]`;

writeFileSync(outPath, output, 'utf8');
console.log(`Parsed ${listings.length} properties → ${outPath}`);

const noUnits = listings.filter(l => l.unitTypes.length === 0).map(l => l.address || l.description);
if (noUnits.length) console.warn(`  ⚠ Properties with no matched units:\n    ${noUnits.join('\n    ')}`);

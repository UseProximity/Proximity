/*
 * Compare Listings panel of the /browse page: two listings side by side, picked
 * from the grid. It lays over the map area; AvailableListings owns the selection
 * and passes it in as slots ([left, right], each a listing or null).
 *
 * A listing with several units gets a selector, and its unit rows show the
 * selected unit only. Within that unit, a value that differs between its lease
 * offerings is shown as the range across them, never a single pick. The winner of
 * the objective rows gets a small "Better" pill (see compareBest.js).
 */
"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Minus, X } from "lucide-react";
import { buildUnitTabs } from "@proximity/shared";
import HeartIcon from "@/components/ui/HeartIcon";
import AmenityPill, { AMENITY_LABELS, UTILITY_LABELS } from "@/components/listings/AmenityPill";
import { Winner, bestRows } from "@/components/listings/compareBest";
import { availabilityLabel } from "@/utils/availability";
import { durationLabel } from "@/components/listings/LeaseOptions";
import {
  getCampusWalkMinutes,
  getListingHeading,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

// The listing's units in the order of the listing page (the landlord's order,
// then beds, then baths), each with its label.
function unitTabs(listing) {
  const units = listing.unitTypes ?? [];
  const tabs = buildUnitTabs(units);
  // A listing with no available unit (greyed out in the grid) still shows its units.
  return tabs.length ? tabs : buildUnitTabs(units.map((u) => ({ ...u, available: true })));
}

// The unit a card shows when it opens. It is the unit that satisfied the active
// filters (as the detail panel does), or the first unit when nothing was filtered.
function initialPick(listing, tabs) {
  const matched = listing?.matchedUnitId;
  const i = matched ? tabs.findIndex((tab) => tab.unit.id === matched) : -1;
  return i > 0 ? i : 0;
}

// The unit rows are the selected unit's; the building rows are the listing's.
function compareRows(listing, unit) {
  const leases = unit?.leases ?? [];

  // The rent as the listing page labels it: "/person" only where the landlord
  // said the rent is per person, "/mo" otherwise. Each basis is its own range, so
  // a unit whose leases disagree shows both, side by side, instead of a range that
  // mixes per-person and whole-unit rents.
  const rents = [false, true]
    .map((perPerson) => [perPerson, getRentRangeLabel(leases.filter((l) => !!l.rentIsPerPerson === perPerson))])
    .filter(([, rent]) => rent !== "Contact for Pricing");

  const bedText =
    unit?.bedrooms == null
      ? "N/A"
      : unit.bedrooms === 0
      ? "Studio"
      : `${unit.bedrooms} ${unit.bedrooms === 1 ? "bedroom" : "bedrooms"}`;
  const bathText =
    unit?.bathrooms == null
      ? "N/A"
      : `${unit.bathrooms} ${unit.bathrooms === 1 ? "bathroom" : "bathrooms"}`;

  const dates = leases.map((l) => l.availableFrom).filter(Boolean).sort();
  const from = dates.length ? availabilityLabel(dates[0]).text : null;
  const to = dates.length ? availabilityLabel(dates[dates.length - 1]).text : null;

  const furnished = new Set(leases.map((l) => l.furnished).filter((f) => f != null));

  const campus = getCampusWalkMinutes(listing);
  const shuttle = listing.shuttleWalkMinutes;
  const reviews = Number(listing.numReviews) || 0;
  const area = Number(unit?.area);

  return [
    [
      "Price:",
      rents.length ? (
        rents.map(([perPerson, rent], i) => (
          <span key={perPerson}>
            {i > 0 && " · "}
            <span className="font-bold">{rent}</span>
            {perPerson ? "/person" : "/mo"}
          </span>
        ))
      ) : (
        <span className="font-bold">Contact for Pricing</span>
      ),
    ],
    ["Rooms:", `${bedText}\n${bathText}`],
    ["Area:", area > 0 ? `${area.toLocaleString("en-US")} sq ft` : "N/A"],
    ["Available on:", !from ? "N/A" : from === to ? from : `${from} to ${to}`],
    [
      "Duration:",
      durationLabel(leases.flatMap((l) => l.leaseTermMonths ?? [])) ?? "N/A",
    ],
    [
      "Furnished:",
      !furnished.size ? "N/A" : furnished.size > 1 ? "Both options" : furnished.has(true) ? "Furnished" : "Unfurnished",
    ],
    ["Distance to campus:", campus != null ? `${campus} min walk` : "N/A"],
    ["Distance to shuttle:", typeof shuttle === "number" ? `${shuttle} min walk` : "N/A"],
    [
      "Rating:",
      reviews > 0 && Number(listing.rating) > 0
        ? `${Number(listing.rating).toFixed(1)} (${reviews} review${reviews === 1 ? "" : "s"})`
        : "No reviews yet",
    ],
  ];
}

// The unit selector: one row of pills. A building with many units overflows the
// card, and the row has no scrollbar, so an arrow shows on each side that has
// more units to reach. The picked unit is always scrolled into view.
function UnitPills({ tabs, picked, onPick }) {
  const rowRef = useRef(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = () => {
    const row = rowRef.current;
    if (!row) return;
    const left = row.scrollLeft > 1;
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useLayoutEffect(() => {
    const row = rowRef.current;
    const pill = row?.children[picked];
    if (pill) {
      const start = pill.offsetLeft;
      const end = start + pill.offsetWidth;
      // Room for the arrow that lies over each end of the row.
      if (start < row.scrollLeft + 28) row.scrollLeft = start - 28;
      else if (end > row.scrollLeft + row.clientWidth - 28) row.scrollLeft = end - row.clientWidth + 28;
    }
    measure();
  }, [picked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir) => {
    const row = rowRef.current;
    row.scrollBy({ left: dir * row.clientWidth * 0.7, behavior: "smooth" });
  };
  const arrow = "absolute inset-y-0 flex items-center from-white via-white to-transparent text-gray-600 transition-colors hover:text-gray-900";
  return (
    <div className="relative mt-1">
      <div ref={rowRef} onScroll={measure} className="scrollbar-hidden relative flex gap-1.5 overflow-x-auto">
        {tabs.map((tab, i) => (
          <button
            key={tab.unit.id ?? i}
            onClick={() => onPick(i)}
            aria-pressed={i === picked}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              i === picked
                ? "bg-gray-200 text-gray-700 border-gray-300"
                : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {more.left && (
        <button onClick={() => step(-1)} aria-label="Earlier units" className={`${arrow} left-0 bg-gradient-to-r pr-3`}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {more.right && (
        <button onClick={() => step(1)} aria-label="More units" className={`${arrow} right-0 bg-gradient-to-l pl-3`}>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// The cells of the comparison table. Each column is a subgrid over the table's
// rows, so a row is as tall as its taller cell in every column.
const COLUMNS = "grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)]";
const ROW = "flex items-center border-t border-[#e6e7eb] py-4";

// `tabs` are the listing's units; `reserve` is set when either listing has several,
// so both columns keep the selector's height and their rows line up. `rows` is the
// grid row span of the table.
function Slot({ listing, tabs, picked, onPick, best, reserve, rows, empty, onRemove }) {
  if (!listing) {
    return (
      <div className="min-w-0 p-3.5" style={{ gridRow: rows }}>
        <div className="flex h-full justify-center rounded-[20px] border border-dashed border-red-200 bg-[#fffafa]">
          <div className="flex flex-col items-center gap-4 px-8 pt-28 text-center">
            <div className="relative flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-red-100/70 motion-safe:animate-pulse" />
              <ArrowLeft className="relative h-7 w-7 text-red-600" />
            </div>
            <div>
              <p className="text-base font-bold text-black">{empty[0]}</p>
              <p className="mt-1 max-w-[16rem] text-balance text-sm text-gray-500">{empty[1]}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const { title, subtitle } = getListingHeading(listing);
  const image = listing.images?.[0];
  return (
    <div className="grid min-w-0 grid-rows-subgrid [&>:nth-child(even)]:bg-[#fff9f9]" style={{ gridRow: rows }}>
      <div className="min-w-0">
        <div className="relative m-2 aspect-[363/164] overflow-hidden rounded-t-[15px] bg-gray-100">
          {image ? (
            <Image src={image} alt={listing.address} fill sizes="30vw" priority className="object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              No image
            </div>
          )}
          <button
            onClick={onRemove}
            aria-label="Remove from comparison"
            className="absolute left-2 top-2 rounded-full border border-white/50 bg-white/90 p-1 text-gray-600 shadow-md transition-colors hover:text-gray-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          {/* The heart of the grid cards, same place and same behaviour. */}
          <div className="absolute right-2 top-2">
            <HeartIcon listingId={listing._id} />
          </div>
        </div>
        <div className="px-4 pb-4 pt-1">
          <h3 className="truncate text-base font-bold text-black">{title}</h3>
          <p className="truncate text-xs font-medium text-[#404040]">{subtitle}</p>
          {/* New tab, so the comparison (kept only in memory) is not lost. */}
          <a
            href={`/listings/${listing._id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            View listing
          </a>
        </div>
        {reserve && (
          <div className="h-14 px-4 pt-1">
            {tabs.length > 1 && (
              <>
                <p className="text-xs text-black">{tabs.length} units</p>
                <UnitPills tabs={tabs} picked={picked} onPick={onPick} />
              </>
            )}
          </div>
        )}
      </div>
      {compareRows(listing, tabs[picked]?.unit).map(([label, value]) => (
        <div key={label} className={`${ROW} whitespace-pre-line px-6 text-base font-medium text-[#495564]`}>
          {best.has(label) ? <Winner>{value}</Winner> : value}
        </div>
      ))}
    </div>
  );
}

// Two entries are the same item whatever their case or spacing.
const norm = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
const inList = (list, item) => list.some((x) => norm(x) === norm(item));

// A listing's amenities or utilities as the details panel labels them: the
// standard ones by their label, then the free-text ones as written. An item that
// is both (a standard "Gym" and a custom "gym") is one, under the standard label.
function listLabels(keys, labels, custom = []) {
  const items = [...(keys ?? []).map((k) => labels[k] || labels[k?.toLowerCase()]), ...(custom ?? [])];
  return items.filter(Boolean).filter((x, i, all) => all.findIndex((y) => norm(y) === norm(x)) === i);
}

function Pills({ items }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <AmenityPill key={item} label={item} />
      ))}
    </div>
  );
}

function Mark({ has }) {
  return has ? (
    <span role="img" aria-label="Has it" className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  ) : (
    <Minus role="img" aria-label="Not listed" className="h-4 w-4 text-gray-400" />
  );
}

// A section of the table: what the two listings share, shown once, then a row per
// item only one of them has. An empty list almost always means "not listed", not
// "none", so when a listing lists nothing no overlap is claimed: the other
// listing's items each get a check, and this one a dash.
function ListSection({ title, a, b }) {
  const mixed = a.length > 0 && b.length > 0;
  const both = mixed ? a.filter((x) => inList(b, x)) : [];
  const items = [...a, ...b.filter((x) => !inList(a, x))].filter((x) => !inList(both, x));
  // A comparison is only claimed when both listings list something.
  const summary = !mixed
    ? null
    : items.length
    ? `${both.length} shared · ${items.length} ${items.length === 1 ? "difference" : "differences"}`
    : `All ${both.length} shared`;
  const label = `${ROW} px-4 text-xs text-black`;
  return (
    <>
      <div className={`${ROW} col-span-3 justify-between gap-3 px-4 py-3`}>
        <h3 className="text-base font-bold text-black">{title}</h3>
        {summary && <span className="text-xs font-medium text-red-700">{summary}</span>}
      </div>
      {!a.length && !b.length ? (
        <p className={`${ROW} col-span-3 px-4 text-sm text-gray-500`}>Not listed</p>
      ) : (
        <>
          {both.length > 0 && (
            <>
              <p className={label}>Both have</p>
              <div className={`${ROW} col-span-2 border-l px-6`}>
                <Pills items={both} />
              </div>
            </>
          )}
          {items.map((item) => (
            <Fragment key={item}>
              <p className={label}>{item}</p>
              {[a, b].map((list, i) => (
                <div key={i} className={`${ROW} border-l px-6`}>
                  <Mark has={inList(list, item)} />
                </div>
              ))}
            </Fragment>
          ))}
        </>
      )}
    </>
  );
}

export default function ComparePanel({ slots, onRemove, onClose }) {
  const tabs = slots.map((l) => l && unitTabs(l));
  // The unit each card shows is kept here, not in the card, because the winners
  // are found by comparing the two selected units. A slot's pick is dropped when its
  // listing leaves, so a removed or replaced listing starts again from its
  // initial unit.
  const [picks, setPicks] = useState({});
  const pickKey = (i) => `${i}-${slots[i]?._id}`;
  const pickedOf = (i) => picks[pickKey(i)] ?? initialPick(slots[i], tabs[i]);
  useEffect(() => {
    const live = new Set(slots.map((l, i) => l && `${i}-${l._id}`));
    setPicks((p) => {
      const kept = Object.entries(p).filter(([k]) => live.has(k));
      return kept.length === Object.keys(p).length ? p : Object.fromEntries(kept);
    });
  }, [slots]);
  const best = bestRows(slots, slots.map((l, i) => l && tabs[i][pickedOf(i)]?.unit));
  const reserve = tabs.some((t) => t?.length > 1);
  // The title and hint of an empty slot: the next step is in the grid on the left.
  const empty = slots.some(Boolean)
    ? ["Pick another listing", "Click a second listing in the grid on the left to compare it with this one."]
    : ["Pick a listing", "Click any listing in the grid on the left to start comparing."];
  // The row labels are the same for every listing and unit, so the first listing's give them.
  const first = slots.find(Boolean);
  const labels = first ? compareRows(first).map(([label]) => label) : [];
  const rows = `1 / span ${labels.length + 1}`;
  const both = slots.every(Boolean);
  // Once the header (photos and titles) has scrolled out of view, a compact bar
  // pinned to the top keeps each column identifiable. The empty first cell of the
  // label column is exactly as tall as the header row, so it is what is watched.
  const scroller = useRef(null);
  const head = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!head.current) return;
    const observer = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root: scroller.current });
    observer.observe(head.current);
    return () => observer.disconnect();
  }, [!!first]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex h-full flex-col rounded-[20px] border border-[#e6e7eb] bg-[#f9fafb]">
      <div className="relative flex shrink-0 items-center justify-center py-4">
        <button
          onClick={onClose}
          aria-label="Close compare"
          className="absolute left-4 rounded-full p-1 text-gray-500 transition-colors hover:text-gray-900"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-xl font-bold text-black">Compare listings</h2>
      </div>
      {/* The scroller is this outer box. The table is at least as tall as it
          (so empty slots fill the panel) and grows past it with the rows. */}
      <div ref={scroller} className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col px-3.5 pb-3.5">
          {/* overflow-clip rounds the corners without making the card a scroll
              container, which would stop the pinned bar from sticking. */}
          <div className={`flex flex-col overflow-clip rounded-[20px] border border-[#e6e7eb] bg-white ${both ? "" : "flex-1"}`}>
            {first && (
              <div className="sticky top-0 z-10 h-0">
                <div
                  aria-hidden={!stuck}
                  className={`absolute inset-x-0 grid divide-x divide-[#e6e7eb] border-b border-[#e6e7eb] bg-white shadow-sm transition-opacity ${COLUMNS} ${
                    stuck ? "" : "pointer-events-none opacity-0"
                  }`}
                >
                  <div />
                  {slots.map((listing, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-2 px-3 py-2">
                      {listing && (
                        <>
                          <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md bg-gray-100">
                            {listing.images?.[0] && (
                              <Image src={listing.images[0]} alt="" fill sizes="32px" className="object-cover" />
                            )}
                          </div>
                          <p className="truncate text-xs font-bold text-black">{getListingHeading(listing).title}</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className={`grid flex-1 divide-x divide-[#e6e7eb] ${first ? COLUMNS : "grid-cols-2"}`}>
              {first && (
                <div className="grid grid-rows-subgrid [&>:nth-child(even)]:bg-[#fff9f9]" style={{ gridRow: rows }}>
                  <div ref={head} />
                  {labels.map((label) => (
                    <div key={label} className={`${ROW} px-4 text-xs text-black`}>
                      {label}
                    </div>
                  ))}
                </div>
              )}
              {slots.map((listing, i) => (
                <Slot
                  key={`${i}-${listing?._id}`}
                  listing={listing}
                  tabs={tabs[i]}
                  picked={listing ? pickedOf(i) : 0}
                  onPick={(n) => setPicks((p) => ({ ...p, [pickKey(i)]: n }))}
                  best={best[i]}
                  reserve={reserve}
                  rows={rows}
                  empty={empty}
                  onRemove={() => onRemove(i)}
                />
              ))}
            </div>
            {both && (
              <div className={`grid ${COLUMNS}`}>
                <ListSection
                  title="Amenities"
                  a={listLabels(slots[0].amenities, AMENITY_LABELS, slots[0].customAmenities)}
                  b={listLabels(slots[1].amenities, AMENITY_LABELS, slots[1].customAmenities)}
                />
                <ListSection
                  title="Utilities included"
                  a={listLabels(slots[0].utilitiesIncluded, UTILITY_LABELS)}
                  b={listLabels(slots[1].utilitiesIncluded, UTILITY_LABELS)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

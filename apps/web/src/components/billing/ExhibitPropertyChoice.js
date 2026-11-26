"use client";

/*
 * One property on the Exhibit A step: the landlord's signing popup
 * (AgreementSigningFlow) and the admin's paper agreement (Wyatt, 2026-11-17) use
 * the same picker, so a paper copy is chosen exactly as one signed in the app.
 */
import { useState } from "react";
import { Pencil } from "lucide-react";

const FIELD = "rounded-md border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";
export const BUTTON = "rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A JSON call. While another call for this landlord holds the signing lock (a
// background build still finishing) the sign route answers 409 "in_progress":
// with `retries`, wait and ask again rather than show that.
export async function call(url, { method = "GET", body, retries = 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method,
      ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 409 && data.code === "in_progress" && attempt < retries) {
      await wait(1500);
      continue;
    }
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
}

// One unit on the Exhibit A step: tick it, or rename it with the pencil.
function UnitRow({ unit, checked, disabled, note, onToggle, onRenamed, canEdit = true }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(unit.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("/api/billing/agreement/units", { method: "PATCH", body: { unitId: unit.id, name } });
      onRenamed(unit.label, r.unit.label);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (editing) {
    return (
      <li className="flex w-full flex-wrap items-center gap-2">
        <input className={`${FIELD} w-40`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Unit name" autoFocus />
        <button type="button" className={BUTTON} disabled={busy || !name.trim()} onClick={save}>
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => { setEditing(false); setName(unit.label); }}>
          Cancel
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </li>
    );
  }
  return (
    <li className="inline-flex items-center gap-1" title={note ?? undefined}>
      <label className="flex min-w-0 items-center gap-1.5 text-sm text-gray-800">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="truncate">{unit.label}</span>
        {note && <span className="text-xs text-gray-400">({note})</span>}
      </label>
      {canEdit && (
        <button type="button" className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setEditing(true)} aria-label={`Rename ${unit.label}`}>
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// Add a unit the property is missing: a real unit, unpublished, with no leases.
function AddUnit({ listingId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", bedrooms: "1", bathrooms: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!open) {
    return (
      <button type="button" className="text-sm font-medium text-red-700 hover:underline" onClick={() => setOpen(true)}>
        + Add a unit
      </button>
    );
  }
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("/api/billing/agreement/units", { method: "POST", body: { listingId, ...v } });
      onAdded(r.unit);
      setV({ name: "", bedrooms: "1", bathrooms: "1" });
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-md bg-gray-50 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-600">
          Unit name
          <input className={`${FIELD} mt-0.5 block w-36`} value={v.name} maxLength={60} placeholder="1A" onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus />
        </label>
        <label className="text-xs text-gray-600">
          Beds
          <input className={`${FIELD} mt-0.5 block w-16`} inputMode="numeric" value={v.bedrooms} onChange={(e) => setV({ ...v, bedrooms: e.target.value })} />
        </label>
        <label className="text-xs text-gray-600">
          Baths
          <input className={`${FIELD} mt-0.5 block w-16`} inputMode="decimal" value={v.bathrooms} onChange={(e) => setV({ ...v, bathrooms: e.target.value })} />
        </label>
        <button type="button" className={BUTTON} disabled={busy || !v.name.trim()} onClick={add}>
          {busy ? "Adding..." : "Add"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-500">It is added to the property without any leases, hidden from students until you add a lease to it.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

// Units holding the landlord's leases that this choice leaves uncovered: their
// leases come off the site when the document is signed (Wyatt, 2026-11-07).
export function droppedUnits(p, c) {
  if (!c?.include || c.wholeBuilding) return [];
  const covered = new Set(p.covered && !p.covered.wholeBuilding ? p.covered.units : []);
  const required = new Set(p.requiredUnits ?? []);
  return (p.leaseUnits ?? []).filter((u) => !c.units.includes(u) && !covered.has(u) && !required.has(u));
}
export const hasListings = (p) => p.live || (p.leaseUnits ?? []).length > 0;
export const listWords = (xs) => (xs.length < 3 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

// One property on the Exhibit A step: on it or left off (anything not being
// published or already covered; its listings then come off the site), the whole
// building or its units. What is covered already shows as covered and stays.
// `admin`: an admin choosing for the landlord (a paper agreement, Wyatt
// 2026-11-17): worded about the landlord, and units can't be added or renamed here.
// `badge`: an extra note beside the status, like "On the printed copy".
export default function PropertyChoice({ p, choice, onChange, admin = false, badge = null }) {
  const your = admin ? "their" : "your";
  const signs = admin ? "the signed copy is recorded" : "you sign";
  const covered = p.covered;
  const coveredUnits = new Set(covered?.wholeBuilding ? [] : covered?.units ?? []);
  const leaseUnits = new Set(p.leaseUnits ?? []);
  // Units being published right now stay on (the reason this popup opened).
  const required = new Set(p.requiredUnits ?? []);
  const dropped = droppedUnits(p, choice);
  const toggleUnit = (label, on) => {
    const set = new Set(choice.units);
    if (on) set.add(label);
    else set.delete(label);
    onChange({ ...choice, units: [...set] });
  };
  const status = covered ? `On ${your} agreement` : p.locked ? (p.live ? "Live" : "Being published") : "Draft";
  return (
    <li className="space-y-2 rounded-md border border-gray-200 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-gray-900">{p.address}</p>
        {badge && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800">{badge}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.locked ? "bg-green-50 text-green-800" : "bg-gray-100 text-gray-600"}`}>{status}</span>
      </div>
      {p.canExclude && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!choice.include} onChange={(e) => onChange({ ...choice, include: !e.target.checked })} />
          Exclude this property
        </label>
      )}
      {covered?.wholeBuilding ? (
        <p className="text-xs text-gray-500">Already covered: the whole building.</p>
      ) : !choice.include ? (
        hasListings(p) ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {admin ? "They have" : "You have"} listings here. Excluding this property withdraws them from the site when {signs}, so students will no longer see them.{" "}
            {admin ? "They" : "You"} can publish them again later by adding it to {your} agreement with a short addendum.
          </p>
        ) : (
          <p className="text-xs text-gray-500">Not covered. To publish it later, {admin ? "they" : "you"} will add it to {your} agreement with a short addendum.</p>
        )
      ) : (
        <>
          {p.canWholeBuilding ? (
            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input type="radio" name={`whole-${p.listingId}`} checked={choice.wholeBuilding} onChange={() => onChange({ ...choice, wholeBuilding: true })} />
                Whole building
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={`whole-${p.listingId}`} checked={!choice.wholeBuilding} onChange={() => onChange({ ...choice, wholeBuilding: false })} />
                Specific units
              </label>
            </div>
          ) : (
            <p className="text-xs text-gray-500">{admin ? "They list" : "You list"} units here but do not own the building, so name the units this agreement covers.</p>
          )}
          {choice.wholeBuilding ? (
            <p className="text-xs text-gray-500">Covers every unit in the building, including ones {admin ? "they add" : "you add"} later.</p>
          ) : (
            <div className="space-y-2">
              {/* Exhibit A: "Units: ..., and any unit at this address the landlord later lists through Proximity." (Wyatt, 2026-11-07) */}
              <p className="text-xs text-gray-500">Also covers any unit {admin ? "they list" : "you list"} at this address later, so adding one never needs another addendum.</p>
              {p.units.length ? (
                // Side by side, wrapping, so a property with many units stays short.
                <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {p.units.map((u) => (
                    <UnitRow
                      key={u.id}
                      unit={u}
                      checked={coveredUnits.has(u.label) || required.has(u.label) || choice.units.includes(u.label)}
                      disabled={coveredUnits.has(u.label) || required.has(u.label)}
                      canEdit={!admin}
                      note={coveredUnits.has(u.label) ? "already covered" : required.has(u.label) ? "being published" : leaseUnits.has(u.label) ? `has ${your} listings` : null}
                      onToggle={(on) => toggleUnit(u.label, on)}
                      onRenamed={(from, to) => onChange({ ...choice, units: choice.units.map((x) => (x === from ? to : x)), renamed: [from, to] })}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-500">{admin ? (p.canWholeBuilding ? "No units on this property yet. Choose the whole building, or exclude it." : "No units on this property yet, so it can only be excluded. Add its units on the listing first to cover them.") : "No units on this property yet. Add the ones this agreement covers."}</p>
              )}
              {dropped.length > 0 && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {admin ? "Their" : "Your"} listings on {listWords(dropped)} will be withdrawn from the site when {signs}, since {dropped.length === 1 ? "that unit is" : "those units are"} not
                  covered. {admin ? "They" : "You"} can publish them again later by adding {dropped.length === 1 ? "it" : "them"} with a short addendum.
                </p>
              )}
              {!admin && <AddUnit listingId={p.listingId} onAdded={(unit) => onChange({ ...choice, units: [...choice.units, unit.label], added: unit })} />}
            </div>
          )}
        </>
      )}
    </li>
  );
}

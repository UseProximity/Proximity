"use client";

/*
 * The property's one gallery, and each unit's floor plan.
 *
 * Photos are not split by unit any more. A property has a single gallery, and a
 * photo says which apartments it shows through unit tags: the "+ Units" button
 * in each photo's corner. A picture of the shared kitchen can carry every unit,
 * a bedroom just the one it is in.
 *
 * Ownership still decides what you can touch. The property owner arranges, tags
 * and prunes everything. A landlord letting a unit here can add photos, and tag
 * and remove their own, with the units they let. Other people's photos are shown
 * but locked.
 *
 * The floor plan stays per unit: it is a diagram of one apartment, not a photo,
 * and it has exactly one slot.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, Plus, Trash2, LayoutGrid, Tag, Check } from "lucide-react";
import toast from "react-hot-toast";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";
import { compressImage } from "@/utils/compressImage";
import { uploadImagesToR2 } from "@/utils/uploadImagesToR2";

const BUSY_LABEL = {
  upload: "Uploading…",
  remove: "Deleting…",
  reorder: "Saving order…",
};

function Row({ label, hint, photos, canAdd, canMoveAll, listingId, unitId, onChanged, renderCorner, children }) {
  // null when idle, otherwise which act is in flight — a delete used to report
  // itself as "Saving order…", which is a different thing happening.
  const [busy, setBusy] = useState(null);
  const movable = canMoveAll ? photos : photos.filter((p) => p.mine);
  const pinned = canMoveAll ? [] : photos.filter((p) => !p.mine);
  const inputId = `img-${unitId ?? "property"}`;

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy("upload");
    try {
      // Downscale the same way the add-listing flow does, then send files
      // straight to R2 via presigned URLs — same flow as AddListingWizard and
      // ImageManagerPanel, which bypasses Vercel's serverless body limit
      // entirely rather than working around it.
      const compressed = await Promise.all(files.map(compressImage));
      await uploadImagesToR2({ listingId, unitId, files: compressed });
      await onChanged();
    } catch (err) {
      toast.error(err.message || "Those photos couldn't be added.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (url) => {
    const photo = photos.find((p) => p.url === url);
    if (!photo) return;
    setBusy("remove");
    try {
      const res = await fetch(`/api/landlord/photos/${photo.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "That photo couldn't be removed.");
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(null);
    }
  };

  const reorder = async (urls) => {
    setBusy("reorder");
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return toast.error(data.error || "That order couldn't be saved.");
      }
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-t border-gray-100 px-4 py-3 first:border-t-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h4>
        <span className="text-xs text-gray-400">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
        </span>
        {hint && <span className="text-xs text-gray-400">· {hint}</span>}
        {canAdd && (
          <>
            <label
              htmlFor={inputId}
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:text-red-600"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </label>
            <input
              id={inputId} type="file" accept="image/*" multiple className="hidden"
              disabled={busy}
              onChange={(e) => { upload([...e.target.files]); e.target.value = ""; }}
            />
          </>
        )}
      </div>

      <div className="flex items-start gap-3">
        {children}
        <div className="min-w-0 flex-1">
          {movable.length > 0 && (
            <DraggableImageGrid
              images={movable.map((p) => p.url)}
              onReorder={reorder}
              onRemove={remove}
              saving={!!busy}
              busyLabel={BUSY_LABEL[busy] ?? "Working…"}
              renderCorner={renderCorner}
            />
          )}
          {pinned.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-400">
                <Lock className="h-3 w-3" />
                Another landlord&apos;s — shown to renters, not yours to change.
              </p>
              <div className="flex flex-wrap gap-2">
                {pinned.map((p) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={p.id} src={p.url} alt=""
                    className="h-14 w-20 rounded-md object-cover opacity-60 ring-1 ring-gray-200" />
                ))}
              </div>
            </div>
          )}
          {photos.length === 0 && (
            <p className="text-xs text-gray-400">
              {canAdd ? "No photos yet." : "None yet — the property owner adds these."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// The floor plan: one slot, far left of the unit row.
function FloorPlanSlot({ unit, canEdit, listingId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const url = unit?.floorPlanImageUrl || null;

  const set = async (value) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/units/${unit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ floorPlanImageUrl: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return toast.error(d.error || "Couldn't save the floor plan.");
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      // Same presigned R2 flow as the photo rows above. `attach: false` keeps
      // it out of the unit's photo gallery — it belongs in the floor plan slot
      // alone, not in both places. PDFs pass through untouched: only the
      // transport changed, not what's accepted.
      const { urls } = await uploadImagesToR2({
        listingId,
        unitId: unit.id,
        files: [file],
        attach: false,
      });
      if (urls[0]) await set(urls[0]);
    } catch (err) {
      toast.error(err.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const inputId = `fp-${unit?.id}`;
  return (
    <div className="w-28 shrink-0">
      {/* The heading is part of the target too: people click the words "Floor
          plan" as readily as the box under them. */}
      <label
        htmlFor={canEdit ? inputId : undefined}
        className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${
          canEdit && !url ? "cursor-pointer hover:text-red-500" : ""
        }`}
      >
        <LayoutGrid className="h-3 w-3" /> Floor plan
      </label>
      {url ? (
        <div className="group relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Floor plan" className="h-20 w-28 rounded-md object-cover ring-1 ring-gray-200" />
          {canEdit && (
            <button
              type="button" onClick={() => set(null)} disabled={busy}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
              aria-label="Remove floor plan"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : canEdit ? (
        <>
          {/* An empty slot has to read as something you can click. It used to be
              a dashed box with faint "+ Add" text, which looked like a
              placeholder for a picture that hadn't loaded. */}
          <label htmlFor={inputId}
            className="flex h-20 w-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 text-gray-400 transition hover:border-red-400 hover:bg-red-50 hover:text-red-500">
            {busy ? (
              <span className="text-xs">Uploading…</span>
            ) : (
              <>
                <Plus className="h-5 w-5" />
                <span className="text-[11px] font-medium">Add plan</span>
              </>
            )}
          </label>
          <input id={inputId} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </>
      ) : (
        <div className="flex h-20 w-28 items-center justify-center rounded-md bg-gray-50 text-xs text-gray-300">
          None
        </div>
      )}
    </div>
  );
}

// What a unit is called on a tag: its identity, then the landlord's name for
// the floor plan, then its shape. Same order as the unit tabs.
function unitLabel(unit) {
  if (unit.identityLabel) return unit.identityLabel;
  if (unit.title) return unit.title;
  if ((unit.bedrooms ?? 0) === 0 && unit.bedrooms != null) return "Studio";
  return `${unit.bedrooms ?? "?"} bd · ${unit.bathrooms ?? "?"} ba`;
}

/*
 * The "+ Units" control in a photo's corner, and the small pop-up it opens.
 *
 * The pop-up is portalled to the page body because each photo tile clips its
 * contents (overflow-hidden), which would cut the list off at the tile's edge.
 * Every tick saves straight away: there is nothing else on the pop-up to
 * confirm, and a Save button would just be one more thing to forget.
 */
function UnitTagButton({ photo, units, allowedUnitIds, onChanged }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const tagged = new Set(photo.unitIds ?? []);
  const count = units.filter((u) => tagged.has(u.id)).length;

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    const reposition = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggleOpen = (e) => {
    e.stopPropagation();
    if (open) return setOpen(false);
    const r = btnRef.current.getBoundingClientRect();
    // Open below the button, or above it when there is no room underneath.
    const below = window.innerHeight - r.bottom > 220;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 232)),
      top: below ? r.bottom + 6 : undefined,
      bottom: below ? undefined : window.innerHeight - r.top + 6,
    });
    setOpen(true);
  };

  const toggleUnit = async (unitId) => {
    const next = new Set(tagged);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    setSaving(true);
    try {
      const res = await fetch(`/api/landlord/photos/${photo.id}/units`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitIds: [...next] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't save those units.");
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        aria-label="Tag this photo with units"
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white shadow transition ${
          count ? "bg-red-600 hover:bg-red-700" : "bg-black/60 hover:bg-black/80"
        }`}
      >
        {count ? (
          <>
            <Tag className="h-2.5 w-2.5" />
            {count} {count === 1 ? "unit" : "units"}
          </>
        ) : (
          <>
            <Plus className="h-2.5 w-2.5" />
            Units
          </>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom }}
            className="z-[80] w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
          >
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Show this photo on
            </p>
            {units.length === 0 ? (
              <p className="px-2 pb-2 text-xs text-gray-400">This property has no units yet.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {units.map((u) => {
                  const allowed = !allowedUnitIds || allowedUnitIds.has(u.id);
                  const on = tagged.has(u.id);
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={!allowed || saving}
                        onClick={() => toggleUnit(u.id)}
                        title={allowed ? undefined : "You can only tag units you have a listing on."}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            on ? "border-red-600 bg-red-600 text-white" : "border-gray-300"
                          }`}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="truncate">{unitLabel(u)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/**
 * The property's gallery: every photo at the building, each with its unit tags.
 */
export function PropertyPhotoRow({ listing, isPropertyOwner, onChanged }) {
  const photos = listing?.photos ?? [];
  const units = listing?.unitTypes ?? [];
  /*
   * Which units this person may tag with. The owner: all of them. Anyone else:
   * the units they have a live offering on, which is also what the server
   * allows (canTagPhoto).
   */
  const allowedUnitIds = isPropertyOwner
    ? null
    : new Set(
        (listing?.myLeases ?? []).filter((l) => l.isActive).map((l) => l.unitId)
      );
  const byUrl = new Map(photos.map((p) => [p.url, p]));
  const canTag = (photo) => isPropertyOwner || (photo.mine && allowedUnitIds.size > 0);

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <Row
        label="Photos"
        hint={
          isPropertyOwner
            ? "First photo is the cover · Tag photos with the units they show"
            : "Add photos of your unit, then tag them with it"
        }
        photos={photos}
        canAdd
        canMoveAll={isPropertyOwner}
        listingId={listing?._id || listing?.id}
        unitId={null}
        onChanged={onChanged}
        renderCorner={(url) => {
          const photo = byUrl.get(url);
          if (!photo || !canTag(photo)) return null;
          return (
            <UnitTagButton
              photo={photo}
              units={units}
              allowedUnitIds={allowedUnitIds}
              onChanged={onChanged}
            />
          );
        }}
      />
    </div>
  );
}

/**
 * One unit's floor plan. Rendered inside that unit's panel.
 */
export function UnitFloorPlan({ listing, unit, onChanged }) {
  const listingId = listing?._id || listing?.id;
  return (
    <div className="border-t border-gray-100 px-4 py-3">
      {/* Editable by anyone who may add to this unit: the property owner, or a
          landlord letting it. The server only lets a non-owner fill an empty
          slot, never replace the owner's plan. */}
      <FloorPlanSlot unit={unit} canEdit listingId={listingId} onChanged={onChanged} />
    </div>
  );
}

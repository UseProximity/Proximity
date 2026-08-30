"use client";

/*
 * The property's photos on top, the open unit's underneath.
 *
 * They are two rows rather than one gallery because they belong to different
 * people: the building's pictures are the property owner's, and a unit's may
 * have been added by whoever is letting it. Stacking them makes that ownership
 * visible at a glance instead of burying it in a permission error when someone
 * tries to delete the wrong one.
 *
 * The floor plan sits at the far left of the unit row — it is a picture OF the
 * unit, but a diagram rather than a photo, and it has exactly one slot.
 */

import { useState } from "react";
import { Lock, Plus, Trash2, LayoutGrid } from "lucide-react";
import toast from "react-hot-toast";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";

const BUSY_LABEL = {
  upload: "Uploading…",
  remove: "Deleting…",
  reorder: "Saving order…",
};

function Row({ label, hint, photos, canAdd, canMoveAll, listingId, unitId, onChanged, children }) {
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
      const form = new FormData();
      form.append("listingId", listingId);
      if (unitId) form.append("unitId", unitId);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/upload", { method: "PATCH", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Those photos couldn't be added.");
      await onChanged();
    } catch {
      toast.error("Network error.");
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
        body: JSON.stringify({ urls, unitId: unitId ?? null }),
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
      const form = new FormData();
      form.append("listingId", listingId);
      form.append("unitId", unit.id);
      form.append("files", file);
      // Store it, but keep it out of the unit's photo gallery — it belongs in
      // the floor plan slot alone, not in both places.
      form.append("attach", "false");
      const res = await fetch("/api/upload", { method: "PATCH", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Upload failed.");
      // /api/upload returns the stored URLs; the first is this file.
      const uploaded = data.url || data.urls?.[0];
      if (uploaded) await set(uploaded);
    } catch {
      toast.error("Network error.");
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

/**
 * The building's own photos — the top row, above every unit.
 */
export function PropertyPhotoRow({ listing, isPropertyOwner, onChanged }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <Row
        label="Property photos"
        hint={isPropertyOwner ? "Used on the listing card" : "Managed by the property owner"}
        photos={(listing?.photos ?? []).filter((p) => !p.unitId)}
        canAdd={isPropertyOwner}
        canMoveAll={isPropertyOwner}
        listingId={listing?._id || listing?.id}
        unitId={null}
        onChanged={onChanged}
      />
    </div>
  );
}

/**
 * One unit's photos, with its floor plan pinned to the far left. Rendered
 * inside that unit's panel so a property with four units has four rows, each
 * beside the unit it belongs to.
 */
export function UnitPhotoRow({ listing, unit, isPropertyOwner, onChanged }) {
  const listingId = listing?._id || listing?.id;
  /*
   * The plan is never one of the photos, even for units uploaded before the
   * upload flag existed — those rows still carry the plan in the gallery, and
   * they would otherwise be counted twice and shown twice.
   */
  const plan = unit?.floorPlanImageUrl || null;
  const photos = (listing?.photos ?? []).filter(
    (p) => p.unitId === unit.id && p.url !== plan
  );
  return (
    <Row
      label="Photos"
      photos={photos}
      canAdd
      canMoveAll={isPropertyOwner}
      listingId={listingId}
      unitId={unit.id}
      onChanged={onChanged}
    >
      {/* Editable by anyone who may add photos to this unit — the property
          owner, or a landlord letting it. Gating this on property ownership
          alone left the slot dead on every building a landlord doesn't own,
          which is exactly where they are most likely to hold the plan. */}
      <FloorPlanSlot
        unit={unit}
        canEdit
        listingId={listingId}
        onChanged={onChanged}
      />
    </Row>
  );
}

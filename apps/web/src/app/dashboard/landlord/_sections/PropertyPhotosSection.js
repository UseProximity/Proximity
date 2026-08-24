"use client";

/*
 * Photo management for one property, split by scope.
 *
 * A property's photos and a unit's photos belong to different people, so this
 * renders them as separate groups rather than one pile: the building first,
 * then a group per unit. What a landlord may do in each group depends on which
 * they are — see lib/listings/ownership.js, which the API enforces
 * independently of anything decided here.
 *
 *   Property owner   full control everywhere; the arbiter of a shared unit.
 *   Lease owner      adds to units they let, removes and reorders only their
 *                    own photos. Everyone else's stay visible and pinned, so
 *                    they can see what a renter sees without being able to
 *                    bury a competitor's pictures.
 */

import { useState } from "react";
import { Camera, Lock, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";

function PhotoGroup({ listingId, unitId, label, hint, photos, canAdd, canMoveAll, onChanged }) {
  const [busy, setBusy] = useState(false);

  const movable = canMoveAll ? photos : photos.filter((p) => p.mine);
  const pinned = canMoveAll ? [] : photos.filter((p) => !p.mine);

  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("listingId", listingId);
      if (unitId) form.append("unitId", unitId);
      for (const f of files) form.append("files", f);
      const res = await fetch("/api/upload", { method: "PATCH", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Those photos could not be added.");
        return;
      }
      toast.success(files.length === 1 ? "Photo added." : `${files.length} photos added.`);
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (url) => {
    const photo = photos.find((p) => p.url === url);
    if (!photo) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/landlord/photos/${photo.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "That photo could not be removed.");
        return;
      }
      toast.success("Photo removed.");
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };

  /*
   * The grid hands back only the order of the photos it was given. A lease
   * owner is given just their own, so the list it returns is exactly the set
   * the API expects from them — the pinned ones keep the slots they hold.
   */
  const reorder = async (urls) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, unitId: unitId ?? null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "That order could not be saved.");
        return;
      }
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const inputId = `photo-add-${unitId ?? "property"}`;

  return (
    <div className="border-t border-gray-100 px-5 py-4 first:border-t-0">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{label}</h4>
        <span className="text-xs text-gray-400">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
        </span>
        {hint && <span className="text-xs text-gray-400">· {hint}</span>}
        {canAdd && (
          <>
            <label
              htmlFor={inputId}
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-red-300 hover:text-red-600"
            >
              <Plus className="h-3.5 w-3.5" />
              Add photos
            </label>
            <input
              id={inputId}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                upload([...e.target.files]);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {movable.length > 0 && (
        <DraggableImageGrid
          images={movable.map((p) => p.url)}
          onReorder={reorder}
          onRemove={remove}
          saving={busy}
        />
      )}

      {pinned.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
            <Lock className="h-3 w-3" />
            Added by another landlord at this property — visible to renters, not
            yours to move or remove.
          </p>
          <div className="flex flex-wrap gap-2">
            {pinned.map((p) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={p.id}
                src={p.url}
                alt=""
                className="h-16 w-24 rounded-md object-cover opacity-60 ring-1 ring-gray-200"
              />
            ))}
          </div>
        </div>
      )}

      {photos.length === 0 && (
        <p className="text-xs text-gray-400">
          {canAdd ? "No photos yet." : "No photos yet — the property owner adds these."}
        </p>
      )}
    </div>
  );
}

export default function PropertyPhotosSection({ property, onChanged }) {
  const listingId = property?._id || property?.id;
  const photos = property?.photos ?? [];
  const isPropertyOwner = property?.ownership !== "lease";
  const units = property?.unitTypes ?? [];

  const propertyPhotos = photos.filter((p) => !p.unitId);
  const unitLabel = (u) =>
    u.identityLabel ?? u.title ?? `${u.bedrooms ?? "?"} bed · ${u.bathrooms ?? "?"} bath`;

  // A lease owner only manages the units they actually let.
  const myUnitIds = new Set((property?.myLeases ?? []).map((l) => l.unitId));
  const visibleUnits = isPropertyOwner ? units : units.filter((u) => myUnitIds.has(u.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Photos
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <PhotoGroup
          listingId={listingId}
          unitId={null}
          label="The property"
          hint={
            isPropertyOwner
              ? "Shown on the listing card"
              : "Managed by the property owner"
          }
          photos={propertyPhotos}
          canAdd={isPropertyOwner}
          canMoveAll={isPropertyOwner}
          onChanged={onChanged}
        />

        {visibleUnits.map((u) => (
          <PhotoGroup
            key={u.id}
            listingId={listingId}
            unitId={u.id}
            label={unitLabel(u)}
            photos={photos.filter((p) => p.unitId === u.id)}
            canAdd
            canMoveAll={isPropertyOwner}
            onChanged={onChanged}
          />
        ))}
      </CardContent>
    </Card>
  );
}

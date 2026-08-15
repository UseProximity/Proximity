"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import SendOfferForm from "@/components/chat/SendOfferForm";

/**
 * Any active listing owner (landlord or student) can load saver count and
 * broadcast a discount offer to everyone who saved the listing.
 */
export default function BroadcastListingOfferButton({
  listingId,
  defaultRent = "",
  className = "",
  children,
  label = "Send offer to savers",
}) {
  const [open, setOpen] = useState(false);
  const [saverCount, setSaverCount] = useState(null);

  useEffect(() => {
    if (!open || !listingId) return;
    let cancelled = false;
    setSaverCount(null);
    fetch(`/api/listings/${listingId}/offers`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || `Failed to load savers (${res.status})`);
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) setSaverCount(data?.count ?? 0);
      })
      .catch((err) => {
        if (!cancelled) {
          setSaverCount(0);
          toast.error(err?.message || "Could not load savers.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, listingId]);

  async function handleSubmit({ proposedRent, note }) {
    const res = await fetch(`/api/listings/${listingId}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposedRent, note }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `Failed to send offers (${res.status})`);
    }
    const sent = data?.sent ?? 0;
    const skipped = data?.skipped ?? 0;
    if (sent === 0) {
      toast.error(
        skipped > 0
          ? "Could not send any offers. Try again."
          : "No savers to message."
      );
      return;
    }
    toast.success(
      skipped > 0
        ? `Sent ${sent} offer${sent === 1 ? "" : "s"} (${skipped} skipped).`
        : `Sent ${sent} offer${sent === 1 ? "" : "s"}.`
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          className ||
          "flex items-center gap-1.5 text-xs text-gray-600 hover:text-red-600 font-medium px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors"
        }
      >
        {children ?? label}
      </button>
      <SendOfferForm
        mode="broadcast"
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
        defaultRent={defaultRent}
        saverCount={saverCount}
      />
    </>
  );
}

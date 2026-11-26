"use client";

/*
 * The landlord's contact at this property: one block, every lease they own
 * here.
 *
 * Contact used to be typed into each offering. Three leases from one landlord
 * were three chances for the email to drift, and students saw three identical
 * "Contact" buttons where there was one person to reach. The storage has not
 * moved (each lease still carries the block, which is what keeps imported
 * leases with no account reachable); what changed is that it is set in one
 * place and copied to all of them, and a new lease picks it up on creation.
 */

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import ContactEmailStatus from "@/components/listings/editor/ContactEmailStatus";
import { normalizeApplicationUrl } from "@/lib/listings/applicationLink";
import { revealGap } from "@/components/listings/editor/ImportGaps";

const field =
  "mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-red-400 focus:outline-none";

/*
 * The block as saved. After a save every lease agrees, so any of them will do;
 * before the first save (or on leases that predate the block) the first one
 * with an email is the best guess, and the mismatch note below says so.
 */
function savedContact(listing) {
  const mine = listing?.contactLeases ?? listing?.myLeases ?? [];
  const src = mine.find((l) => l.contactEmail) ?? mine[0];
  // No phone: students write through Proximity, never call (Wyatt, 2026-10-18).
  return {
    contactName: src?.contactName ?? "",
    contactEmail: src?.contactEmail ?? "",
    // Their own application (portal or form). Optional: no link, no Apply button.
    applicationUrl: mine.find((l) => l.applicationUrl)?.applicationUrl ?? "",
  };
}

/*
 * A landlord with no leases of their own at this property (Wyatt, 2026-11-20).
 * The application link is stored on their own leases, so there is nothing to
 * save it on yet. The field still shows, greyed out with the reason, because a
 * chat that refused their application link sends them here to find it.
 */
function ApplicationLinkUnavailable() {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <label className="block" aria-disabled="true">
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
          Application link <span className="normal-case tracking-normal text-gray-400">(optional)</span>
        </span>
        <input type="url" disabled className={`${field} cursor-not-allowed bg-gray-100 text-gray-400`}
          placeholder="https://yourportal.com/apply" data-gap="application-link" />
        <span className="mt-1 block text-[11px] leading-4 text-gray-500">
          Unavailable because you don&apos;t have any leases of your own at this property. Your
          application link is saved on your leases, so add a lease here first. Then you can add
          the link, and students will see an Apply button in the listing&apos;s Contact tab.
        </span>
      </label>
    </div>
  );
}

export default function EditorContact({ listing, onChanged }) {
  const listingId = listing?._id || listing?.id;
  const mine = listing?.contactLeases ?? listing?.myLeases ?? [];
  const [draft, setDraft] = useState(() => savedContact(listing));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // A refetch (after a save, or after a lease is added) replaces `listing`.
  // Take the saved block from it unless the landlord is mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(savedContact(listing));
  }, [listing, dirty]);

  /*
   * Arriving from a chat that refused an application link
   * (?focus=application-link): scroll to the field and highlight it, once.
   * The param is dropped so a reload does not do it again.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") !== "application-link") return;
    const timer = setTimeout(() => {
      revealGap("application-link");
      params.delete("focus");
      window.history.replaceState(null, "", `?${params.toString()}${window.location.hash}`);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  if (!mine.length) return <ApplicationLinkUnavailable />;

  const set = (p) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); };
  const discard = () => { setDraft(savedContact(listing)); setDirty(false); };

  // Leases here that still disagree with each other, which only happens before
  // the first save. Worth saying, because saving is what ends it.
  const emails = new Set(mine.map((l) => (l.contactEmail || "").trim().toLowerCase()));
  const mixed = emails.size > 1;

  const save = async () => {
    if (!draft.contactEmail.trim()) {
      return toast.error("Add a contact email so students can reach you.");
    }
    const link = normalizeApplicationUrl(draft.applicationUrl);
    if (link.error) return toast.error(link.error);
    setSaving(true);
    try {
      const res = await fetch(`/api/landlord/listings/${listingId}/contact`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, applicationUrl: link.url ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't save your contact.");
      toast.success(
        data.updated === 1
          ? "Contact saved on your listing here."
          : `Contact saved on all ${data.updated} of your listings here.`
      );
      setDirty(false);
      await onChanged();
    } catch {
      toast.error("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Your contact at this property</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            Applies to {mine.length === 1 ? "your listing" : `all ${mine.length} of your listings`} here.
            Students see one card for you with every option you offer, and one Contact button.
          </p>
        </div>
        {dirty && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={discard} disabled={saving}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-60">
              Discard changes
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Name</span>
          <input type="text" className={field} value={draft.contactName}
            placeholder="Your name or your company"
            onChange={(e) => set({ contactName: e.target.value })} />
        </label>
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Contact email <span className="text-red-500">*</span>
          </span>
          <input type="email" required className={field} value={draft.contactEmail} data-gap="contact"
            onChange={(e) => set({ contactEmail: e.target.value })} />
          <ContactEmailStatus savedEmail={savedContact(listing).contactEmail} draftEmail={draft.contactEmail} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
            Application link <span className="normal-case tracking-normal text-gray-400">(optional)</span>
          </span>
          <input type="url" inputMode="url" className={field} value={draft.applicationUrl} data-gap="application-link"
            placeholder="https://yourportal.com/apply"
            onChange={(e) => set({ applicationUrl: e.target.value })} />
          <span className="mt-1 block text-[11px] leading-4 text-gray-500">
            Where students apply for your listings here, like your leasing portal or an online form.
            Students see an Apply button that opens it. Leave it blank for no Apply button.
          </span>
        </label>
      </div>

      {mixed && !dirty && (
        <p className="mt-2 text-xs text-amber-700">
          Your listings here currently use different contact emails, so students see them as
          different landlords. Save to set them all to the one above.
        </p>
      )}
    </div>
  );
}

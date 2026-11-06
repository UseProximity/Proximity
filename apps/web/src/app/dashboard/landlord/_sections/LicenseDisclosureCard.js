"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import LicenseDisclosureFields, { DisclosureSummary, MissingHint, useLicenseDisclosure } from "@/components/account/LicenseDisclosureFields";

/*
 * The landlord's real estate license disclosure on their Profile: what they told
 * us before signing the commission agreement, and the place to change it. A
 * licensee's name, company and company phone show on their listings, so a save
 * changes what students see straight away. Every save is kept in the history.
 */
export default function LicenseDisclosureCard() {
  const license = useLicenseDisclosure();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const { saved, ready } = license;

  const save = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/landlord/license-disclosure", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(license.payload()),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save. Please try again.");
      license.reset(data.disclosure);
      setEditing(false);
      toast.success("License details saved");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-8 rounded-lg bg-white p-5 shadow-lg sm:p-8">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900">Real estate license</h2>
          <p className="mt-1 text-sm text-gray-500">
            Missouri requires a licensed agent&apos;s name, company and company phone on every listing they market. If you are a
            licensee, we show these three on your listings. Your license number stays private.
          </p>
        </div>
        {!editing && !license.loading && (
          <button
            type="button"
            onClick={() => {
              license.reset(saved);
              setEditing(true);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {saved ? "Edit" : "Add"}
          </button>
        )}
      </div>

      <div className="mt-4">
        {license.loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : editing ? (
          <form onSubmit={save} className="max-w-2xl space-y-3">
            <LicenseDisclosureFields state={license} allowSummary={false} idPrefix="profile-license" />
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <MissingHint state={license} />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!ready || saving}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : saved ? (
          <>
            <DisclosureSummary disclosure={saved} />
            {saved.isLicensee && (
              <p className="mt-2 text-xs text-gray-500">
                Shown on your listings as: Listed by {saved.agentName}, {saved.companyName}, {saved.companyPhone}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600">
            Not answered yet. You will be asked before you sign the commission agreement, or you can add it now.
          </p>
        )}
      </div>
    </section>
  );
}

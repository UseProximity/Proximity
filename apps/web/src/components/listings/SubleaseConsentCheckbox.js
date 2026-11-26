"use client";

/*
 * The affirmative gate in front of posting a sublease.
 *
 * Terms Section 5 makes a subletter represent that their own lease lets them
 * sublet. A notice alone is browsewrap; an unticked box they have to tick,
 * beside a link to the Terms, is the clickwrap courts actually hold people to.
 * The server re-checks the same flag (`subleaseRightsConfirmed`) so the box
 * cannot be skipped by calling the API directly.
 */

import Link from "next/link";

export default function SubleaseConsentCheckbox({ checked, onChange, invalid = false }) {
  return (
    <label
      data-invalid={invalid}
      className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm text-gray-700 cursor-pointer ${
        invalid ? "border-red-400 bg-red-50" : "border-gray-200 bg-gray-50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-red-600"
      />
      <span className="leading-snug">
        I confirm I have the right to sublet this place under my lease, including any
        consent my landlord or property owner requires, and I agree to the{" "}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-red-600 underline underline-offset-2"
        >
          Terms of Service
        </Link>
        .
      </span>
    </label>
  );
}

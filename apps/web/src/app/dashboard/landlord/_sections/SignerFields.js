"use client";

import { useEffect, useState } from "react";
import AddressSearchInput from "@/components/listings/AddressSearchInput";

const FIELD = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

/*
 * The signer's details on the signing forms (Payments tab and the publish
 * dialog), which fill the agreement's boxes: full name, company, title, email and
 * the address as two lines. They start with what we already know (account name,
 * company and email, the Stripe billing address, /api/billing/agreement/signer)
 * and stay editable. A field the landlord already typed in is never overwritten.
 */
export function useSignerDetails() {
  // address1 is the street (picked from the address search), address2 the suite or
  // unit, city the "St. Louis, MO 63117" line that came with the street.
  const [values, setValues] = useState({ name: "", company: "", title: "", email: "", address1: "", address2: "", city: "" });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    fetch("/api/billing/agreement/signer")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((d) => {
        if (!live) return;
        setValues((v) => ({
          ...v,
          name: v.name || d.name || "",
          company: v.company || d.company || "",
          email: v.email || d.email || "",
          ...(!v.address1 && { address1: d.address1 || "", city: d.city || "" }),
          address2: v.address2 || d.address2 || "",
        }));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const set = (patch) => setValues((v) => ({ ...v, ...patch }));
  const fullName = values.name.trim().split(/\s+/).filter(Boolean).length >= 2;
  // A street typed but not picked from the list has no city line yet.
  const addressPicked = !values.address1.trim() || !!values.city.trim();
  return {
    values,
    set,
    loading,
    ready: fullName && !!values.title.trim() && addressPicked,
    addressPicked,
    // What the sign route takes.
    body: () => ({
      signerName: values.name,
      signerCompany: values.company,
      signerTitle: values.title,
      signerEmail: values.email,
      signerAddress1: values.address1,
      signerAddress2: values.address2,
      signerCity: values.city,
    }),
  };
}

// A Mapbox address suggestion as the form's parts: the street, and the city line
// ("St. Louis, MO 63117") from its city, state and ZIP.
export function fromMapbox(f) {
  const ctx = (id) => (f.context ?? []).find((c) => String(c.id ?? "").startsWith(`${id}.`));
  const street = [f.address, f.text].filter(Boolean).join(" ") || String(f.place_name ?? "").split(",")[0];
  const state = String(ctx("region")?.short_code ?? "").replace(/^US-/i, "") || ctx("region")?.text || "";
  const city = [ctx("place")?.text, [state, ctx("postcode")?.text].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { address1: street, city };
}

function Field({ label, optional = false, hint = null, className = "", ...input }) {
  return (
    <label className={`block text-sm font-medium text-gray-700 ${className}`}>
      {label}
      {optional && <span className="font-normal text-gray-500"> (optional)</span>}
      <input className={`${FIELD} mt-1`} {...input} />
      {hint && <span className="mt-1 block text-xs font-normal text-gray-500">{hint}</span>}
    </label>
  );
}

export default function SignerFields({ state }) {
  const { values: v, set } = state;
  return (
    <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <Field
        label="Your full name"
        value={v.name}
        maxLength={100}
        autoComplete="name"
        placeholder="First and last name"
        hint="First and last, as it should appear on the agreement."
        onChange={(e) => set({ name: e.target.value })}
        required
      />
      <Field label="Your title" value={v.title} maxLength={100} placeholder="Owner, Property Manager, ..." onChange={(e) => set({ title: e.target.value })} required />
      <Field
        label="Company"
        optional
        value={v.company}
        maxLength={150}
        autoComplete="organization"
        placeholder="Company or LLC name"
        hint="Leave blank if you own the properties yourself."
        onChange={(e) => set({ company: e.target.value })}
      />
      <Field label="Email" type="email" value={v.email} maxLength={254} autoComplete="email" onChange={(e) => set({ email: e.target.value })} />
      <label className="block text-sm font-medium text-gray-700">
        Address line 1
        <div className="mt-1">
          <AddressSearchInput
            value={v.address1}
            // Typing changes the street; the city line returns when a suggestion is picked.
            onChange={(e) => set({ address1: e.target.value, city: "" })}
            onSelectSuggestion={(f) => {
              const parts = fromMapbox(f);
              set(parts);
              return parts.address1;
            }}
            placeholder="Start typing your street address"
            className={FIELD}
          />
        </div>
        {v.address1.trim() && !v.city ? (
          <span className="mt-1 block text-xs font-normal text-red-700">Choose your address from the list.</span>
        ) : v.city ? (
          <span className="mt-1 block text-xs font-normal text-gray-500">{v.city}</span>
        ) : null}
      </label>
      <Field
        label="Address line 2"
        optional
        value={v.address2}
        maxLength={60}
        autoComplete="address-line2"
        placeholder="Suite or unit, e.g. Suite 301"
        onChange={(e) => set({ address2: e.target.value })}
      />
    </div>
  );
}

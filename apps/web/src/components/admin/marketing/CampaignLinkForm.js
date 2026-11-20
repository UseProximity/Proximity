"use client";

/*
 * Create or edit a campaign link. The form enforces the naming convention
 * (PRD 7.8): source and medium from fixed lists, campaign as
 * <yyyy-mm>-<short-name> with earlier campaigns suggested, every value run
 * through the shared tag cleaner as it is typed. The slug is suggested from
 * the name and locked once saved.
 */
import { useState } from "react";
import { DESTINATION_PRESETS, LINK_MEDIUMS, LINK_SOURCES, campaignPrefix, suggestSlug } from "@/lib/marketing/links";
import { normalizeTag } from "@/lib/marketing/tags";

const OTHER = "__other";
const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-500";

function Field({ label, hint, error, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {children}
      {error ? <span className="block text-xs text-red-600">{error}</span> : hint ? <span className="block text-xs text-gray-400">{hint}</span> : null}
    </label>
  );
}

export default function CampaignLinkForm({ link = null, initialSlug = "", campaigns = [], onSaved, onCancel }) {
  const editing = Boolean(link);
  const presetFor = (p) => (DESTINATION_PRESETS.some((d) => d.path === p) ? p : OTHER);
  const [form, setForm] = useState(() => ({
    name: link?.name ?? "",
    slug: link?.slug ?? initialSlug,
    source: link ? (LINK_SOURCES.includes(link.source) ? link.source : OTHER) : "",
    otherSource: link && !LINK_SOURCES.includes(link.source) ? link.source : "",
    medium: link?.medium ?? "",
    campaign: link?.campaign ?? campaignPrefix(),
    content: link?.content ?? "",
    preset: link ? presetFor(link.destination_path) : "/",
    customDestination: link && presetFor(link.destination_path) === OTHER ? link.destination_path : "",
  }));
  const [slugTouched, setSlugTouched] = useState(editing || Boolean(initialSlug));
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onName = (v) => {
    set("name", v);
    if (!slugTouched) set("slug", suggestSlug(v));
  };

  const labelsChanged =
    editing &&
    ((form.source === OTHER ? normalizeTag(form.otherSource) : form.source) !== link.source ||
      form.medium !== link.medium ||
      normalizeTag(form.campaign) !== link.campaign ||
      (normalizeTag(form.content) || null) !== (link.content ?? null));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setErrors({});
    const payload = {
      name: form.name,
      source: form.source === OTHER ? form.otherSource : form.source,
      medium: form.medium,
      campaign: form.campaign,
      content: form.content,
      destination_path: form.preset === OTHER ? form.customDestination : form.preset,
    };
    if (!editing) payload.slug = form.slug;
    try {
      const res = await fetch(editing ? `/api/admin/marketing/links/${link.id}` : "/api/admin/marketing/links", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrors(data.fields || {});
        setMessage(data.error || "Could not save the link.");
        if (data.suggestion) set("slug", data.suggestion);
        return;
      }
      onSaved?.(data.link);
    } catch {
      setMessage("Could not save the link.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="For people only. Never appears in a URL." error={errors.name}>
          <input className={INPUT} value={form.name} onChange={(e) => onName(e.target.value)} placeholder="Mudd review flyer, fall" maxLength={120} />
        </Field>
        <Field label="Slug" hint={editing ? "Locked: it is printed on paper and in QR codes." : "Suggested from the name. Locked once saved."} error={errors.slug}>
          <input
            className={INPUT}
            value={form.slug}
            disabled={editing}
            onChange={(e) => { setSlugTouched(true); set("slug", e.target.value); }}
            onBlur={() => set("slug", normalizeTag(form.slug) || "")}
            placeholder="review-mudd"
            maxLength={60}
          />
        </Field>
        <Field label="Source" error={errors.source}>
          <div className="flex gap-2">
            <select className={INPUT} value={form.source} onChange={(e) => set("source", e.target.value)}>
              <option value="">Choose...</option>
              {LINK_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value={OTHER}>Other</option>
            </select>
            {form.source === OTHER && (
              <input className={INPUT} value={form.otherSource} onChange={(e) => set("otherSource", e.target.value)} onBlur={() => set("otherSource", normalizeTag(form.otherSource) || "")} placeholder="tiktok" />
            )}
          </div>
        </Field>
        <Field label="Medium" error={errors.medium}>
          <select className={INPUT} value={form.medium} onChange={(e) => set("medium", e.target.value)}>
            <option value="">Choose...</option>
            {LINK_MEDIUMS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Campaign" hint="<yyyy-mm>-<short-name>. Earlier campaigns are suggested." error={errors.campaign}>
          <input className={INPUT} list="campaign-suggestions" value={form.campaign} onChange={(e) => set("campaign", e.target.value)} onBlur={() => set("campaign", normalizeTag(form.campaign) || "")} />
          <datalist id="campaign-suggestions">{campaigns.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Content (optional)" hint="The creative or placement variant, e.g. story-a." error={errors.content}>
          <input className={INPUT} value={form.content} onChange={(e) => set("content", e.target.value)} onBlur={() => set("content", normalizeTag(form.content) || "")} placeholder="flyer-mudd" />
        </Field>
      </div>

      <Field label="Destination" hint="A page on useproximity.org. Can be changed later; the short link follows it." error={errors.destination_path}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select className={`${INPUT} sm:w-56`} value={form.preset} onChange={(e) => set("preset", e.target.value)}>
            {DESTINATION_PRESETS.map((d) => <option key={d.path} value={d.path}>{d.label} ({d.path})</option>)}
            <option value={OTHER}>Another page (paste a path or URL)</option>
          </select>
          {form.preset === OTHER && (
            <input className={INPUT} value={form.customDestination} onChange={(e) => set("customDestination", e.target.value)} placeholder="/listings/<id> or https://useproximity.org/guides/..." />
          )}
        </div>
      </Field>

      {labelsChanged && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Past sessions keep the labels they were recorded with. Only new visits get the new labels; reporting still groups the link&apos;s whole history together.
        </p>
      )}
      {message && <p className="text-sm text-red-600">{message}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
          {saving ? "Saving..." : editing ? "Save changes" : "Create link"}
        </button>
      </div>
    </form>
  );
}

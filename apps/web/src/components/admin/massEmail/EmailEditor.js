"use client";

/*
 * Writing a mass email (Wyatt, 2026-11-07). The form opens on the newest saved
 * version (or an older one picked from the list), and saving always makes a new
 * version: what went out before is never changed. The preview beside it is the
 * exact HTML a person receives, filled in for a sample person.
 */

import { useMemo, useRef, useState } from "react";
import { BUTTON_TARGETS, MERGE_FIELDS, renderMassEmail } from "@/lib/massEmail/render";
import { emailFooter } from "@/lib/emailFooter";
import { escapeHtml } from "@/lib/escapeHtml";
import { DEFAULT_FOOTER_REASON } from "@/lib/massEmail/templates";
import { api, FIELD, fmtWhen, Notice, PRIMARY, SECONDARY, uploadPdf } from "./shared";

const SAMPLE = { name: "Jordan Lee", email: "jordan@example.com", company: "Lee Properties" };
const BASE_URL = typeof window === "undefined" ? "https://useproximity.org" : window.location.origin;

const fromVersion = (v) => ({
  subject: v?.subject ?? "",
  body: v?.body ?? "",
  buttonTarget: v?.button_target ?? "none",
  buttonLabel: v?.button_label ?? "",
  buttonUrl: v?.button_url ?? "",
  attachments: v?.attachments ?? [],
  footerReason: v?.footer_reason ?? DEFAULT_FOOTER_REASON,
  commercial: v?.commercial === true,
});

const BODY_HELP = "Blank line = new paragraph. \"- \" starts a bullet, \"## \" a heading. **bold**, [link text](https://... or /dashboard/landlord).";

export default function EmailEditor({ template, dbTarget, writable, mrecUploaded, onSaved }) {
  const versions = template.versions;
  const [baseId, setBaseId] = useState(versions[0]?.id ?? null);
  const base = versions.find((v) => v.id === baseId) ?? null;
  const [form, setForm] = useState(() => fromVersion(versions[0]));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sampleSetup, setSampleSetup] = useState(false);
  const bodyRef = useRef(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(fromVersion(base));
  const hasMrec = form.attachments.some((a) => a.kind === "mrec");

  const pick = (id) => {
    if (dirty && !window.confirm("Discard the changes you have not saved?")) return;
    setBaseId(id);
    setForm(fromVersion(versions.find((v) => v.id === id)));
    setNotice(null);
    setError(null);
  };

  const insertField = (key) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return set({ body: `${form.body}${token}` });
    const start = el.selectionStart ?? form.body.length;
    const end = el.selectionEnd ?? start;
    set({ body: form.body.slice(0, start) + token + form.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const toggleMrec = (on) =>
    set({ attachments: on ? [{ kind: "mrec" }, ...form.attachments.filter((a) => a.kind !== "mrec")] : form.attachments.filter((a) => a.kind !== "mrec") });

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const attachment = await uploadPdf(file, dbTarget);
      set({ attachments: [...form.attachments, attachment] });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { version } = await api(`/api/admin/mass-email/${template.id}/versions`, dbTarget, "POST", form);
      setBaseId(version.id);
      setNotice(`Saved as version ${version.version}.`);
      await onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = useMemo(() => {
    const version = {
      subject: form.subject || "(no subject)",
      body: form.body || "(nothing written yet)",
      button_target: form.buttonTarget,
      button_label: form.buttonLabel,
      button_url: form.buttonUrl,
    };
    const footerHtml = emailFooter({ reason: escapeHtml(form.footerReason || DEFAULT_FOOTER_REASON), commercial: form.commercial });
    return renderMassEmail(version, SAMPLE, { baseUrl: BASE_URL, setupUrl: sampleSetup ? `${BASE_URL}/reset-password` : null, footerHtml });
  }, [form, sampleSetup]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {versions.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500">Start from</span>
            <select value={baseId ?? ""} onChange={(e) => pick(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-sm">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version} · {fmtWhen(v.created_at)}
                  {v.createdByName ? ` · ${v.createdByName}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-medium text-gray-700">Subject</span>
          <input value={form.subject} onChange={(e) => set({ subject: e.target.value })} className={FIELD} maxLength={200} disabled={!writable} />
        </label>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <div className="flex flex-wrap gap-1">
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  disabled={!writable}
                  onClick={() => insertField(f.key)}
                  title={`Inserts {{${f.key}}}. Shows "${f.fallback}" when unknown.`}
                  className="rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  + {f.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={bodyRef}
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
            rows={16}
            className={`${FIELD} font-mono text-[13px]`}
            disabled={!writable}
          />
          <p className="text-xs text-gray-500">{BODY_HELP}</p>
        </div>

        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <span className="text-sm font-medium text-gray-700">Main button</span>
          <select value={form.buttonTarget} onChange={(e) => set({ buttonTarget: e.target.value })} className={FIELD} disabled={!writable}>
            {BUTTON_TARGETS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          {form.buttonTarget !== "none" && (
            <input value={form.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} placeholder="Button text, e.g. Open Billing" className={FIELD} maxLength={60} disabled={!writable} />
          )}
          {form.buttonTarget === "custom" && (
            <input value={form.buttonUrl} onChange={(e) => set({ buttonUrl: e.target.value })} placeholder="https://... or /dashboard/landlord" className={FIELD} disabled={!writable} />
          )}
          {form.buttonTarget !== "none" && (
            <p className="text-xs text-gray-500">People with no password yet get a &quot;Set your password&quot; button instead, valid for 14 days.</p>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <span className="text-sm font-medium text-gray-700">Attachments</span>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={hasMrec} onChange={(e) => toggleMrec(e.target.checked)} disabled={!writable} />
            Missouri Broker Disclosure Form (MREC)
          </label>
          {hasMrec && !mrecUploaded && (
            <Notice kind="warn">No MREC form is uploaded on this site yet (Billing &gt; Landlords and agreements). Sending will be refused until it is.</Notice>
          )}
          {form.attachments
            .filter((a) => a.kind === "file")
            .map((a) => (
              <div key={a.key} className="flex items-center justify-between text-sm">
                <span className="truncate text-gray-700">{a.fileName}</span>
                {writable && (
                  <button type="button" onClick={() => set({ attachments: form.attachments.filter((x) => x !== a) })} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                )}
              </div>
            ))}
          {writable && (
            <label className="inline-block cursor-pointer text-sm text-gray-700 underline">
              Attach a PDF (4 MB at most)
              <input type="file" accept="application/pdf" onChange={upload} className="hidden" disabled={busy} />
            </label>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-gray-700">Why they are getting it (footer)</span>
            <input value={form.footerReason} onChange={(e) => set({ footerReason: e.target.value })} className={FIELD} maxLength={300} disabled={!writable} />
          </label>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={form.commercial} onChange={(e) => set({ commercial: e.target.checked })} disabled={!writable} />
            <span>
              Marketing email: adds &quot;reply unsubscribe&quot; to the footer. Tick it for promotions; leave it off for account and billing notices.
            </span>
          </label>
        </div>

        {error && <Notice kind="error">{error}</Notice>}
        {notice && <Notice kind="ok">{notice}</Notice>}
        {writable && (
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy || !dirty} className={PRIMARY}>
              {versions.length ? `Save as version ${versions[0].version + 1}` : "Save version 1"}
            </button>
            {dirty && base && (
              <button type="button" onClick={() => setForm(fromVersion(base))} className={SECONDARY}>
                Undo changes
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Preview</span>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={sampleSetup} onChange={(e) => setSampleSetup(e.target.checked)} />
            As someone with no password
          </label>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500">
            <div>From: Proximity &lt;info@useproximity.org&gt;</div>
            <div>To: {SAMPLE.name} &lt;{SAMPLE.email}&gt;</div>
            <div className="font-medium text-gray-800">{preview.subject}</div>
            {form.attachments.length > 0 && <div>Attached: {form.attachments.map((a) => (a.kind === "mrec" ? "Missouri-Broker-Disclosure-Form.pdf" : a.fileName)).join(", ")}</div>}
          </div>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[640px] w-full" />
        </div>
        <p className="text-xs text-gray-400">Filled in for a sample person, {SAMPLE.name} of {SAMPLE.company}.</p>
      </div>
    </div>
  );
}

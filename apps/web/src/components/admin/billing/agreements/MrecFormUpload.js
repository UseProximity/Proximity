"use client";

import { useEffect, useState } from "react";
import { fmtDate } from "@/components/admin/adminShared";
import { BUTTON, PRIMARY, call, openFile } from "./shared";

const ENDPOINT = "/api/admin/billing/mrec-form";

/*
 * The MREC Broker Disclosure Form every new landlord is emailed once, for their
 * records. Uploading a new PDF replaces it from the next email on.
 */
export default function MrecFormUpload({ busy, run }) {
  const [form, setForm] = useState(undefined);
  const [file, setFile] = useState(null);

  useEffect(() => {
    call(ENDPOINT)
      .then((data) => setForm(data.form))
      .catch(() => setForm(null));
  }, []);

  const upload = (e) => {
    e.preventDefault();
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    return run(async () => {
      const data = await call(ENDPOINT, { method: "POST", body });
      setForm(data.form);
      setFile(null);
      e.target.reset();
    }, "Broker Disclosure Form uploaded.");
  };

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-gray-900">MREC Broker Disclosure Form</p>
        <p className="text-xs text-gray-500">
          Emailed once to every new landlord, for their records, with the subject &quot;Missouri Broker Disclosure Form (for
          your records, no reply needed)&quot;. Nothing is sent until a form is uploaded.
        </p>
      </div>
      {form === undefined ? (
        <p className="text-sm text-gray-400">Loading...</p>
      ) : form ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <span>
            {form.fileName}, uploaded {fmtDate(form.uploadedAt)}
          </span>
          <button type="button" className={BUTTON} onClick={() => run(() => openFile(`${ENDPOINT}?download=1`))}>
            Open
          </button>
        </div>
      ) : (
        <p className="text-sm text-amber-700">No form uploaded yet, so new landlords are not being sent one.</p>
      )}
      <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-gray-700"
        />
        <button type="submit" disabled={busy || !file} className={PRIMARY}>
          {form ? "Replace" : "Upload"}
        </button>
      </form>
    </div>
  );
}

/*
 * Staging-only test-email recipient picker. Lets a developer choose which admin/super inbox
 * receives all test emails on staging (stored in the `staging_email_to` cookie, read server-
 * side by sendMailSafe). Auto-opens when no recipient is set; reopenable from the pill.
 * Renders nothing unless NEXT_PUBLIC_APP_ENV=staging.
 */
"use client";
import { useEffect, useState } from "react";

const COOKIE = "staging_email_to";
const ENABLED = process.env.NEXT_PUBLIC_APP_ENV === "staging";

function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}
function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export default function StagingEmailPicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [selected, setSelected] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ENABLED) return;
    const c = readCookie(COOKIE);
    setCurrent(c);
    setSelected(c);
    if (!c) setOpen(true); // prompt on first visit
  }, []);

  useEffect(() => {
    if (!open || recipients.length) return;
    setLoading(true);
    fetch("/api/staging/email-recipients")
      .then((r) => r.json())
      .then((d) => setRecipients(d.recipients || []))
      .catch(() => setRecipients([]))
      .finally(() => setLoading(false));
  }, [open, recipients.length]);

  if (!ENABLED) return null;

  function save() {
    writeCookie(COOKIE, selected);
    setCurrent(selected);
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 left-3 z-[60] rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium text-amber-950 shadow-md hover:bg-amber-400"
      >
        📧 Test emails → {current || "not set"}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">Staging test emails</h2>
            <p className="mt-1 text-sm text-gray-600">
              Choose which inbox receives all test emails on staging. They’re redirected here
              instead of reaching real users. Until you pick one, emails are suppressed.
            </p>

            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">{loading ? "Loading…" : "— Suppress all emails —"}</option>
              {recipients.map((r) => (
                <option key={r.email} value={r.email}>
                  {r.name ? `${r.name} (${r.email})` : r.email} · {r.role}
                </option>
              ))}
            </select>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-400"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

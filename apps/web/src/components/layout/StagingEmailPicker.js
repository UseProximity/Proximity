/*
 * Test-email destination picker for non-production environments (staging AND local). Lets
 * anyone choose which inbox receives every outbound email here — they're redirected there by
 * sendMailSafe (via the `staging_email_to` cookie) instead of reaching real users. Pick from
 * the admin/super list (when signed in) or just type any address. Auto-opens when unset;
 * reopenable from the pill. `env` is resolved server-side in the layout, so it renders only
 * off production (never leaks onto the real site).
 */
"use client";
import { useEffect, useState } from "react";

const COOKIE = "staging_email_to";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}
function writeCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 30}`;
}

export default function StagingEmailPicker({ env }) {
  const enabled = !!env && env !== "production";
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [selected, setSelected] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const c = readCookie(COOKIE);
    setCurrent(c);
    setSelected(c);
    if (!c) setOpen(true); // prompt on first visit
  }, [enabled]);

  useEffect(() => {
    if (!open || loaded) return;
    setLoading(true);
    fetch("/api/staging/email-recipients")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((d) => setRecipients(d.recipients || []))
      .catch(() => setRecipients([]))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
  }, [open, loaded]);

  if (!enabled) return null;

  const valid = selected === "" || EMAIL_RE.test(selected.trim());
  function save() {
    if (!valid) return;
    const value = selected.trim();
    writeCookie(COOKIE, value);
    setCurrent(value);
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
            <h2 className="text-base font-semibold text-gray-900">Test email destination</h2>
            <p className="mt-1 text-sm text-gray-600">
              Choose which inbox receives <strong>every</strong> email sent here (owner inquiries,
              etc.). They’re redirected here instead of reaching real people. Until you pick one,
              emails are suppressed.
            </p>

            {recipients.length > 0 && (
              <select
                value={recipients.some((r) => r.email === selected) ? selected : ""}
                onChange={(e) => setSelected(e.target.value)}
                className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">{loading ? "Loading…" : "— Pick an admin inbox —"}</option>
                {recipients.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.name ? `${r.name} (${r.email})` : r.email} · {r.role}
                  </option>
                ))}
              </select>
            )}

            <input
              type="email"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              placeholder="or type any email…"
              className={`mt-2 w-full rounded-lg border px-3 py-2 text-sm ${
                valid ? "border-gray-300" : "border-red-400"
              }`}
            />
            {!valid && <p className="mt-1 text-xs text-red-500">Enter a valid email (or leave blank to suppress).</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!valid}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-400 disabled:opacity-40"
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

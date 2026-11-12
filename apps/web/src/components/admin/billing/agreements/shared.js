// Small helpers shared by the admin agreement panels.
import { billingFetch } from "@/components/admin/billing/billingFetch";

export async function call(url, options) {
  const res = await billingFetch(url, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const postJson = (url, body) =>
  call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-500";
export const BUTTON =
  "px-3 py-1.5 rounded-md border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60";
export const PRIMARY =
  "px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 disabled:opacity-60";

// Open a file route in a new tab. A route answers either the PDF itself (signed
// documents, joined into one) or JSON with a short-lived link. The tab opens
// straight away so the browser does not block it as a popup.
export async function openFile(url) {
  const tab = window.open("", "_blank");
  try {
    const res = await billingFetch(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    if ((res.headers.get("content-type") ?? "").includes("application/pdf")) {
      const link = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = link;
      else window.open(link, "_blank");
      return;
    }
    const { url: link } = await res.json();
    if (tab) tab.location.href = link;
    else window.open(link, "_blank", "noopener,noreferrer");
  } catch (err) {
    tab?.close();
    throw err;
  }
}

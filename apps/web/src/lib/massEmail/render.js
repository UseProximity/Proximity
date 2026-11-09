/*
 * Turning a mass email version into the HTML a person receives (Wyatt,
 * 2026-11-07). Pure, with relative imports only, so the admin page renders the
 * same preview the recipient gets and the node test runner can load it.
 *
 * The body is plain text with a little formatting, so an admin never writes HTML:
 *   a blank line           starts a new paragraph
 *   "- " at a line start   a bullet (consecutive bullets form one list)
 *   "## " at a line start  a small heading
 *   **words**              bold
 *   [words](link)          a link: https://..., mailto:..., or a site path like
 *                          /dashboard/landlord?tab=billing
 *   {{first_name}}, {{name}}, {{email}}, {{company}}
 *                          filled in for each person (MERGE_FIELDS)
 *
 * Everything the admin or a person's account supplies is escaped before any of
 * this formatting is applied, so nothing in the body can inject markup.
 */

import { escapeHtml } from "../escapeHtml.js";

export const MERGE_FIELDS = [
  { key: "first_name", label: "First name", fallback: "there" },
  { key: "name", label: "Full name", fallback: "there" },
  { key: "email", label: "Email address", fallback: "" },
  { key: "company", label: "Company", fallback: "your company" },
];

export const BUTTON_TARGETS = [
  { key: "billing", label: "Billing tab", path: "/dashboard/landlord?tab=billing" },
  { key: "dashboard", label: "Landlord dashboard", path: "/dashboard/landlord" },
  { key: "custom", label: "A link I choose", path: null },
  { key: "none", label: "No button", path: null },
];

const WRAP = "font-family:sans-serif;max-width:560px;margin:0 auto;color:#111827;line-height:1.5";
const BUTTON =
  "display:inline-block;margin:16px 0;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600";
const LINK = "color:#dc2626";

export function firstName(name) {
  const first = typeof name === "string" ? name.trim().split(/\s+/)[0] : "";
  return first || null;
}

// The values for one person. Missing ones fall back to a neutral word.
export function mergeValues(person = {}) {
  const raw = {
    first_name: firstName(person.name),
    name: typeof person.name === "string" ? person.name.trim() : null,
    email: person.email ?? null,
    company: person.company ?? null,
  };
  const out = {};
  for (const f of MERGE_FIELDS) out[f.key] = raw[f.key] || f.fallback;
  return out;
}

// Merge fields the text uses that this renderer does not know (a typo like {{frist_name}}).
export function unknownMergeFields(text) {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const found = new Set();
  for (const m of String(text ?? "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    if (!known.has(m[1].toLowerCase())) found.add(m[1]);
  }
  return [...found];
}

function fillPlain(text, values) {
  return String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key) => {
    const v = values[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/*
 * A link target the email may carry: an absolute http(s) or mailto link as is, a
 * site path joined to baseUrl. Anything else (javascript:, data:, a bare word) is
 * refused, so the text shows without a link.
 */
export function safeHref(href, baseUrl) {
  const h = String(href ?? "").trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(h)) return h;
  if (/^mailto:[^\s"'<>]+$/i.test(h)) return h;
  if (/^\/[^\s"'<>]*$/.test(h) && !h.startsWith("//")) return `${String(baseUrl ?? "").replace(/\/$/, "")}${h}`;
  return null;
}

// Inline formatting on text that is already escaped.
function inline(escaped, baseUrl) {
  return escaped
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      // href was escaped with the rest: undo the &amp; so query strings survive, then re-escape.
      const target = safeHref(href.replace(/&amp;/g, "&"), baseUrl);
      return target ? `<a href="${escapeHtml(target)}" style="${LINK}">${label}</a>` : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

// The body as HTML blocks: paragraphs, headings and bullet lists.
export function bodyToHtml(body, values, baseUrl) {
  const filled = escapeHtml(fillPlain(body, values));
  const blocks = filled.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    let para = [];
    let list = [];
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map((l) => inline(l, baseUrl)).join("<br>")}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list.length) out.push(`<ul style="padding-left:20px">${list.map((l) => `<li>${inline(l, baseUrl)}</li>`).join("")}</ul>`);
      list = [];
    };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const heading = line.match(/^\s*##\s+(.*)$/);
      if (bullet) {
        flushPara();
        list.push(bullet[1]);
      } else if (heading) {
        flushPara();
        flushList();
        out.push(`<p style="font-weight:600;font-size:16px;margin:20px 0 4px">${inline(heading[1], baseUrl)}</p>`);
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara();
    flushList();
  }
  return out.join("\n");
}

/*
 * The body as plain text, for the text/plain part every email carries next to the
 * HTML (spam filters count an HTML-only email against the sender). Links become
 * "words (https://...)", and the bold and heading markers are dropped.
 */
export function bodyToText(body, values, baseUrl) {
  return fillPlain(body, values)
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
      const target = safeHref(href, baseUrl);
      return target && target !== label ? `${label} (${target.replace(/^mailto:/i, "")})` : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/^\s*##\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * Whether this person gets a set-password link: only when they cannot sign in AND
 * the email has a button to carry it. A new link cancels the earlier one, so an
 * email without a button must not mint one (review of 2026-11-07).
 */
export function wantsSetupLink(person, version, { baseUrl }) {
  const canLogin = !!(person?.password_hash || person?.google_account || person?.apple_account);
  return !canLogin && !!buttonFor(version, { baseUrl });
}

/*
 * Where the main button goes, or null for no button. `setupUrl`, when given,
 * replaces it: the person has no way to sign in yet, so the button sets a
 * password first.
 */
export function buttonFor(version, { baseUrl, setupUrl = null } = {}) {
  const target = BUTTON_TARGETS.find((t) => t.key === version?.button_target);
  if (!target || target.key === "none") return null;
  const href = target.key === "custom" ? safeHref(version.button_url, baseUrl) : safeHref(target.path, baseUrl);
  if (!href) return null;
  const label = (version.button_label || "").trim() || "Open Proximity";
  return setupUrl ? { href: setupUrl, label: "Set your password", setup: true } : { href, label, setup: false };
}

/*
 * The finished email for one person: { subject, html, text }. `footerHtml` and
 * `footerText` are the shared footer (lib/emailFooter.js), passed in so this file
 * stays free of server imports.
 */
export function renderMassEmail(version, person, { baseUrl, setupUrl = null, footerHtml = "", footerText = "" } = {}) {
  const values = mergeValues(person);
  const button = buttonFor(version, { baseUrl, setupUrl });
  const setupNote = button?.setup
    ? `<p style="color:#6b7280;font-size:14px">Your Proximity account does not have a password yet. This button sets one, then sign in with this email address.</p>`
    : "";
  const html = `<div style="${WRAP}">
${bodyToHtml(version.body, values, baseUrl)}
${button ? `<a href="${escapeHtml(button.href)}" style="${BUTTON}">${escapeHtml(button.label)}</a>` : ""}
${setupNote}
${footerHtml}
</div>`;
  const text = [
    bodyToText(version.body, values, baseUrl),
    button ? `${button.label}: ${button.href}` : "",
    button?.setup ? "Your Proximity account does not have a password yet. This link sets one, then sign in with this email address." : "",
    footerText,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject: fillPlain(version.subject, values).replace(/[\r\n]+/g, " ").trim(), html, text };
}

/*
 * Campaign link rules (PRD 7.8 and 7.9), shared by the admin form and the API.
 *
 * A campaign link is a registered slug that carries a source, medium and
 * campaign. It works as ?src=<slug> on any page and as /go/<slug>, whose
 * destination can be changed after a QR code is printed. The form enforces
 * the naming convention so nobody has to remember it.
 *
 * Pure; no "@/" imports, so the Node test runner and the browser both load it.
 */
import { MAX_TAG_LENGTH, normalizeTag } from "./tags.js";

export const SITE_ORIGIN = "https://useproximity.org";
export const LINK_SOURCES = ["instagram", "sidechat", "google", "qr", "proximity-email"];
export const LINK_MEDIUMS = ["paid-social", "organic-social", "cpc", "offline", "email"];

export const DESTINATION_PRESETS = [
  { label: "Home", path: "/" },
  { label: "Browse listings", path: "/browse" },
  { label: "Campus Hub", path: "/CampusHub" },
  { label: "Guides", path: "/guides" },
  { label: "Lease Checker", path: "/lease-check" },
  { label: "Review flow", path: "/review" },
];

const OWN_HOSTS = ["useproximity.org", "www.useproximity.org"];
const CAMPAIGN_RE = /^\d{4}-(0[1-9]|1[0-2])-[a-z0-9]/;

/** "<yyyy-mm>-" for the given date (the campaign field's starting value). */
export function campaignPrefix(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-`;
}

/** A slug suggested from the link's name ("Mudd review flyer, fall" -> "mudd-review-flyer-fall"). */
export function suggestSlug(name) {
  return normalizeTag(name) || "";
}

/** The next free slug when `slug` is taken: review-mudd-2, review-mudd-3, ... */
export function nextFreeSlug(slug, taken) {
  const used = new Set(taken);
  if (!used.has(slug)) return slug;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${slug.slice(0, MAX_TAG_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

/*
 * A destination on our own domain, stored as a path ("/browse?x=1"). Accepts a
 * bare path or a full useproximity.org URL. Anything else (another domain,
 * protocol-relative "//", javascript:, whitespace, backslashes) is refused.
 * Any src already on it is dropped: the link adds its own.
 */
export function normalizeDestination(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { path: null, error: "Choose where the link should go." };
  if (/[\s\\]/.test(input)) return { path: null, error: "The destination cannot contain spaces or backslashes." };

  let url;
  if (input.startsWith("/")) {
    if (input.startsWith("//")) return { path: null, error: "The destination must be a page on useproximity.org." };
    url = new URL(input, SITE_ORIGIN);
  } else {
    try {
      url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
    } catch {
      return { path: null, error: "That destination is not a valid address." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { path: null, error: "The destination must be a page on useproximity.org." };
    if (!OWN_HOSTS.includes(url.hostname.toLowerCase())) return { path: null, error: "The destination must be a page on useproximity.org." };
  }

  url.searchParams.delete("src");
  const path = `${url.pathname}${url.search}`;
  if (path.length > 500) return { path: null, error: "The destination is too long." };
  return { path, error: null };
}

/** Add src=<slug> to a destination path, keeping its own query. */
export function withSrc(destinationPath, slug, extraParams = null) {
  const url = new URL(destinationPath || "/", SITE_ORIGIN);
  if (extraParams) {
    for (const [k, v] of new URLSearchParams(extraParams)) {
      if (k !== "src") url.searchParams.set(k, v);
    }
  }
  url.searchParams.set("src", slug);
  return `${url.pathname}${url.search}`;
}

export const shortLink = (slug, origin = SITE_ORIGIN) => `${origin}/go/${slug}`;
export const fullLink = (destinationPath, slug, origin = SITE_ORIGIN) => `${origin}${withSrc(destinationPath, slug)}`;

/*
 * Where /go/<slug> sends a visitor: the link's destination with src added and
 * the incoming query string carried through (the same way /r works). Unknown
 * slugs go home but keep ?src=<slug>, so the visit is still recorded as
 * qr / <slug> and shows up under unregistered tags.
 */
export function goRedirectPath(link, slug, incomingSearch = "") {
  return withSrc(link ? link.destination_path : "/", slug, incomingSearch);
}

/**
 * Validate a create or edit. `partial` (edits) only checks the fields sent.
 * Returns { value, errors } where errors maps field -> message.
 */
export function validateLinkInput(input, { partial = false } = {}) {
  const errors = {};
  const value = {};
  const has = (k) => input[k] !== undefined;

  if (!partial || has("name")) {
    const name = String(input.name ?? "").trim();
    if (!name) errors.name = "Give the link a name.";
    else if (name.length > 120) errors.name = "Keep the name under 120 characters.";
    else value.name = name;
  }

  if (!partial) {
    const slug = normalizeTag(input.slug);
    if (!slug) errors.slug = "Choose a slug (letters, digits, dash or underscore).";
    else value.slug = slug;
  }

  if (!partial || has("source")) {
    const source = normalizeTag(input.source);
    if (!source) errors.source = "Choose a source.";
    else value.source = source;
  }

  if (!partial || has("medium")) {
    if (!LINK_MEDIUMS.includes(input.medium)) errors.medium = "Choose a medium.";
    else value.medium = input.medium;
  }

  if (!partial || has("campaign")) {
    const campaign = normalizeTag(input.campaign);
    if (!campaign || !CAMPAIGN_RE.test(campaign)) errors.campaign = "Use <yyyy-mm>-<short-name>, for example 2026-11-spring-lease-push.";
    else value.campaign = campaign;
  }

  if (!partial || has("content")) {
    const raw = String(input.content ?? "").trim();
    if (!raw) value.content = null;
    else {
      const content = normalizeTag(raw);
      if (!content) errors.content = "Use letters, digits, dash or underscore.";
      else value.content = content;
    }
  }

  if (!partial || has("destination_path")) {
    const { path, error } = normalizeDestination(input.destination_path);
    if (error) errors.destination_path = error;
    else value.destination_path = path;
  }

  return { value, errors };
}

/*
 * The leasing portals the importer and sync can walk (readers/portalWalk.js).
 *
 * Adding a platform is adding an entry here: how to spot its portal on a
 * landlord's site (find, hintRe, extraPages), how to open its app (resolve,
 * appUrl), and the walk script for its screens, returning the shared walk
 * shape. Everything after that (time budgets, carrying a long walk across
 * runs, turning prices into leases, the weekly refresh) is shared.
 *
 *   kind        stored on the monitor's portal, e.g. "realpage-oll"
 *   label       for logs and the digest
 *   hintRe      page HTML worth an extra fetch to look for the link
 *   find(html)  portal coordinates from a page, or null
 *   extraPages(siteUrl)  pages that state the link when a script adds it
 *   fromKnown(known)     coordinates from what an earlier read learned
 *   sameBuilding(portal, known)
 *   resolve(portal, known) -> { id, learned } or null
 *   appUrl(target), walkScript({ skip, budgetMs }), waitMs
 */
import { realpageOllPortal } from "./realpageOll.js";

export const WALKED_PORTALS = [realpageOllPortal];

const KINDS = new Set(WALKED_PORTALS.map((p) => p.kind));

/* A portal read by walking its app: prices from the landlord's own system. */
export const isWalkedPortal = (portal) => !!portal && KINDS.has(portal.kind);

export const walkedPortalFor = (kind) => WALKED_PORTALS.find((p) => p.kind === kind) ?? null;

/*
 * RealPage Online Leasing portal reader.
 *
 * A RealPage property's marketing site (Apartments247 and others) shows a
 * floor plan and a rent range. The real numbers sit behind "Apply Now": a
 * leasing portal at <propertyId>.onlineleasing.realpage.com, a four step
 * wizard (Floor Plans, Apartment, Lease Terms, Quote) whose third step
 * prices one apartment for every lease length the landlord sells (Lofts at
 * Forest Park and Ceylon: 6 to 15 months, each a different rent).
 *
 * The portal is an app, not pages: a plain fetch gets an empty shell and the
 * steps have no URLs of their own. So the reader opens the app in a rendered
 * browser and walks it the way a renter does, clicking a floor plan, an
 * apartment and Continue, and reads what the app loads on the way. It never
 * calls the portal's data service itself (Wyatt, 2026-11-10).
 *
 * What the walk has to know about the portal:
 *
 *   - The numbered landing page wraps the app in a frame and, on some
 *     properties, sends the whole tab elsewhere half way through. Opened by
 *     site number (oll-leasing.loftliving.com/oll/?siteId=...) the same app
 *     runs unframed. The landing page states that number in plain HTML.
 *   - The desired move-in date starts at the earliest date allowed and only
 *     moves forward, when an apartment that frees up later is chosen and the
 *     "change date?" question is answered Yes. Every price depends on it, so
 *     apartments are opened in the order they free up: each is then priced
 *     for its own earliest date.
 *   - A floor plan lists only the apartments free near the desired date, and
 *     never more than a set number of them. Apartments further out appear
 *     once the date has moved, so the list is read again after each pass.
 *   - A floor plan with one apartment opens with it already chosen.
 *   - One render has a time limit, so a walk reports what it priced and the
 *     next render carries on from there (readers/portalWalk.js runs that
 *     loop for every walked portal; this file is only what RealPage needs).
 */
import { REALPAGE_OLL_RE, appUrl, findRealPageOll, siteIdFromLanding } from "./realpageOllParse.js";
import { walkPortal, WALK_MS } from "./portalWalk.js";

export { findRealPageOll, REALPAGE_OLL_HINT_RE, nextSundayCheckAt } from "./realpageOllParse.js";
import { REALPAGE_OLL_HINT_RE as REALPAGE_OLL_HINT_RE_LOCAL } from "./realpageOllParse.js";

export const REALPAGE_OLL_KIND = "realpage-oll";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* The site number, from the portal's landing page. */
export async function resolveSiteId(propertyId) {
  if (!/^\d{5,9}$/.test(String(propertyId ?? ""))) return null;
  try {
    const res = await fetch(`https://${propertyId}.onlineleasing.realpage.com/`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return siteIdFromLanding(await res.text());
  } catch {
    return null;
  }
}

/*
 * The walk, run inside the rendered app. String.raw keeps it exactly as
 * written (no build step touches it); the options go in where __OPTS__ is.
 *
 * It returns JSON: { plans, units, priced, log, done, timeUp }.
 */
const WALK = String.raw`
(async () => {
  const OPTS = __OPTS__;
  const T0 = Date.now();
  const left = () => OPTS.budgetMs - (Date.now() - T0);
  const out = { plans: [], units: {}, priced: [], log: [], done: false, timeUp: false };
  const note = (s) => { if (out.log.length < 60) out.log.push(String(s).slice(0, 140)); };
  try {
    const frame = document.getElementById('rp-leasing-widget');
    const win = frame && frame.contentWindow ? frame.contentWindow : window;
    const doc = () => (frame && frame.contentDocument) || document;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms) => {
      const t = Date.now();
      while (Date.now() - t < (ms || 30000)) {
        try { if (fn()) return true; } catch (e) {}
        await sleep(300);
      }
      return false;
    };

    // ---- what the app loads, read as it arrives
    const cap = { seq: 0, units: null, detail: null, moveIn: null };
    const stamp = (s) => {
      const m = /Date\((-?\d+)([+-]\d{4})?\)/.exec(String(s || ''));
      if (!m) return null;
      const ms = Number(m[1]);
      if (!(ms > 0)) return null;
      const off = m[2] ? (Number(m[2].slice(0, 3)) * 60 + Number(m[2][0] + m[2].slice(3))) : 0;
      return new Date(ms + off * 60000).toISOString().slice(0, 10);
    };
    const take = (text) => {
      let j;
      try { j = JSON.parse(text); } catch (e) { return; }
      const groups = j && j.Workflow && j.Workflow.ActivityGroups;
      if (!groups) return;
      for (const g of groups) for (const a of (g.GroupActivities || [])) {
        if (Array.isArray(a.Floorplans) && a.Floorplans.length) {
          out.plans = a.Floorplans.map((f) => ({
            id: String(f.Id), name: f.Name, bedrooms: f.Bedrooms, bathrooms: f.Bathrooms,
            area: f.Squarefeet || f.MinSquareFeet || null,
            image: (f.Image2dUrl || f.Image3dUrl || '').replace('%s', '640x640') || null,
          }));
        }
        if (a.IsCurrent && Array.isArray(a.Units)) {
          cap.units = { plan: a.Floorplan && a.Floorplan.Name, units: a.Units };
          cap.seq += 1;
        }
        if (a.IsCurrent && a.UnitDetails && Array.isArray(a.UnitDetails.PricePlans)) {
          cap.detail = a.UnitDetails;
          cap.moveIn = stamp(a.MoveInDate);
          cap.seq += 1;
        }
      }
    };
    const X = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (X && !X.__rpWatched) {
      X.__rpWatched = true;
      const open = X.open;
      const send = X.send;
      X.open = function (m, u) { this.__rpUrl = String(u); return open.apply(this, arguments); };
      X.send = function () {
        if (/appstate/i.test(this.__rpUrl || '')) {
          this.addEventListener('load', () => { try { take(this.responseText); } catch (e) {} });
        }
        return send.apply(this, arguments);
      };
    }

    // ---- the screen
    const leaf = (re) => Array.from(doc().querySelectorAll('*')).filter((e) => e.children.length === 0 && re.test((e.innerText || '').trim()) && e.offsetParent !== null);
    const step = () => leaf(/^Select Lease Term$/).length ? 3 : leaf(/^Select Apartment$/).length ? 2 : leaf(/^Select Floor Plan$/).length ? 1 : 0;
    const radios = () => Array.from(doc().querySelectorAll('input[type=radio]')).filter((r) => r.offsetParent !== null);
    const rows = () => leaf(/^#[\w-]+$/).filter((e) => { const r = e.closest('.flex-md-row'); return r && r.innerText.indexOf('*') >= 0; });
    const shown = () => rows().map((e) => e.innerText.trim().replace(/^#/, ''));
    const avBtns = () => leaf(/^\(\d+\) Available$/);
    const planOf = (b) => {
      let p = b;
      for (let i = 0; i < 7 && p.parentElement; i++) { p = p.parentElement; if (/sq ft/.test(p.innerText)) break; }
      return p.innerText.trim().split('\n')[0].trim();
    };
    const back = async (to) => {
      let guard = 0;
      while (step() > to && guard++ < 4) {
        const s = step();
        await waitFor(() => leaf(/^Back$/).length > 0, 15000);
        const b = leaf(/^Back$/)[0];
        if (!b) return;
        b.click();
        await waitFor(() => step() < s && step() > 0, 30000);
        await sleep(1500);
      }
    };
    const openPlan = async (plan) => {
      for (let k = 0; k < 2; k++) {
        await back(1);
        if (!(await waitFor(() => avBtns().length > 0, 30000))) return false;
        await sleep(800);
        const b = avBtns().find((x) => planOf(x) === plan);
        if (!b) return false;
        const seq = cap.seq;
        b.click();
        if (await waitFor(() => step() === 2 && rows().length > 0, 25000)) {
          await waitFor(() => cap.seq > seq, 3000);
          await sleep(700);
          return true;
        }
        note('retry ' + plan);
        await sleep(3000);
      }
      return false;
    };
    const rowText = (e) => e.closest('.flex-md-row').innerText.replace(/\s+/g, ' ').trim();
    const sayToIso = (s) => {
      if (!s || /now/i.test(s)) return null;
      const t = Date.parse(s + ' 12:00:00 UTC');
      return isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
    };
    const desired = () => {
      const i = doc().querySelector('input[type=text]');
      return sayToIso(((i && i.value) || '').split(' - ')[0]);
    };

    // ---- one floor plan's apartments, as listed now
    const listPlan = async (plan) => {
      if (!(await openPlan(plan))) { note('no plan ' + plan); return; }
      const visible = shown();
      const seen = {};
      if (cap.units && cap.units.units && (!cap.units.plan || cap.units.plan === plan)) {
        for (const u of cap.units.units) {
          const number = String(u.UnitNumber || '').trim();
          if (!number) continue;
          seen[number] = {
            plan, number,
            avail: /now/i.test(u.AvailableDateString || '') ? null : stamp(u.AvailableDate),
            min: u.MinPriceRange || null, max: u.MaxPriceRange || null, twelve: u.TwelveMonthsRent || null,
            deposit: u.Deposit || null, area: u.Squarefeet || null,
          };
        }
      }
      // The screen, for anything the app's own list did not carry.
      for (const e of rows()) {
        const m = rowText(e).match(/^#([\w-]+) (.*?\*) (.*?)( Amenities.*)?$/);
        if (!m || seen[m[1]]) continue;
        const prices = (m[2].match(/[\d,]+/g) || []).map((x) => Number(x.replace(/,/g, '')));
        seen[m[1]] = { plan, number: m[1], avail: sayToIso(m[3]), min: prices[0] || null, max: prices[prices.length - 1] || null, twelve: null, deposit: null, area: null };
      }
      for (const number of Object.keys(seen)) {
        const prior = out.units[number] || {};
        out.units[number] = Object.assign({}, prior, seen[number], { visible: visible.indexOf(number) >= 0, tries: prior.tries || 0 });
      }
      for (const number of Object.keys(out.units)) {
        if (out.units[number].plan === plan && !seen[number]) out.units[number].visible = false;
      }
    };

    // ---- one apartment's Lease Terms step; record = false only moves the date on
    const openUnit = async (u, record) => {
      if (!(await openPlan(u.plan))) return false;
      const idx = shown().indexOf(u.number);
      if (idx < 0) { u.visible = false; return false; }
      const r = radios()[idx];
      if (r && !r.checked) { r.click(); await sleep(800); }
      if (!(await waitFor(() => leaf(/^Continue$/).length > 0, 15000))) return false;
      const seq = cap.seq;
      cap.detail = null;
      leaf(/^Continue$/)[0].click();
      await waitFor(() => step() === 3 || leaf(/^Yes$/).length > 0, 30000);
      if (step() !== 3 && leaf(/^Yes$/).length) {
        leaf(/^Yes$/)[0].click();
        await waitFor(() => step() === 3, 30000);
      }
      if (step() !== 3) return false;
      await waitFor(() => /months? Lease\s*\$/.test(doc().body.innerText), 20000);
      await waitFor(() => cap.seq > seq && cap.detail, 2500);
      await sleep(1200);
      if (!record) return true;
      const text = doc().body.innerText;
      const terms = {};
      let services = [];
      let deposit = u.deposit || null;
      const d = cap.detail && String(cap.detail.UnitNumber || '').trim() === u.number ? cap.detail : null;
      if (d) {
        for (const p of d.PricePlans) if (p && p.DurationInMonths > 0 && p.MonthlyRent > 0) terms[p.DurationInMonths] = Math.round(p.MonthlyRent);
        services = (d.IncludedServices || []).filter((s) => s && s.Name && s.Amount > 0).map((s) => [String(s.Name), Number(s.Amount)]);
        deposit = d.Deposit || deposit;
      }
      if (!Object.keys(terms).length) {
        const re = /(\d+) months? Lease\s*\$([\d,]+(?:\.\d+)?)/g;
        let m;
        while ((m = re.exec(text))) terms[Number(m[1])] = Math.round(Number(m[2].replace(/,/g, '')));
      }
      const side = text.slice(Math.max(0, text.indexOf('Monthly Payment'))).replace(/\s+/g, ' ');
      const said = (side.match(/Move-In (\w+ \d+, \d{4})/) || [])[1];
      if (!services.length) {
        const svc = (side.match(/Additional Services (.*?)(?: Show Me| Desired Move-In|$)/) || [])[1] || '';
        const re2 = /([A-Za-z][A-Za-z /&-]{2,50}?) \$([\d,]+(?:\.\d+)?)/g;
        let m2;
        while ((m2 = re2.exec(svc))) services.push([m2[1].trim(), Number(m2[2].replace(/,/g, ''))]);
      }
      if (!Object.keys(terms).length) return false;
      out.priced.push({ number: u.number, plan: u.plan, moveIn: sayToIso(said) || (d && cap.moveIn) || desired(), terms, services, deposit });
      return true;
    };

    // ---- the walk
    await waitFor(() => leaf(/^Start$/).length > 0 || avBtns().length > 0, 30000);
    if (leaf(/^Start$/).length) { leaf(/^Start$/)[0].click(); await sleep(1500); }
    if (!(await waitFor(() => avBtns().length > 0, 30000))) { note('no floor plans listed'); return JSON.stringify(out); }
    const skip = {};
    for (const n of (OPTS.skip || [])) skip[String(n)] = true;
    const got = () => { const s = {}; for (const q of out.priced) s[q.number] = true; return s; };
    const when = (u) => u.avail || '';
    let hops = 0;
    for (let round = 0; round < 10; round++) {
      // Each round starts from the floor plan list: the date may have moved
      // since the last one, and with it which apartments are listed.
      await back(1);
      if (!(await waitFor(() => avBtns().length > 0, 30000))) { note('floor plans did not come back'); break; }
      const plans = Array.from(new Set(avBtns().map(planOf)));
      for (const plan of plans) {
        if (left() < 25000) { out.timeUp = true; break; }
        await listPlan(plan);
      }
      if (out.timeUp) break;
      const have = got();
      const pending = Object.keys(out.units).map((n) => out.units[n]).filter((u) => !have[u.number] && !skip[u.number] && u.tries < 2).sort((a, b) => when(a).localeCompare(when(b)));
      let progressed = 0;
      for (const u of pending) {
        if (left() < 22000) { out.timeUp = true; break; }
        if (!u.visible) continue;
        u.tries += 1;
        if (await openUnit(u, true)) progressed += 1; else note('could not open ' + u.number);
      }
      if (out.timeUp) break;
      // Pricing moved the date on: look again for apartments now listed.
      if (progressed) continue;
      // Nothing to price on screen. Apartments that free up later only list
      // once the date is nearer theirs, so choosing the latest apartment on
      // screen moves the date on; when none is later than the date, the
      // portal has shown everything it has.
      const now = desired() || '';
      const ahead = Object.keys(out.units).map((n) => out.units[n]).filter((u) => u.visible && when(u) > now).sort((a, b) => when(b).localeCompare(when(a)))[0];
      if (!ahead || hops >= 6) { out.done = true; break; }
      if (left() < 30000) { out.timeUp = true; break; }
      hops += 1;
      note('moving the date on with ' + ahead.number);
      if (!(await openUnit(ahead, false))) { note('could not move the date on'); break; }
    }
    if (out.timeUp) out.done = false;
  } catch (e) {
    note('error ' + String((e && e.message) || e));
  }
  for (const n of Object.keys(out.units)) { delete out.units[n].visible; delete out.units[n].tries; }
  return JSON.stringify(out);
})()`;

export function walkScript({ skip = [], budgetMs = WALK_MS } = {}) {
  return WALK.replace("__OPTS__", JSON.stringify({ skip: skip.map(String), budgetMs }));
}

/*
 * The portal as readers/portalWalk.js needs it. Found on the landlord's site
 * by its landing page link, or (when a script adds that link) on the site's
 * own /application/ page; opened unframed by site number.
 */
export const realpageOllPortal = {
  kind: REALPAGE_OLL_KIND,
  label: "RealPage",
  hintRe: REALPAGE_OLL_HINT_RE_LOCAL,
  find: findRealPageOll,
  // Pages worth one fetch when the link is not in the HTML.
  extraPages: (siteUrl) => {
    try {
      return [new URL("/application/", siteUrl).href];
    } catch {
      return [];
    }
  },
  fromKnown: (known) => ({ propertyId: known.propertyId ?? null, siteId: known.siteId ?? null }),
  sameBuilding: (portal, known) => !portal.propertyId || !known.propertyId || known.propertyId === portal.propertyId,
  async resolve(portal, known) {
    const siteId = portal.siteId ?? known?.siteId ?? (await resolveSiteId(portal.propertyId));
    if (!siteId) return null;
    return { id: siteId, learned: { propertyId: portal.propertyId ?? known?.propertyId ?? null, siteId } };
  },
  appUrl: (target) => appUrl(target.id),
  walkScript,
};

/* Read a building through its RealPage portal (readers/portalWalk.js walkPortal). */
export function readRealPageOll(portal, opts = {}) {
  return walkPortal(realpageOllPortal, portal, opts);
}

export { REALPAGE_OLL_RE };

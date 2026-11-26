/*
 * Entrata floor plans, as the "pm-entrata-manager" WordPress plugin renders
 * them (everlyontheloop.com and the rest of the student-housing sites built
 * on it).
 *
 * The floor-plans page is server-rendered, so no render credit is needed, and
 * every plan is one `.element-item` block carrying what we want as data
 * attributes and labelled spans:
 *
 *   <div class="element-item js-filterable onebed available"
 *        data-name="A1 Penthouse" data-beds="onebed" data-status="available"
 *        data-price="1965">
 *     <img src="...medialibrarycf.entrata.com/....jpg" alt="A1 Penthouse_floor_plan">
 *     <div class="fp-bed-count">1 BED / 1 BATH</div>
 *     <span class="fp-price-label">Starting at</span> <span class="fp-price-value">$1,965.00*</span>
 *     ... "611 SQ.FT" in the plan's popup ...
 *     <div class="fp-full-disclaimer">*Rates are listed as installments and are per person / per bed.</div>
 *
 * Per-apartment availability lives behind the prospect portal (a login), so
 * what this reads is the plan grain: name, layout, size, starting price, the
 * floor plan diagram, and whether the plan is being let. The per-person
 * footnote is the important catch: a student-housing site quoting "$1,965"
 * means per bed, and storing it as whole-unit rent would understate a 4-bed
 * by three quarters.
 */
import { htmlToText } from "@/lib/listingDraft/fetchSite";
import { isoDate, money, num } from "../snapshot.js";

export const ENTRATA_HINT_RE = /pm-entrata-manager|medialibrarycf\.entrata\.com|entrata\.com/i;

const PER_PERSON_RE = /per\s+(person|bed|bedroom|room)\b|per\s+bed\s*\/\s*person|installment/i;

function attr(block, name) {
  const m = block.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return m ? decode(m[1]) : null;
}

function decode(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

/* Does this page carry Entrata floor plan cards at all? */
export function looksLikeEntrataFloorPlans(html) {
  return /class=["'][^"']*\belement-item\b[^"']*["']/i.test(html ?? "") && /fp-(bed-count|price-value)/i.test(html ?? "");
}

/*
 * Split the page into plan blocks. Each `.element-item` div runs until the
 * next one (or the end of the list), which is enough because the plugin never
 * nests one plan inside another.
 */
function planBlocks(html) {
  const starts = [];
  const re = /<div[^>]*class=["'][^"']*\belement-item\b[^"']*["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) starts.push(m.index);
  return starts.map((start, i) => html.slice(start, starts[i + 1] ?? start + 20000));
}

/* The plan's popup, which carries the size and the base rent line. */
function popupFor(html, id) {
  if (!id) return "";
  const i = html.indexOf(`id="unit_${id}"`);
  if (i < 0) return "";
  return html.slice(i, i + 8000);
}

/*
 * Returns { units, perPerson, notes } or null when the page has no plans.
 * `units` are raw snapshot units: one per plan, one offer each.
 */
export function parseEntrataFloorPlans(html, pageUrl) {
  if (!looksLikeEntrataFloorPlans(html)) return null;
  const blocks = planBlocks(html);
  if (!blocks.length) return null;

  const pageText = htmlToText(html);
  const perPerson = PER_PERSON_RE.test(pageText);
  const units = [];
  const seen = new Set();

  for (const block of blocks) {
    const name = attr(block, "data-name") || htmlToText(block.match(/class=["'][^"']*floor-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const status = (attr(block, "data-status") || attr(block, "data-av-status") || "").toLowerCase();
    const countText = htmlToText(block.match(/class=["'][^"']*fp-bed-count[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const studio = /studio/i.test(countText) || attr(block, "data-beds") === "studio";
    const beds = studio ? 0 : num(countText.match(/(\d+)\s*(?:bed|br|bd)/i)?.[1], { max: 20 });
    const baths = num(countText.match(/(\d+(?:\.\d)?)\s*(?:bath|ba)/i)?.[1], { max: 20 });

    const priceAttr = money(attr(block, "data-price"));
    const priceText = money(block.match(/fp-price-value[^>]*>\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)?.[1]);
    const rent = priceAttr ?? priceText;

    const id = block.match(/data-id=["'](\d+)["']/)?.[1] ?? block.match(/#unit_(\d+)/)?.[1] ?? null;
    const popup = popupFor(html, id);
    const popupText = htmlToText(popup);
    const area = num(
      (popupText.match(/([\d,]{3,6})\s*sq\.?\s*ft/i) ?? htmlToText(block).match(/([\d,]{3,6})\s*sq\.?\s*ft/i))?.[1],
      { max: 20000, min: 50 }
    );
    const availableFrom = isoDate(
      (popupText.match(/available\s*(?:on|from)?\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i) ??
        popupText.match(/available\s*(?:on|from)?\s*:?\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{0,4})/i))?.[1]
    );

    const img =
      block.match(/<img[^>]+src=["']([^"']+)["'][^>]*alt=["'][^"']*floor[_\s-]?plan[^"']*["']/i)?.[1] ??
      block.match(/<img[^>]+alt=["'][^"']*floor[_\s-]?plan[^"']*["'][^>]*src=["']([^"']+)["']/i)?.[1] ??
      block.match(/<img[^>]+src=["']([^"']*medialibrarycf\.entrata\.com[^"']+)["']/i)?.[1] ??
      null;

    const waitlisted = /waitlist|unavailable|not available|sold out/.test(status) || rent == null && /waitlist/i.test(htmlToText(block));
    units.push({
      name,
      bedrooms: beds,
      bathrooms: baths,
      area,
      floorPlanImageUrl: img ? decode(img) : null,
      available: !waitlisted,
      photos: [],
      offers: rent == null ? [] : [{ rent, rentIsPerPerson: perPerson, leaseTermMonths: [], availableFrom, apartments: [] }],
    });
  }

  if (!units.length) return null;
  const notes = [];
  if (perPerson) {
    notes.push("This site quotes rent per person (per bed). Prices were imported as per-person rents.");
  }
  if (units.every((u) => !u.offers.length || !u.offers[0].leaseTermMonths.length)) {
    notes.push("The site does not publish lease lengths on its floor plans. Choose them for each lease before publishing.");
  }
  return { units, perPerson, notes, pageUrl };
}

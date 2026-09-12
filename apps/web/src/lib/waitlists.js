/*
 * Properties that run their own waitlist off-site.
 *
 * A handful of the big purpose-built buildings take interest through their own
 * form rather than through our contact flow, and pay a commission on students
 * who arrive from here. Those get an extra call to action on the listing.
 *
 * Keyed by listings.property_key (normalized "street|zip"), NOT by listing id.
 * Listing UUIDs are the same in prod and dev only for as long as the snapshot
 * script keeps cloning them, and a re-created listing would silently drop the
 * button. The property key survives both.
 */

/*
 * Placeholders a destination URL may carry. They exist because the landlord's
 * form is theirs: its entry.NNN field ids are unguessable, they differ between
 * their live form and any test copy, and we cannot change them. Keeping the
 * whole URL in an env var means switching forms is one paste of the "Get
 * pre-filled link" URL that Google itself generates, with the sample values
 * swapped for these tokens. No redeploy, no field ids in code.
 */
const PLACEHOLDERS = ["name", "email", "phone"];

const WAITLISTS = {
  "6650 delmar boulevard|63130": {
    label: "Waitlist",
    /*
     * A getter, not a string, so the env var is read on the server at request
     * time. This module is imported by the listing UI too, where only `label`
     * is used: the browser never needs the destination because it only ever
     * links to our own route, which is what makes the click countable.
     */
    getUrl: () =>
      process.env.LOCAL_DELMAR_WAITLIST_URL ||
      "https://docs.google.com/forms/d/e/1FAIpQLSfdmisbRQWfVHi2E-W_N9u5ihp4GjQPdYoPtVtkGlMXUBu9Gg/viewform" +
        "?entry.514226213={name}&entry.920932702={phone}&entry.13401612={email}",
  },
};

/**
 * The waitlist for a property key, or null when it doesn't run one.
 * Null is the normal answer: all but a couple of listings have no waitlist.
 */
export function waitlistFor(propertyKey) {
  if (!propertyKey) return null;
  return WAITLISTS[propertyKey.trim().toLowerCase()] ?? null;
}

/**
 * Resolve a waitlist's destination, substituting whatever contact details we
 * have. Server-side only.
 *
 * Validated rather than trusted: this value ends up in a Location header, so a
 * typo'd or half-set env var would otherwise turn the route into an open
 * redirect. Anything that isn't an absolute http(s) URL is treated as not
 * configured, which surfaces as a 404 instead of bouncing a student somewhere
 * unintended.
 *
 * Unfilled placeholders are stripped rather than left literal, so a signed-out
 * student who never reached the form still gets a clean blank one instead of a
 * field reading "{name}".
 */
export function resolveWaitlistUrl(waitlist, values = {}) {
  const template = waitlist?.getUrl?.();
  if (!template) return null;

  let url;
  try {
    url = new URL(template);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  /*
   * Substituted on searchParams rather than on the raw string: setting a value
   * through the URL API encodes it for us, so an ampersand in a name cannot
   * split into a second field, and a "{name}" typed into one of our own inputs
   * is inert by the time it gets here.
   */
  for (const [key, raw] of [...url.searchParams.entries()]) {
    const match = /^\{(\w+)\}$/.exec(raw.trim());
    if (!match || !PLACEHOLDERS.includes(match[1])) continue;
    const value = String(values[match[1]] ?? "").trim();
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }

  return url.toString();
}

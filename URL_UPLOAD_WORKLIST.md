# URL upload — open worklist

Working file for the paste-your-website importer. Every item came from Ben
testing the real flow. Tick a box only when it is verified against a live site,
not when the code looks right.

Branch: `fix/listing-draft-multi-property`

---

## Open

### A. Lease terms still come back empty on RentCafe buildings
The only item from Ben's last round that is not fixed.

The data exists and is readable. The leasing application page for a Dorchester
apartment says, in as many words:

    Plan dor-3bTD ... Lease Term 12 months  Rent $2,395.00
    We offer flexible lease terms ranging from 3 to 24 months. The rental rate
    displayed on our website reflects the current best available pricing for a
    qualifying lease term...

Fetched directly it parses fine, range and all. Reached through the importer it
does not. The apply link is picked off the floor-plan page, and the first
attempt grabbed `/residentservices/userlogin`, a sign-in wall with no lease
information on it. Tightening the match to `oleapplication` did not fix it, so
either the link is missing from the render we keep, or the second fetch fails
quietly.

- [ ] Log which URL is chosen and what the fetch returns, rather than guessing
- [ ] Verify terms arrive through the picker route

When it works: the rent goes on **12 months** (the term the page says its rate
reflects), `leaseTermPrices` stays empty, and a source note records that terms
run 3 to 24 months and only one rate is published. Never spread one price
across a range, and never invent a price for a term the page does not price.

---

## Done and verified against live sites

- [x] **Rent specials, end to end.** `listing_concessions` had zero rows and
      zero code touching it. The importer now reads specials wherever a site
      puts them, including a header banner or an arrival popup, writes them on
      publish with the amount, type and deadline parsed out, and the listing
      shows them directly above the prices they change. Verified on dev: "1
      month free rent, must sign on or before September 30 2026" stored as
      months_free / 1 / 2026-09-30, and "$500 off first month, ends 11/15/2026"
      as flat / 500 / 2026-11-15.
- [x] **Lease-term range** now reaches the route: Dorchester reports terms
      3 to 24 months with the displayed rate being the 12-month rate.

- [x] **Drill-down runs when a property is picked from a list.** This was the
      big one: the gate was `!targetProperty`, so reaching a building through
      the picker skipped it and published twelve units numbered by floor plan
      (100N101A) with no terms and one price each. Verified through the picker
      route: 100 on the Park returns 2701 and 1501 at $3,095 and $3,080, and
      1301 and 901 on 9 November and 7 January.
- [x] **Per-apartment prices and dates** on both buildings.
- [x] **Dorchester** returns ten named plans and forty-four apartments, 06D at
      $2,395 among them.
- [x] **Floor plan names land** (100N101C, DOR 3BTD, DOR 1BTB). The backstop
      that moves a unit code out of the name box was eating them; it now only
      moves a title that IS one of that plan's own apartment numbers.
- [x] **Speed and the production ceiling.** `maxDuration` was 120 while the read
      took 197s, so this would have failed in production while passing locally.
      Units are now built from the parsed pages instead of being echoed back by
      the model, which cost 17,000 output tokens and pushed one import to 308s.
      Now ~200s for 100 on the Park, ~114s for Dorchester, and the numbers are
      exact rather than transcribed. `maxDuration` is 300.
- [x] **Start over** clears the address and shows the empty paste box.
- [x] **The property-wide "when is it available?"** hides once every apartment
      has its own date, and stays as the fallback the API already applied.
- [x] Per-term price curve on metroflatsstl.com (confirmed by Ben).
- [x] Several priced offerings per unit write to `unit_leases` (dev: A114 got
      three, A312 got two, each with its own date).
- [x] Portal pages import as one listing, not a picker of competitors.
- [x] Dead portal listings say so instead of returning an empty picker.
- [x] One retry before "we couldn't reach that page".

---

## Standing rules for this work

- Test with **real URLs**, few of them. Each import costs Firecrawl credits and
  100 on the Park alone is twelve rendered pages.
- The 34-site corpus and harness live in `/tmp/audit/`. Re-run it **once** at
  the end, not while iterating. During development work from the saved JSON in
  `/tmp/audit/results/`, which costs nothing.
- Test through the **picker** (paste `macapartments.com`, choose the building),
  not by pasting the building's own URL. The two take different code paths and
  the picker path is the one landlords use. That difference hid this round's
  main bug.
- The importer is capped at 20 per hour per landlord and the counter is in
  memory, so a long session needs the dev server restarted between batches.
- Delete any listing published against dev while testing.
- The UI has to stay legible to a landlord who is not technical. One price and
  one date is the common case and must not get buried under the controls that
  exist for complicated buildings.

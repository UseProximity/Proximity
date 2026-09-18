# URL upload — open worklist

Working file for the paste-your-website importer. Every item came from Ben
testing the real flow. Tick a box only when it is verified against a live site,
not when the code looks right.

Branch: `fix/listing-draft-multi-property`

---

## Open

### D. Floor plan diagrams: better, not complete
Ben asked whether floor plans were being pulled into the unit-level photos. They
were not — nothing was. The plan pages were being opened for their apartments
and their images thrown away, so the model was never shown a diagram it could
put on a unit, and every import published with none.

They are read off each plan's own page now, which needs no guessing: the page IS
the plan. Preferred signal is the label ("Floor Plan 100N101a") together with the
plan code in the file path; where a render arrives without alt text, the file
name is the second witness (these assets end "_fp.jpg"). Measured: 0 of 16
before, 5 of 16 with the label alone, and the four plans tested individually
after adding the file-name signal all resolve one.

They go on the unit's own floor-plan slot, never into the photo gallery, which
was the other half of Ben's question.

- [ ] Count them again on a full import; anything short of 16 of 16 means a
      third signal is needed

### C. A floor plan imported as a 1108-bedroom apartment — SOURCE FOUND
Ben, on the plan holding apartments 1508 and 2708 (100N108A).

**Correction to what is written below.** I first said "1108 does not appear
anywhere on that page". It does. I had searched the page's TEXT and never
searched the image URLs, which we hand the model as candidates. The floor-plan
image for that very plan is:

    p2245715_new_100n108a_one-hundred-100n_1b08a-1108-kitchen-thumbnail_2_fp.jpg

`1b08a-1108-kitchen`. The model took the bed count out of an image file name.

The full chain, and every link is now covered:

1. The page render sometimes does not yield a bed count to the parser. Parsed
   directly it returns 1 every time; in one import it came back empty. Same
   render variance as the lease terms.
2. With the parse empty, the model's number is used, and the model read 1108 out
   of the image file name. The prompt now says outright that image URLs are for
   choosing pictures and nothing else, with this exact failure as the example.
3. The parser only accepted the count BEFORE the word ("1 Bedroom") and not
   after it ("Bedrooms: 1"), which is one plausible reason a render slips past
   it. Both spellings read now, for beds and baths.
4. A count outside what a home can have is still dropped to blank rather than
   published.

So the blank Ben saw was step 4 catching step 2. Step 3 makes the parse less
likely to need step 2 at all.

- [ ] Confirm 100N108A comes back as 1 bed on a full import

### B. Only the one-bedrooms imported (being verified)
Ben, testing One Hundred Above the Park: "it only logged the 1 beds, not the
studios or 2 or 3 beds."

The building publishes **thirty-six** floor plans. Two separate caps of twelve
were cutting that down, and both cut in page order, which on this site groups
the plans by size: the one-bedrooms (`100n1xx`) come first, the two- and
three-beds in the middle, and the studios (`100n002a/b/h`) last. So the cap did
not take a random twelve, it took every one-bedroom and nothing else.

- `MAX_PLANS` in `floorPlanUnits.js` decided how many plans existed at all.
- `listing.units.slice(0, 12)` in `AddListingWizard.js` cut the list again on
  the way into the form, so even a complete list would have arrived truncated.

Fixed by separating two things that were one number:

- **Every** plan on the index becomes a unit. The model reads the index and
  lists them; nothing is dropped for being late in the page.
- Opening a plan's own page is what costs a Firecrawl render, so that stays
  capped (16), but the budget is now spread evenly across the list instead of
  taken off the front, so every size gets some of its apartments read.
- The merge reversed direction: the model's list is the spine and the pages we
  opened fill in apartments, prices and dates. It used to be the other way
  round, which is why the list could only ever be as long as the drill.

- [x] Verified against the live site: One Hundred Above the Park now imports
      **36 floor plans — 3 studios, 18 one-beds, 13 two-beds, 2 three-beds** —
      in 116 seconds, with 16 of them carrying their own apartments, prices and
      dates. It used to import twelve one-bedrooms.

A floor plan the site lists without naming any apartment (twenty of the
thirty-six) becomes one unnamed unit rather than a card demanding apartment
numbers nobody published. Without that the import stopped dead at "list the unit
numbers for each floor plan" with twenty cards to open to find the blanks. A
card typed by hand never carries that flag, so the prompt still does its job in
the manual flow.

### A. Lease terms — fixed
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

- [x] Log which URL is chosen and what the fetch returns, rather than guessing.
      It now logs the link it picked, how much it read and whether a range was
      found, so this stops being a guessing game.
- [x] Verified through the picker route: all 36 floor plans arrive with the
      12-month term filled in, and the listing description carries "Lease terms
      from 6 to 24 months are available."

**The cause was markdown.** The same page reaches us in two formats. Fetched
directly it arrives as HTML and reads as plain prose. Fetched through Firecrawl
it arrives as *markdown*, so the sentence reads

    lease terms ranging from **6 to 24 months.**

and every regex here expected a digit where the render had put an asterisk. That
is exactly why this looked impossible to pin down: asked directly for a single
page it parsed perfectly every time, and through the importer it came back empty
every time, because those two paths do not fetch the same way. Emphasis is now
stripped before anything is matched, so both renders read the same. Worth
remembering for any future parser in this file.

The library call was never the problem. Asked directly for one plan page, it
returns `{min: 6, max: 24, reflects: "12"}` for One Hundred Above the Park, and
the apply link it picks is the right one (`oleapplication.aspx`, not the
resident portal). Two real faults found while checking:

- The range regex demanded the exact wording "ranging from", and this property
  writes "lease terms ranging from 6 to 24 months" while others write "range
  from". Loosened, and "through"/"and" accepted between the numbers.
- The property's rent special is not on the floor-plan pages at all. It is on
  the leasing application page, which we already open for the terms, so it is
  read there now: "6 WEEKS FREE RENT. Must sign lease on/before September 30th,
  2026. Lease term must be 10+ months." That page is also fetched when there is
  no range, so the special is not lost either way.

When it works: the rent goes on **12 months** (the term the page says its rate
reflects) and `leaseTermPrices` stays empty. Never spread one price across a
range, and never invent a price for a term the page does not price.

The range itself now goes on the **listing description**, which the lease panel
renders, not into a source note. Source notes are shown once during import
review and thrown away on publish, so a student would never have learned that
the rent assumes a particular lease length.

---

## Done and verified against live sites

- [x] **Photos survive a reload.** Ben: "why didnt it pull any of the photos".
      It did — nine of them, and every one downloads cleanly through the proxy.
      They were lost to the refresh. Staged photos are File objects in memory
      and the autosave is localStorage, which cannot hold a file, so a reload
      restored the address, units and rent and silently dropped every photo with
      nothing on screen to say they had been there. The URLs are a few hundred
      bytes of text, so they are saved now and fetched again on restore, which
      costs no credits. Staging is keyed on the source URL so the same photo is
      never staged twice: the first version of this put three photos on screen
      as six.
- [x] **Every floor plan imports, not just the ones we opened.** The model's
      list from the index is now the spine and the pages we open fill in
      apartments; it used to be the reverse, so the list could only ever be as
      long as the drill. Opening a page is what costs a Firecrawl render, so
      that stays capped at 16, but the budget is spread evenly across the list
      instead of taken off the front.
- [x] **Publishing a big building works.** Two faults, both mine, and the
      second hid the first. A floor plan with no published apartment numbers was
      being sent with a word in front and no number ("Unit", null), which is the
      one shape `listing_units_number_check` refuses: a unit may have a word and
      a number, or be "Whole" with no number, or have neither. It now has
      neither. And the listing row is written before its units, so the rejected
      insert left the listing behind — the retry was then told a listing already
      exists at that address, which was true and was the wreckage of the attempt
      that just failed. Renaming could not help, because that guard is on the
      address. A unit or lease insert that fails now takes the listing back out
      (everything cascades), so a failed publish leaves nothing behind. Verified
      both ways on dev: the two-unit shape publishes 201 with one unnumbered
      unit and one numbered, and a deliberately bad unit 500s with no listing
      left over. Test rows deleted.

      Fixing this at import was not enough and it failed again. A card picks up
      a word in front several ways — an import from before this was understood
      and still sitting in the autosaved draft, which a refresh restores, or the
      landlord choosing one from the dropdown and leaving the numbers empty — so
      the shape is now settled where the payload is built AND normalised again
      in the API, which turns a 500 nobody can act on into a correct row. Lesson
      worth keeping: a fix applied only on the way in does nothing for the
      drafts already saved.
- [x] **"Available now" shows on a single-date floor plan too.** The pill was
      only beside the per-apartment rows, so a plan with one date got an empty
      box and no pill and read as the one thing still to fill in. Blank is an
      answer there too, and now it says so.
- [x] **A big building is readable.** Thirty-six cards at ~800px each made the
      units step 27,804px tall. Above five floor plans each one is a single row
      saying what it is — name, size, rent, apartments, term — and opens when
      you want to change it. 2,900px. Anything still needing a decision says so
      on the closed row, so nothing that blocks publishing hides behind a
      chevron. A five-plan building is untouched, so a hand-typed listing never
      meets this.
- [x] **Rent specials, end to end.** `listing_concessions` had zero rows and
      zero code touching it. The importer now reads specials wherever a site
      puts them, including a header banner or an arrival popup, writes them on
      publish with the amount, type and deadline parsed out, and the listing
      shows them directly above the prices they change. Verified on dev: "1
      month free rent, must sign on or before September 30 2026" stored as
      months_free / 1 / 2026-09-30, and "$500 off first month, ends 11/15/2026"
      as flat / 500 / 2026-11-15. Specials are also read off the leasing
      application page now, which is where One Hundred Above the Park puts its
      "6 WEEKS FREE RENT" offer and where we already go for the lease terms.
      The same offer arriving from a banner and from that page is now recognised
      as one offer by its size and deadline rather than by its wording, which
      was letting the same discount onto a listing twice. That comparison is
      covered by a unit test over the real strings, not by a live import.
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
- **Firecrawl is the hard constraint, not the rate limiter.** The plan is 1,000
  credits a month on a 28th-to-28th cycle, with `maxConcurrency` of 2. One
  import of a building the size of One Hundred Above the Park costs roughly
  fifteen credits, because every floor-plan page is a separate render. Check
  `GET https://api.firecrawl.dev/v2/team/credit-usage` before a test round.
- Delete any listing published against dev while testing.
- The UI has to stay legible to a landlord who is not technical. One price and
  one date is the common case and must not get buried under the controls that
  exist for complicated buildings.

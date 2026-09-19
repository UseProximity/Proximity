# URL upload — open worklist

Working file for the paste-your-website importer. Every item came from Ben
testing the real flow. Tick a box only when it is verified against a live site,
not when the code looks right.

Branch: `fix/listing-draft-multi-property`

---

## The same floor plan twice — the fault that mattered most

Dorchester came back with 10 units on one run and 20 on the next, and both
passed every check, because each unit was individually fine. The reading was
never the problem: it found 10 plans and 44 apartments every single time.

The merge was. A plan's name is taken from its own URL — /floorplans/dor-3btd
becomes "DOR 3BTD" — while the model writes what the page prints, "DOR-3BTD".
The comparison stripped spaces but kept the hyphen, so on a run where the model
used a hyphen NONE of the ten plans bound to the unit it belonged to, and all
ten were appended alongside: twenty units, ten of them copies.

Names are now compared on their letters and digits alone. Three consecutive
Dorchester runs: 10 units, 10 with their apartments, every time.

**This is the one to remember for the sync.** A listing whose unit count flaps
between 10 and 20 depending on how a model spelled a name is exactly what a
nightly re-scrape would act on — and acting on it means publishing and
unpublishing a landlord's apartments overnight. The acceptance test now fails on
any floor plan that appears twice, which is a thing no correct import ever does.

## Audit of two published listings — five bugs, all fixed

Ben published One Hundred Above the Park and Dorchester to dev and asked for an
audit. The data itself was sound: 47 and 44 offerings, every one with bedrooms,
a rent and a lease length, rents $2,099-$5,850 and $1,375-$3,000. Five things
were wrong around it.

**1. Photographs in the floor plan box.** The worst of them, and mine twice
over. RentCafe puts alt="Floor Plan 100N101a" on the FIRST IMAGE OF THE
CAROUSEL, which is a photo of the kitchen, and names it "...kitchen1-thumbnail_2
_fp.jpg". I saw the label and the _fp and called it a diagram; then, shown my
own truncated output, I "corrected" myself into believing it again. It took
downloading the published file and looking at it — an oven — to settle. A floor
plan is now identified by its FILE (a plan word, no room word), and that test
applies to the model's choice as well, since the model reads the same misleading
label. Mac's two buildings keep 16 of 16 and 10 of 10 real diagrams; Lofts at
Euclid drops from seven to one and Vivienne from twenty-four to none, which is
those sites being honest — their diagrams open in a dialog and are not images on
the page. The acceptance test used to DEMAND five from Euclid, so it was
enforcing the bug.

**2. No rent specials on either listing**, though both imports found one. The
draft sends specials as plain sentences, and the wizard filtered for objects
with a `description` — which they stopped being when the schema was flattened to
get around a model error. Every special was dropped silently. The API had always
taken either shape.

**3. Five photos and nothing of the inside** on Dorchester. Not the model being
fussy: of 236 images gathered, only the first 60 were offered to it, and in page
order those were all from the home page and the floor-plans index — exteriors,
a lobby, a neighbourhood shot. The room photographs live on the individual plan
pages and never reached it. Candidates are now taken a page at a time so every
page that was read contributes. Dorchester went 5 to 12, and the new ones are
kitchens and living rooms. Same cap, same cost, better sixty.

**4. "When is it available?" still on the first card.** It hid only when EVERY
floor plan carried its own availability, and sixteen of One Hundred's thirty-six
do while the other twenty are plans with nothing free. So the building that most
obviously answers this per apartment was the one still asked, and it published
with a property-wide date of 18 September that means nothing. Any apartment read
off the site now settles it.

**5. Publishing took most of a minute.** One round trip per unit, then another
for that unit's leases: ninety-four in series for a forty-seven unit building.
All the units now go in one insert and all their leases in a second. Measured on
a forty-seven unit publish: 11 seconds, with the leases still on the right units
(1000 -> $2,000, 1023 -> $2,023, 1046 -> $2,046) and the special saved.

Both listings deleted from dev.

## Speed: the drill is not the thing to tune

Ben: "it took 160+ seconds... is that the fastest it can go?" without changing
the quality of the output.

Measured, not guessed. Six concurrent Firecrawl scrapes all return 200 on the
new plan, so opening six plan pages at once looks like free speed. Run across
the acceptance suite it is not: the biggest building went from 119 seconds to
**250**, close enough to the platform's 300-second limit to fail in production,
while saving twenty or thirty seconds on the small ones. The extra requests
queue on their side rather than running in parallel, and a queue behind one slow
page costs more than it saves. Left at 2.

Where a big import's time actually goes: sixteen floor-plan pages, then one
model call whose output is the units themselves. Both are the output. The one
free win already in place is that Firecrawl caches, so a building imported twice
is much faster the second time — which is why a test run flatters itself and a
landlord's first import will not.

If this is tuned again, tune it against the acceptance suite and read the times.
A burst of scrapes that all return 200 proves nothing about the import.

## Waitlist floor plans, and lease lengths a site won't publish

Ben, testing Vivienne (211 N. Meramec): "they are all missing lease lengths and
many pricing as well... its missing pricing for aloe and thats because on the
website it says join the waitlist. how should we display those that ask for a
waitlist? i imagine we shouldnty show them at all right"

**Waitlist plans arrive switched off, not hidden.** Vivienne lists eleven
layouts as "Pricing: Call For Details / Join Waitlist": Aloe, Bloom, Cleo,
Zephyr, Celeste, Liora, Maris, Mente Townhome, Opaline, Vesper and Holos. They
used to come through as ordinary units with an empty price, which reads as
something we failed to read rather than something the building is not letting.

Not hidden, because a silent omission is the fault Ben has already caught twice
this week and it is worse than a visible one: the landlord cannot tell the
difference between a plan we dropped and a plan we never saw. The card is
marked "Waitlist only", asks for nothing, and is one click to remove — and one
click to switch on the day it frees up. A student is never shown a price we
invented or an availability that is not real.

**Said once at the top, not as a warning on every row.** Twenty-three of
Vivienne's rows read "needs a lease length" in red, with nothing explaining why
and no way to answer them without opening twenty-three cards. The step now says
it once — what came in, how many are waitlist-only and what that means for them,
and that this site does not publish lease lengths — and offers the four presets
right there, applying to every floor plan at once. The per-row warning is kept
only when a single plan is the exception.

**The property-wide "when is it available?"** is gone from the Basics card for
an import like this. It used to hide only when every apartment carried a DATE,
so a building whose apartments are all available NOW still got asked, because
"now" is stored as a blank date. Blank is an answer on the units step — it shows
a green "Available now" beside every apartment — so it is an answer for this
question too. What still gets asked is the case the question was written for:
someone typing one place in by hand, with no apartment numbers and no date.

**Lease lengths.** Vivienne publishes its terms only inside the application, one
login deep (Ben found 1 to 13 months there), and there is no price against each
term. There is nothing on the public site to read, so the boxes are empty and
the import now SAYS so instead of leaving a blank that looks like a bug:

    This site doesn't publish its lease lengths, so choose them below.
    Everything else came from the site.

The landlord sets it once and "apply these terms to all N floor plans" does the
rest. That is the right division: we do not guess a lease length, and we do not
make them wonder why it is empty.

Both notices are written wherever the units came from — the floor-plan drill, a
live availability feed, or the model alone — because Vivienne reaches us by the
SightMap feed and the first version of this only fired on the drill.

## The feature passes its own acceptance test

    node apps/web/scripts/listing-import-acceptance.mjs --all

Seven shapes of website, 18 September, all seven green:

    mac-100          36 units, beds 0/1/2/3, 16 with apartments, 16 floor plans, 119s
    mac-dorchester   20 units, beds 0/1/2/3, 20 with apartments, 10 floor plans, 98s
    keeley-euclid     7 units, beds 1/2,      7 with apartments,  7 floor plans, 85s
    keeley-vivienne  34 units, beds 1/2/3,   23 with apartments, 11 waitlist-only, 181s
    single-building   5 units, beds 1/2,      5 with apartments,  5 floor plans, 74s
    portal-listing    1 unit — one listing, not a picker of competitors, 12s
    many-houses      14 properties offered, 14s

About 60 Firecrawl credits and $2 of Anthropic for the set. Re-run it after any
change to the importer; a case that fails names what it expected and what it
got.

One caution it earned the hard way: the portal case failed for two days because
the listing behind that URL had been taken down and apartments.com answers a
dead listing with a redirect to its city search page. Reading nothing off a
search page is the importer being right. Open a failing URL yourself before
treating it as a regression.

## Open

### G. Firecrawl: upgraded to 5,000 a month, 18 Sept to 18 Oct
The full audit costs about 60 credits, so a round of testing is no longer
something to ration. Check before a big session anyway:

    curl -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
      https://api.firecrawl.dev/v2/team/credit-usage

### H. Already-listed properties are marked in the picker
Ben: "should we have it so when someone does the URL upload they cant add the
exact same property thats already listed... for keely they already have the
echo, lofts at euclid, delmonte, and terra".

Property names are unique, so importing one of those was always going to be
refused — but only at the END, after the landlord had checked every floor plan
and waited for the photos, with a message naming the building rather than
explaining it. Ashley would have hit it four times.

The picker now says so up front: the row is greyed, shows "Already listed",
cannot be ticked, and is left out of "select all". Shown rather than hidden, so
a landlord can see we know about it instead of wondering where their building
went.

Matched on name OR address, because the two rarely agree. Verified against the
real listings: Keeley's site says "Echo STL" and the listing is called "Echo
Apartments" — caught on the address, which name matching alone would have
missed. All four of Ben's are found, and Marlowe, Vivienne and The Koken stay
addable.

The address test is deliberately conservative: street number, postcode, and the
street's name with its Avenue or Boulevard stripped, so "625 N. Euclid Ave" and
"625 North Euclid Avenue, St. Louis, Missouri 63108, United States" agree. A
false match would grey out a building the landlord is entitled to add, which is
worse than missing one and letting the write refuse it.

### F2. Jina: the key is fine, the ACCOUNT is empty, and the free tier still works
Not broken, not misconfigured. The key authenticates and every call returns

    402 InsufficientBalanceError: "Account balance not enough to run this
    query, please recharge." (uid 98a53313-22a4-4815-bb42-61015df1f8af)

Tested rather than assumed:

- With no key at all, r.jina.ai answers 200 and is not a toy: asked for
  loftsateuclid.com/floorplans it returns 11 KB of markdown naming every floor
  plan. So the free tier is real.
- But BROWSER RENDERING is the paid part. A key-less call asking for
  "X-Engine: browser" returns 401. That is what a key buys, and the pages we
  fall back on are usually the ones that need JS.

So the reader now tries each key it is given, drops one that says it is empty,
moves to the next, and if none are left asks anyway without one. **Set
`JINA_READER_KEY_2` to a second account's key and it is used when the first runs
dry** — which answers "could I make another account on another email". It also
says once in the log why a key was dropped, instead of paying a round trip per
page to a service that cannot answer.

### E. BLOCKED: the Anthropic API balance ran out
    [listing-draft] error: 400 "Your credit balance is too low to access the
    Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."

Every import calls the model once or twice, and a building the size of One
Hundred Above the Park costs about $0.30 to $0.42 per import in Anthropic usage.
The reading itself still worked in that run — 36 plans found, 16 read, lease
terms parsed — and it failed at the model call, which is why it returned
"Something went wrong reading that website" after 18 seconds.

- [x] Resolved. The account was empty at 18:00 on 17 September and working
      again by 23:00. Worth remembering that a run which dies here returns the
      same "something went wrong" a parsing bug does, so read the server log
      before chasing it as a bug.
- [x] 100N307F reads 3 bedrooms. The whole building reports beds 0/1/2/3 with
      nothing above, which the acceptance test now asserts.

### F. Keeley Properties: fixed, one thing left to confirm
Ben: "it didnt pull anything fron the property level... theres a url to the
webiste it should take you to that website the same way that it worked for mac".

Right diagnosis. Mac gives each building its own domain and links straight to
it, so picking a building already landed us on the building's site. Keeley links
to its own summary page first, and the drill only looked for a floor-plans link
on the SAME site, found none, and gave the landlord a property with nothing
under it. Every property in their portfolio is built this way.

The importer now follows the property's own website when the company's page is
only about it. The host has to echo the property's name, which is what keeps it
safe: those pages also link to sibling businesses, the web designer and a
resident portal. Verified against all seven Keeley properties and the index
page, which correctly follows nothing.

Lofts at Euclid now imports 7 floor plans with the right beds, 12 photos, 7
floor plan diagrams and both rent specials, in 86 seconds.

- [ ] Lease terms are empty for it: that site publishes no application page, so
      there is no range to read. The landlord sets them. Worth a second look at
      whether the terms live somewhere else on RentCafe sites like this one.

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

- [x] 16 of 16 on One Hundred Above the Park, 10 of 10 on Dorchester, 7 of 7 on
      Lofts at Euclid, 5 of 5 on Metro Flats.

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

- [x] Confirmed: One Hundred Above the Park imports as beds 0/1/2/3 with no
      blanks and nothing above 3 bedrooms.

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

- [x] **Floor-plan pages read the plan's own line, not the page's filter.**
      Lofts at Euclid puts "Bedrooms  Bedroom options  Studio  1 Bedroom  2
      Bedrooms" on every plan page, above the plan's own line, so reading the
      first bed-ish words on the page described the filter: all seven plans
      imported as studios. Preferring the first number would have made all seven
      one-beds, which is just as wrong. The plan names itself first ("Lindell II
      2 Bedrooms | 2 Bathrooms"), so that is what is read now. Square footage had
      the same shape of bug: written "Sq. Ft.: 1,211" it was taking the
      apartment number from "Apartment: #309" beside it, so a 1,211 sq ft
      two-bedroom imported as 309 sq ft.
- [x] **Floor plans matched by name, not by size.** Matching on either name or
      square footage let a unit claim a plan of a similar size, leaving the plan
      that really belonged to it taken: 100N307F published as a FOUR-bedroom
      although its page says "3 Bedrooms | 2 Bathrooms", because another unit
      had claimed its plan on size. Two plans of the same size are common; a
      floor plan code is exact, so the name wins.
- [x] **A name with nothing behind it is not a floor plan.** Eleven of Lofts at
      Euclid's eighteen units were names from a filter dropdown with no beds, no
      rent, no size and no apartments. Now dropped.
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

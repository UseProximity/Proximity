-- Record whether a rent is per person or for the whole unit, instead of guessing.
--
-- unit_leases.rent has always held both conventions with nothing to tell them
-- apart. A 4-bed at "$2,800" might be $2,800 for the apartment or $2,800 each,
-- and the difference decides whether it belongs in a $900 search. So
-- lib/listings/rentBasis.js infers it: divide by the bedroom count, and if a
-- bedroom would come out under $450 — less than any room near campus actually
-- goes for — the figure was already per person.
--
-- That heuristic is load-bearing. It sets the per-person price the matchmaking
-- ranker sorts on, the budget prose it quotes, and the /washu price pages. It
-- was validated against the live data and holds there, but it is still a guess
-- standing in for a fact the landlord knows.
--
-- NULL is deliberate and is not the same as false. Existing rows genuinely do
-- not record this, and defaulting them to "whole unit" would assert something
-- untrue of every per-person listing already on the site — the inference stays
-- in place for them. New offerings say which they mean, and over time the
-- heuristic applies to less and less.

ALTER TABLE unit_leases
  ADD COLUMN IF NOT EXISTS rent_is_per_person boolean;

COMMENT ON COLUMN unit_leases.rent_is_per_person IS
  'true = rent is per person, false = whole unit, NULL = not recorded (fall back to the rentBasis heuristic).';

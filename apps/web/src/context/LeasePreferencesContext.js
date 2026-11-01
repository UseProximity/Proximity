/*
 * The student's bed count, move-in month and lease length, shared by every
 * listing's lease options and the profile form. Picked once, they narrow every
 * listing.
 *
 * Signed in, the values live on the account (users.preferred_beds /
 * preferred_move_in_date / preferred_lease_months): read once per sign-in from
 * /api/account/lease-preferences, written through PATCH /api/editProfile.
 * Signed out, they live in this browser's localStorage so the pickers still
 * work. On sign-in, values picked while signed out are moved onto the account
 * once, but only when the account has none: the account always wins.
 *
 * Consumed via useLeasePreferences(): { prefs, loaded, signedIn, saveState,
 * setPrefs, clear, hydrate }. prefs is { beds: number | null (0 is a studio),
 * moveIn: "YYYY-MM-01" | null, months: number | null }.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { normalizeBeds, normalizeMoveIn, normalizeMonths } from "@/lib/listings/leaseFit";
import { trackEvent } from "@/utils/analytics";

const STORAGE_KEY = "prx_lease_prefs";
const EMPTY = { beds: null, moveIn: null, months: null };
const SAVE_DELAY_MS = 500;

const clean = (p) => ({ beds: normalizeBeds(p?.beds), moveIn: normalizeMoveIn(p?.moveIn), months: normalizeMonths(p?.months) });
const isEmpty = (p) => p.beds == null && !p.moveIn && !p.months;

function readLocal() {
  try {
    return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return EMPTY;
  }
}

function writeLocal(p) {
  try {
    if (isEmpty(p)) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {}
}

async function saveToAccount(p) {
  const res = await fetch("/api/editProfile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferredBeds: p.beds, preferredMoveInDate: p.moveIn, preferredLeaseMonths: p.months }),
  });
  if (!res.ok) throw new Error("save failed");
}

const LeasePreferencesContext = createContext({
  prefs: EMPTY,
  loaded: false,
  signedIn: false,
  saveState: "idle",
  setPrefs: () => {},
  clear: () => {},
  hydrate: () => {},
});

export function LeasePreferencesProvider({ children }) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id ?? null;
  const [prefs, setState] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  // "idle" | "saving" | "saved" | "error": lets the pickers say it stuck.
  const [saveState, setSaveState] = useState("idle");
  const timer = useRef(null);

  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    setLoaded(false);

    if (!userId) {
      setState(readLocal());
      setLoaded(true);
      return;
    }

    fetch("/api/account/lease-preferences")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then(async (data) => {
        if (cancelled) return;
        const account = clean(data);
        const local = readLocal();
        if (isEmpty(account) && !isEmpty(local)) {
          // Picked while signed out: carry it onto the account once.
          setState(local);
          try {
            await saveToAccount(local);
            writeLocal(EMPTY);
          } catch {}
        } else {
          setState(account);
          // The account is the record now; a leftover local copy would show
          // this student's dates to whoever uses the browser after them.
          writeLocal(EMPTY);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, status]);

  const persist = useCallback(
    (next) => {
      if (!userId) {
        writeLocal(next);
        return;
      }
      clearTimeout(timer.current);
      setSaveState("saving");
      timer.current = setTimeout(() => {
        saveToAccount(next)
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error"));
      }, SAVE_DELAY_MS);
    },
    [userId]
  );

  // The latest prefs, so setPrefs can compute the next value outside a state
  // updater (React runs updaters twice in development, which would double-save).
  const current = useRef(EMPTY);
  useEffect(() => {
    current.current = prefs;
  }, [prefs]);

  const setPrefs = useCallback(
    (patch) => {
      const next = clean({ ...current.current, ...patch });
      current.current = next;
      setState(next);
      persist(next);
      trackEvent(isEmpty(next) ? "Lease Preferences Cleared" : "Lease Preferences Set", {
        beds: next.beds ?? "",
        moveIn: next.moveIn ?? "",
        months: next.months ?? "",
        signedIn: !!userId,
      });
    },
    [persist, userId]
  );

  const clear = useCallback(() => setPrefs(EMPTY), [setPrefs]);

  // Take values that were just saved elsewhere (the profile form) without
  // writing them again.
  const hydrate = useCallback((p) => setState(clean(p)), []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <LeasePreferencesContext.Provider
      value={{ prefs, loaded, signedIn: !!userId, saveState, setPrefs, clear, hydrate }}
    >
      {children}
    </LeasePreferencesContext.Provider>
  );
}

export const useLeasePreferences = () => useContext(LeasePreferencesContext);

/*
 * Which two listings the student is currently comparing.
 *
 * The /compare URL is the truth while the page is open; this context mirrors
 * it into sessionStorage so a Compare pill on Browse or a listing page knows
 * whether a slot is free, and can send the student straight back to the same
 * comparison. Session-scoped on purpose: a comparison is a single afternoon's
 * shortlist, not something to greet a returning student with a week later.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const KEY = "prx_compare_ids";
const CompareContext = createContext({ ids: [], setIds: () => {} });

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 2) : [];
  } catch {
    return [];
  }
}

export function CompareProvider({ children }) {
  const [ids, setIdsState] = useState([]);

  useEffect(() => {
    setIdsState(read());
  }, []);

  const setIds = useCallback((next) => {
    const clean = (next ?? []).filter(Boolean).slice(0, 2);
    setIdsState(clean);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(clean));
    } catch {}
  }, []);

  return <CompareContext.Provider value={{ ids, setIds }}>{children}</CompareContext.Provider>;
}

export const useCompare = () => useContext(CompareContext);

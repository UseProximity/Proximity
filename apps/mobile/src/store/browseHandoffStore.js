// Find Your Place's "Browse All Matches" hand-off to the Browse tab: the filters
// the search worked out (applied) and the nice-to-haves it only suggests (marked
// in the filter sheet, switched off). Browse takes it once and clears it.
import { create } from "zustand";

export const useBrowseHandoffStore = create((set, get) => ({
  // { filters, suggested } or null.
  pending: null,
  send: (handoff) => set({ pending: handoff }),
  take: () => {
    const { pending } = get();
    if (pending) set({ pending: null });
    return pending;
  },
}));

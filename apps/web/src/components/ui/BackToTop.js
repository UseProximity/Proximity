"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/*
 * A floating "back to top" for long pages: the dashboard editor and the
 * import workspace, where a building with forty photos and thirty units runs
 * to several screens. Appears once the top is well out of view.
 */
export default function BackToTop({ after = 700 }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > after);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [after]);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-20 right-5 z-40 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 shadow-lg transition hover:border-red-300 hover:text-red-600 md:bottom-6"
    >
      <ArrowUp className="h-4 w-4" /> Top
    </button>
  );
}

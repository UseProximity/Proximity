"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/*
 * A floating "back to top" for long pages: the dashboard editor and the
 * import workspace, where a building with forty photos and thirty units runs
 * to several screens. Appears once the top is well out of view. Pages that
 * scroll inside a container (browse) pass it as scrollRef; the default is the
 * window.
 */
export default function BackToTop({
  after = 700,
  scrollRef,
  position = "bottom-20 right-5 md:bottom-6",
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = scrollRef?.current ?? window;
    const onScroll = () => setShow((scrollRef ? el.scrollTop : el.scrollY) > after);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [after, scrollRef]);
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={() => (scrollRef?.current ?? window).scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className={`fixed ${position} z-40 flex h-11 w-11 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition hover:bg-red-700`}
    >
      <ArrowUp size={18} strokeWidth={2} />
    </button>
  );
}

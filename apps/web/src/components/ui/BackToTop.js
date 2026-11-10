"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/*
 * A floating "back to top" for long pages: the dashboard editor and the
 * import workspace, where a building with forty photos and thirty units runs
 * to several screens. Appears once the top is well out of view. Pages that
 * scroll inside a container (browse) pass it as scrollRef; the default is the
 * window. It stays mounted and fades in and out rather than popping in.
 * tone="light" is the white button with a dark arrow (browse).
 */
export default function BackToTop({
  after = 700,
  scrollRef,
  position = "bottom-20 right-5 md:bottom-6",
  tone = "red",
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = scrollRef?.current ?? window;
    const onScroll = () => setShow((scrollRef ? el.scrollTop : el.scrollY) > after);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [after, scrollRef]);
  const toneClass =
    tone === "light"
      ? "border border-gray-200 bg-white text-gray-700 shadow-[0_2px_8px_rgba(0,0,0,0.12)] hover:bg-gray-100 hover:text-gray-900"
      : "bg-red-600 text-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] hover:bg-red-700";
  return (
    <button
      type="button"
      onClick={() => (scrollRef?.current ?? window).scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      className={`fixed ${position} z-40 flex h-11 w-11 items-center justify-center rounded-full transition-[opacity,right,background-color,color] duration-300 motion-reduce:duration-[1ms] ${toneClass} ${
        show ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <ArrowUp size={18} strokeWidth={2} />
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <button
      onClick={scrollToTop}
      aria-label="Back to top"
      className={[
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 px-4 h-11",
        "rounded-full bg-gray-950 text-white text-sm font-semibold shadow-lg",
        "transition-all duration-300",
        "hover:bg-rose-600 hover:scale-110 hover:opacity-100",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500",
        visible
          ? "opacity-80 translate-y-0"
          : "opacity-0 translate-y-4 pointer-events-none",
      ].join(" ")}
    >
      <ArrowUp size={16} />
      <span>Back to top</span>
    </button>
  );
}

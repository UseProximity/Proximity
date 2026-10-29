"use client";

/*
 * The test-environment banner's bar, with a Hide button on the right
 * (Wyatt, 2026-10-29). Hiding sets a cookie so the server stops rendering
 * the banner in this browser for 30 days; the bar disappears at once.
 */
import { useState } from "react";
import { X } from "lucide-react";

// Read by StagingBanner on the server.
const HIDE_COOKIE = "hide_env_banner";

export default function StagingBannerBar({ className, children }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const hide = () => {
    document.cookie = `${HIDE_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    setHidden(true);
  };
  return (
    <div className={`${className} relative`}>
      <span className="block pr-14">{children}</span>
      <button
        type="button"
        onClick={hide}
        aria-label="Hide this banner"
        className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold opacity-80 hover:opacity-100 hover:bg-black/10"
      >
        Hide <X className="h-3 w-3" />
      </button>
    </div>
  );
}

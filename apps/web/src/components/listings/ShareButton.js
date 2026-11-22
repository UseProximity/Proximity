"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "@/utils/copyText";
import { trackEvent } from "@/utils/analytics";
import { buildShareUrl, shareTargets } from "@/utils/shareLink";

const OPTION =
  "flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50";

const ICONS = {
  copy: "M8 7V5a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2h-2M5 7h9a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z",
  email: "M3 8l9 6 9-6M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z",
  sms: "M8 10h8M8 14h5m-9 6l2.5-3H19a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14z",
  whatsapp: "M3 21l1.65-4.9A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.1-1.05L3 21z",
  more: "M12 5v10m0-10l-3.5 3.5M12 5l3.5 3.5M5 14v4a2 2 0 002 2h10a2 2 0 002-2v-4",
};

function Icon({ d }) {
  return (
    <svg className="h-5 w-5 flex-shrink-0 text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function SharePanel({ link, title, onClose }) {
  const [copied, setCopied] = useState("idle"); // "idle" | "copied" | "failed"
  const targets = shareTargets(link, title);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sent = (method) => trackEvent("listing_share", { method });

  const handleCopy = async () => {
    const ok = await copyText(link);
    setCopied(ok ? "copied" : "failed");
    if (ok) sent("copy");
  };

  const handleNative = async () => {
    try {
      await navigator.share({ title: title || "Proximity listing", url: link });
      sent("native");
      onClose();
    } catch {
      // Dismissed by the user: nothing to report.
    }
  };

  // Portalled to <body> so no photo or panel clips it. Clicks stop here
  // because React sends them up the tree to whatever renders the button.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Share this listing"
        className="relative w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-gray-400 transition hover:text-gray-600">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="mb-1 pr-8 text-lg font-bold text-gray-900">Share this listing</h2>
        {title && <p className="mb-4 truncate text-sm text-gray-500">{title}</p>}
        <div className="flex flex-col gap-2">
          <button onClick={handleCopy} className={OPTION}>
            <Icon d={ICONS.copy} />
            {copied === "copied" ? "Link copied" : copied === "failed" ? "Copy failed, select the link below" : "Copy link"}
          </button>
          {copied === "failed" && (
            <input readOnly value={link} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700" />
          )}
          <a href={targets.email} onClick={() => sent("email")} className={OPTION}>
            <Icon d={ICONS.email} />
            Email
          </a>
          <a href={targets.sms} onClick={() => sent("sms")} className={OPTION}>
            <Icon d={ICONS.sms} />
            Text message
          </a>
          <a href={targets.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => sent("whatsapp")} className={OPTION}>
            <Icon d={ICONS.whatsapp} />
            WhatsApp
          </a>
          {canNativeShare && (
            <button onClick={handleNative} className={OPTION}>
              <Icon d={ICONS.more} />
              More options
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ShareButton({ title }) {
  const [link, setLink] = useState(null);

  // The link is read when the panel opens, so it carries whatever the page's
  // address is then (a ?listing= modal, a selected ?unit=, a /listings/ page).
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setLink(buildShareUrl(window.location.href));
  };

  return (
    <>
      <button
        onClick={open}
        className="block rounded-full bg-black/30 p-[5px] text-white transition-colors focus:outline-none"
        aria-label="Share this listing"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="block h-5 w-5 -translate-y-px" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0-12L8 7m4-4l4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1" />
        </svg>
      </button>
      {link && <SharePanel link={link} title={title} onClose={() => setLink(null)} />}
    </>
  );
}

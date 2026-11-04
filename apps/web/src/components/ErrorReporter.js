"use client";

/*
 * Mounted once in the root layout: any script error or failed promise nobody
 * handled, anywhere on the site, is sent to the site error alerts (Wyatt,
 * 2026-11-03). Renders nothing.
 */
import { useEffect } from "react";
import { reportBrowserError } from "@/lib/errors/client";

export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e) => reportBrowserError(e.error ?? e.message, "uncaught");
    const onRejection = (e) => reportBrowserError(e.reason, "unhandled promise");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

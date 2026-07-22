/*
 * Card primitives. Classes are merged with tailwind-merge so a caller's
 * className genuinely overrides the defaults — plain string concatenation let
 * conflicting utilities (e.g. the default `pt-0` vs a caller's `p-4`) resolve
 * by stylesheet order instead of intent, which silently produced cards with no
 * top padding whenever CardContent was used without a CardHeader above it.
 *
 * Defaults are unchanged, so existing CardHeader + CardContent pairs render
 * exactly as before; only call sites that explicitly pass padding differ.
 */
import { twMerge } from "tailwind-merge";

export const Card = ({ children, className = "", onClick }) => (
  <div
    className={twMerge("bg-white rounded-lg border border-gray-200 shadow-sm", className)}
    onClick={onClick}
  >
    {children}
  </div>
);

export const CardHeader = ({ children, className = "" }) => (
  <div className={twMerge("p-6 pb-2", className)}>{children}</div>
);

// `pt-0` assumes a CardHeader sits above. Standalone cards should pass their
// own padding (e.g. `p-5`), which now actually wins.
export const CardContent = ({ children, className = "" }) => (
  <div className={twMerge("p-6 pt-0", className)}>{children}</div>
);

export const CardTitle = ({ children, className = "" }) => (
  <h3
    className={twMerge("text-lg font-semibold leading-none tracking-tight", className)}
  >
    {children}
  </h3>
);

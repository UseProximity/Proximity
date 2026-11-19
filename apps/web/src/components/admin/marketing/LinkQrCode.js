"use client";

/*
 * QR code of a campaign link's short URL, with PNG (screens) and SVG (print)
 * downloads. Generated in the browser with the qrcode library, so nothing
 * leaves the page. Error correction "M" survives a cheap print.
 */
import { useEffect, useState } from "react";
import QRCode from "qrcode";

const OPTIONS = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } };

export default function LinkQrCode({ url, slug }) {
  const [svg, setSvg] = useState(null);
  const [png, setPng] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all([QRCode.toString(url, { ...OPTIONS, type: "svg" }), QRCode.toDataURL(url, { ...OPTIONS, width: 1024 })])
      .then(([s, p]) => {
        if (cancelled) return;
        setSvg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`);
        setPng(p);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => { cancelled = true; };
  }, [url]);

  if (failed) return <p className="text-xs text-red-600">Could not draw the QR code.</p>;
  if (!svg) return <div className="h-40 w-40 animate-pulse rounded-lg bg-gray-100" />;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svg} alt={`QR code for ${url}`} className="h-40 w-40 rounded-lg border border-gray-200 bg-white" />
      <div className="flex gap-2">
        <a href={png} download={`qr-${slug}.png`} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Download PNG
        </a>
        <a href={svg} download={`qr-${slug}.svg`} className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Download SVG
        </a>
      </div>
    </div>
  );
}

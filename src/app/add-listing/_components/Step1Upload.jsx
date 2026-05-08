"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import toast from "react-hot-toast";

const MAX_BATCH = 4 * 1024 * 1024;

const PHASES = {
  idle: null,
  creating: "Creating listing draft…",
  uploading_pdf: "Uploading lease PDF…",
  extracting_pdf: "Analysing lease with AI… (this takes ~30s)",
  uploading_images: "Uploading photos…",
  extracting_images: "Detecting amenities from photos…",
  scraping_url: "Reading listing page…",
  done: "Done!",
};

export default function Step1Upload({ state, dispatch, onNext }) {
  // Address
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSugg, setShowSugg] = useState(false);
  const timerRef = useRef(null);
  const suggRef = useRef(null);

  // Files
  const [pdfFile, setPdfFile] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [listingUrl, setListingUrl] = useState("");

  // Status
  const [phase, setPhase] = useState("idle");
  const [errors, setErrors] = useState([]);

  const pdfRef = useRef(null);
  const imgRef = useRef(null);
  const [pdfDrag, setPdfDrag] = useState(false);
  const [imgDrag, setImgDrag] = useState(false);

  // ── Address autocomplete ──────────────────────────────────
  const searchAddress = useCallback(async (q) => {
    if (q.length < 3) { setSuggestions([]); return; }
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&types=address&limit=5&proximity=-90.3053,38.6489`
    );
    const data = await res.json();
    setSuggestions(data.features || []);
    setShowSugg(true);
  }, []);

  const onAddressChange = (e) => {
    const v = e.target.value;
    setAddress(v);
    setCoords(null);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => searchAddress(v), 300);
  };

  const selectSuggestion = (s) => {
    const [lng, lat] = s.geometry.coordinates;
    setAddress(s.place_name);
    setCoords({ longitude: lng, latitude: lat });
    setSuggestions([]);
    setShowSugg(false);
  };

  useEffect(() => {
    const h = (e) => { if (suggRef.current && !suggRef.current.contains(e.target)) setShowSugg(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── File handlers ─────────────────────────────────────────
  const handlePdf = (f) => {
    if (!f) return;
    if (!f.type?.includes("pdf")) { toast.error("Please upload a PDF"); return; }
    if (f.size > 20 * 1024 * 1024) { toast.error("PDF must be under 20 MB"); return; }
    setPdfFile(f);
  };

  const handleImages = (incoming) => {
    const imgs = Array.from(incoming).filter((f) => f.type?.startsWith("image/"));
    if (!imgs.length) return;
    setImageFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const merged = [...prev, ...imgs.filter((f) => !seen.has(`${f.name}-${f.size}`))];
      setImagePreviews(merged.map((f) => URL.createObjectURL(f)));
      return merged;
    });
  };

  // ── Main analysis flow ────────────────────────────────────
  const analyse = async () => {
    if (!address.trim() || !coords) {
      toast.error("Please select an address from the dropdown"); return;
    }
    if (!pdfFile && imageFiles.length === 0 && !listingUrl.trim()) {
      toast.error("Upload a lease PDF, photos, or paste a listing URL"); return;
    }

    const errs = [];
    let listingId = state.listingId;
    let templateId = state.templateId;

    try {
      // 1. Create draft if needed
      if (!listingId) {
        setPhase("creating");
        const res = await fetch("/api/landlord/listings/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address,
            ...coords,
            description: "Description coming soon.",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create listing");
        listingId = data.listingId;
        dispatch({ type: "SET_LISTING", listingId, listing: null });
      }

      // 2. Upload + extract PDF
      if (pdfFile) {
        setPhase("uploading_pdf");
        const fd = new FormData();
        fd.append("file", pdfFile);
        const uploadRes = await fetch("/api/landlord/pdf-upload", { method: "POST", body: fd });
        const { url, error: uErr } = await uploadRes.json();
        if (!uploadRes.ok) { errs.push(`PDF upload: ${uErr}`); }
        else {
          const tRes = await fetch("/api/landlord/lease-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              display_name: pdfFile.name.replace(/\.pdf$/i, ""),
              template_pdf_url: url,
              listing_id: listingId,
            }),
          });
          const tData = await tRes.json();
          if (!tRes.ok) { errs.push(`Template save: ${tData.error}`); }
          else {
            templateId = tData.id;
            dispatch({ type: "SET_TEMPLATE", templateId });
            setPhase("extracting_pdf");
            const exRes = await fetch(`/api/landlord/lease-templates/${tData.id}/extract`, { method: "POST" });
            const exData = await exRes.json();
            if (!exRes.ok) errs.push(`PDF extraction: ${exData.error || "failed"}`);
          }
        }
      }

      // 3. Upload + extract images
      if (imageFiles.length > 0) {
        setPhase("uploading_images");
        const batches = [];
        let batch = [], bytes = 0;
        for (const f of imageFiles) {
          if (bytes + f.size > MAX_BATCH && batch.length) { batches.push(batch); batch = []; bytes = 0; }
          batch.push(f); bytes += f.size;
        }
        if (batch.length) batches.push(batch);

        const allUrls = [];
        for (const b of batches) {
          const fd = new FormData();
          b.forEach((f) => fd.append("files", f));
          fd.append("listingId", listingId);
          const res = await fetch("/api/upload", { method: "PATCH", body: fd });
          const data = await res.json();
          if (!res.ok) { errs.push(`Image upload: ${data.error}`); }
          else allUrls.push(...(data.urls || []));
        }

        if (allUrls.length > 0) {
          setPhase("extracting_images");
          await fetch("/api/landlord/extract-from-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ listing_id: listingId, image_urls: allUrls }),
          });
        }
      }

      // 4. Scrape optional URL
      if (listingUrl.trim()) {
        setPhase("scraping_url");
        const res = await fetch("/api/landlord/scrape-listing-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listing_id: listingId, url: listingUrl.trim() }),
        });
        if (!res.ok) {
          const data = await res.json();
          if (data.code !== "BLOCKED") errs.push(`URL scrape: ${data.error}`);
        }
      }

      // 5. Fetch listing snapshot + field states
      const [listingRes, fsRes] = await Promise.all([
        fetch(`/api/listing/${listingId}`),
        fetch(`/api/landlord/listings/${listingId}/field-states`),
      ]);
      if (listingRes.ok) {
        const listing = await listingRes.json();
        dispatch({ type: "SET_LISTING_DATA", data: listing });
      }
      if (fsRes.ok) {
        const fs = await fsRes.json();
        const map = {};
        for (const row of fs) map[`${row.table_name}.${row.field_name}`] = row;
        dispatch({ type: "FIELD_STATES", fieldStates: map });
      }

      setPhase("done");
      if (errs.length) setErrors(errs);
      setTimeout(onNext, 600);

    } catch (err) {
      setPhase("idle");
      toast.error(err.message);
    }
  };

  const busy = phase !== "idle" && phase !== "done";
  const canAnalyse = !!coords && (!!pdfFile || imageFiles.length > 0 || listingUrl.trim());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Upload your files and let AI do the work</h2>
        <p className="text-sm text-gray-500">Drop in a lease PDF and/or listing photos. AI extracts rent, fees, amenities, pet policy — everything. You&apos;ll review and confirm in the next step.</p>
      </div>

      {/* Address */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 mb-1">Property address <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={address}
          onChange={onAddressChange}
          placeholder="Start typing the address…"
          autoComplete="off"
          disabled={busy}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50"
        />
        {coords && <p className="text-xs text-green-600 mt-1">✓ Location confirmed</p>}
        {showSugg && suggestions.length > 0 && (
          <ul ref={suggRef} className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => selectSuggestion(s)}
                  className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0">
                  <p className="font-medium text-gray-900">{s.text}</p>
                  <p className="text-xs text-gray-500">{s.place_name}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Drop zones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* PDF */}
        <div
          onClick={() => !busy && !pdfFile && pdfRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); setPdfDrag(false); if (!busy) handlePdf(e.dataTransfer.files[0]); }}
          onDragOver={(e) => { e.preventDefault(); setPdfDrag(true); }}
          onDragLeave={() => setPdfDrag(false)}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer
            ${pdfDrag ? "border-red-400 bg-red-50"
            : pdfFile ? "border-green-400 bg-green-50"
            : "border-gray-300 hover:border-red-300 hover:bg-gray-50"}
            ${busy ? "opacity-60 cursor-default" : ""}`}
        >
          <input ref={pdfRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => handlePdf(e.target.files[0])} />
          {pdfFile ? (
            <div>
              <div className="text-2xl mb-1">📄</div>
              <p className="text-sm font-medium text-green-700 truncate">{pdfFile.name}</p>
              <p className="text-xs text-green-600">{(pdfFile.size / 1024).toFixed(0)} KB</p>
              {!busy && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setPdfFile(null); }}
                  className="mt-1.5 text-xs text-gray-400 hover:text-red-500 underline">Remove</button>
              )}
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">📑</div>
              <p className="text-sm font-medium text-gray-700">Lease PDF</p>
              <p className="text-xs text-gray-400 mt-0.5">Drop or click to upload</p>
            </div>
          )}
        </div>

        {/* Images */}
        <div
          onClick={() => !busy && imgRef.current?.click()}
          onDrop={(e) => { e.preventDefault(); setImgDrag(false); if (!busy) handleImages(e.dataTransfer.files); }}
          onDragOver={(e) => { e.preventDefault(); setImgDrag(true); }}
          onDragLeave={() => setImgDrag(false)}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer
            ${imgDrag ? "border-red-400 bg-red-50"
            : imageFiles.length > 0 ? "border-green-400 bg-green-50"
            : "border-gray-300 hover:border-red-300 hover:bg-gray-50"}
            ${busy ? "opacity-60 cursor-default" : ""}`}
        >
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => handleImages(e.target.files)} />
          {imageFiles.length > 0 ? (
            <div>
              <div className="flex justify-center gap-1 mb-2 overflow-hidden max-h-14">
                {imagePreviews.slice(0, 4).map((src, i) => (
                  <img key={i} src={src} alt="" className="h-14 w-14 object-cover rounded-md border border-green-200" />
                ))}
              </div>
              <p className="text-sm font-medium text-green-700">{imageFiles.length} photo{imageFiles.length !== 1 ? "s" : ""}</p>
              {!busy && (
                <button type="button" onClick={(e) => { e.stopPropagation(); setImageFiles([]); setImagePreviews([]); }}
                  className="mt-1 text-xs text-gray-400 hover:text-red-500 underline">Clear all</button>
              )}
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">🖼️</div>
              <p className="text-sm font-medium text-gray-700">Listing photos</p>
              <p className="text-xs text-gray-400 mt-0.5">Drop or click — multiple OK</p>
            </div>
          )}
        </div>
      </div>

      {/* Optional URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Private listing URL <span className="text-xs text-gray-400 font-normal">(optional)</span></label>
        <input
          type="url"
          value={listingUrl}
          onChange={(e) => setListingUrl(e.target.value)}
          placeholder="https://yourwebsite.com/listing/…"
          disabled={busy}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-gray-50"
        />
        <p className="text-xs text-gray-400 mt-1">Paste a URL from your own site, Apartments.com, or Zillow to import additional details.</p>
      </div>

      {/* Status */}
      {phase !== "idle" && (
        <div className={`rounded-lg p-4 flex items-center gap-3 ${phase === "done" ? "bg-green-50 border border-green-200" : "bg-blue-50 border border-blue-200"}`}>
          {phase !== "done" && (
            <span className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin shrink-0" />
          )}
          {phase === "done" && <span className="text-green-600 text-lg">✓</span>}
          <p className="text-sm font-medium text-gray-800">{PHASES[phase]}</p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
          <p className="text-xs font-medium text-yellow-800 mb-1">Some steps had issues (you can still continue):</p>
          {errors.map((e, i) => <p key={i} className="text-xs text-yellow-700">• {e}</p>)}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={analyse}
          disabled={busy || !canAnalyse}
          className="px-8 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 transition text-sm flex items-center gap-2"
        >
          {busy ? (
            <>
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Working…
            </>
          ) : "Analyse with AI →"}
        </button>
      </div>
    </div>
  );
}

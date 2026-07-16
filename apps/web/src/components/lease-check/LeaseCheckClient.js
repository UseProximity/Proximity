"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FileText, X, Copy } from "lucide-react";
import toast from "react-hot-toast";
import { trackEvent } from "@/utils/analytics";
import FlagCard from "@/components/lease-check/FlagCard";
import PropertyContext from "@/components/lease-check/PropertyContext";
import LeaseDisclaimer from "@/components/lease-check/LeaseDisclaimer";
import PastChecks from "@/components/lease-check/PastChecks";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";
const ALLOWED_TYPES = new Set(ACCEPT.split(","));
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 25;
const SEVERITY_ORDER = { red: 0, yellow: 1, green: 2 };

/*
 * Canvas compression (same approach as ListingFormPanel): ~1600px long edge, JPEG
 * q0.72. HEIC is ALWAYS converted regardless of size — Safari can decode it in an
 * <img>, and the API can't take HEIC. PDFs pass through untouched.
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const mustConvert = file.type === "image/heic";
    if (!mustConvert && file.size < 1 * 1024 * 1024) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || (!mustConvert && blob.size >= file.size)) {
            resolve(file);
            return;
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" })
          );
        },
        "image/jpeg",
        0.72
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (mustConvert) reject(new Error(`${file.name}: we can't read HEIC here. Convert it to JPEG first.`));
      else resolve(file);
    };
    img.src = url;
  });
}

function formatPageList(pages) {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const p of sorted.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = p;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(", ");
}

const PHASE_LABELS = {
  uploading: "Uploading",
  reading: "Reading your lease",
  checking: "Checking Proximity",
  done: "Done",
};

export default function LeaseCheckClient() {
  const [files, setFiles] = useState([]);
  const [phase, setPhase] = useState("idle"); // idle | uploading | reading | checking | done
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState(null);
  const [pastChecks, setPastChecks] = useState([]);
  const [viewingPast, setViewingPast] = useState(null);
  const creepTimer = useRef(null);

  useEffect(() => {
    fetch("/api/lease-check")
      .then((res) => (res.ok ? res.json() : { checks: [] }))
      .then((data) => setPastChecks(data.checks || []))
      .catch(() => {});
    return () => clearInterval(creepTimer.current);
  }, []);

  const busy = phase === "uploading" || phase === "reading" || phase === "checking";

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    const rejected = incoming.filter((f) => !ALLOWED_TYPES.has(f.type));
    if (rejected.length > 0) toast.error("PDF or photos only.");
    const accepted = incoming.filter((f) => ALLOWED_TYPES.has(f.type));
    setFiles((prev) => {
      const next = [...prev, ...accepted].slice(0, MAX_FILES);
      if (prev.length + accepted.length > MAX_FILES) toast.error(`Max ${MAX_FILES} files.`);
      return next;
    });
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  // A slow, honestly-labeled creep while Claude reads (60-120s). Never fakes 100%.
  const startCreep = () => {
    clearInterval(creepTimer.current);
    creepTimer.current = setInterval(() => {
      setPct((current) => {
        const next = current + (90 - current) * 0.025;
        return next > 90 ? 90 : next;
      });
    }, 1000);
  };

  const fail = (reason, message) => {
    clearInterval(creepTimer.current);
    trackEvent("Lease Check Failed", { reason });
    toast.error(message);
    setPhase("idle");
    setPct(0);
  };

  const runCheck = async () => {
    if (files.length === 0 || busy) return;
    setResult(null);
    setViewingPast(null);
    setPhase("uploading");
    setPct(2);

    const hasPdf = files.some((f) => f.type === "application/pdf");
    const hasImage = files.some((f) => f.type !== "application/pdf");
    trackEvent("Lease Check Started", {
      fileCount: files.length,
      fileType: hasPdf && hasImage ? "mixed" : hasPdf ? "pdf" : "images",
    });
    const startedAt = Date.now();

    try {
      // 1. Compress images client-side (PDFs pass through).
      const prepared = [];
      for (const file of files) {
        prepared.push(file.type === "application/pdf" ? file : await compressImage(file));
      }
      const totalBytes = prepared.reduce((sum, f) => sum + f.size, 0);
      if (totalBytes > MAX_TOTAL_BYTES) {
        return fail("too_large", "That's over 32MB even after compressing. Trim it down.");
      }

      // 2. Get presigned upload URLs.
      const presignRes = await fetch("/api/lease-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: prepared.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) {
        return fail("presign", presignData.error || "Couldn't start the check.");
      }
      const { leaseCheckId, presigned } = presignData;

      // 3. Upload straight to R2 — Vercel is not in this path, so no body limit.
      for (let i = 0; i < prepared.length; i++) {
        const uploadRes = await fetch(presigned[i].uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": prepared[i].type },
          body: prepared[i],
        });
        if (!uploadRes.ok) return fail("upload", "Upload failed. Try again.");
        setPct(2 + ((i + 1) / prepared.length) * 28);
      }

      // 4. Analyze. This is the long wait — keep the bar honest but moving.
      setPhase("reading");
      startCreep();
      const analyzeRes = await fetch("/api/lease-check", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseCheckId, keys: presigned.map((p) => p.key) }),
      });
      const data = await analyzeRes.json();
      clearInterval(creepTimer.current);
      if (!analyzeRes.ok) {
        return fail(`analyze_${analyzeRes.status}`, data.error || "Something broke. Try again.");
      }

      setPhase("checking");
      setPct(96);
      const sortedFlags = [...data.flags].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
      );
      setResult({ ...data, flags: sortedFlags });
      setPhase("done");
      setPct(100);
      setFiles([]);
      trackEvent("Lease Check Completed", {
        flagCount: data.flags.length,
        redCount: data.flags.filter((f) => f.severity === "red").length,
        matchConfidence: data.property?.matchConfidence ?? "none",
        durationMs: Date.now() - startedAt,
      });
      fetch("/api/lease-check")
        .then((res) => (res.ok ? res.json() : { checks: [] }))
        .then((history) => setPastChecks(history.checks || []))
        .catch(() => {});
    } catch (err) {
      fail("client_error", err?.message || "Something broke. Try again.");
    }
  };

  const copyQuestions = () => {
    const questions = (result?.flags || []).map((f) => `- ${f.question}`).join("\n");
    navigator.clipboard
      .writeText(questions)
      .then(() => {
        toast.success("Copied. Go ask.");
        trackEvent("Lease Check Questions Copied", { questionCount: result.flags.length });
      })
      .catch(() => toast.error("Couldn't copy. Select and copy manually."));
  };

  const active = viewingPast
    ? {
        flags: [...(viewingPast.flags || [])].sort(
          (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
        ),
        summary: viewingPast.summary,
        unreadablePages: viewingPast.unreadablePages || [],
        isPast: true,
      }
    : result;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-red-500">
          Lease Check
        </p>
        <h1 className="mt-5 text-4xl font-black tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
          Don&apos;t sign a lease you haven&apos;t read.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600 sm:text-xl">
          Upload it. We&apos;ll flag what matters.
        </p>

        {/* Upload */}
        <div className="mt-10 max-w-3xl">
          <label
            className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-red-400 hover:bg-red-50 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy) addFiles(e.dataTransfer.files);
            }}
          >
            <input
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Upload className="h-6 w-6 text-gray-400 mb-1" />
            <span className="text-sm text-gray-500 font-medium">
              Drop your lease here or tap to browse
            </span>
            <span className="text-xs text-gray-400 mt-0.5">
              PDF or photos. Up to 32MB. We delete it the second we&apos;re done.
            </span>
          </label>

          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                >
                  <FileText size={16} className="shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-gray-400">
                    {(file.size / (1024 * 1024)).toFixed(1)}MB
                  </span>
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${file.name}`}
                      className="shrink-0 text-gray-400 hover:text-red-600 transition"
                    >
                      <X size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {busy ? (
            <div className="mt-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full bg-red-600 rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs font-medium text-gray-500">
                  {PHASE_LABELS[phase]}
                </span>
              </div>
              {phase === "reading" && (
                <p className="mt-2 text-xs text-gray-400">
                  Leases are long. This takes a minute or two. Worth it.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <button
                type="button"
                onClick={runCheck}
                disabled={files.length === 0}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors px-6 w-full sm:w-auto"
              >
                Check my lease
              </button>
              <LeaseDisclaimer variant="inline" />
            </div>
          )}
        </div>

        {/* Results: flags on the left, property context in a right rail on desktop */}
        {active && (
          <div className="mt-12 grid gap-6 lg:grid-cols-5">
            <div className="space-y-4 lg:col-span-3">
              {active.isPast && (
                <p className="text-xs text-gray-400">
                  A past check. Property info isn&apos;t stored, so only the flags are shown.{" "}
                  <button
                    type="button"
                    className="underline hover:text-red-600 transition"
                    onClick={() => setViewingPast(null)}
                  >
                    Back
                  </button>
                </p>
              )}

              <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm p-6">
                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-red-500">
                  The read
                </h2>
                <p className="mt-2 text-base leading-7 text-gray-700">{active.summary}</p>
              </div>

              {active.unreadablePages?.length > 0 && (
                <div className="rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
                  We couldn&apos;t read {active.unreadablePages.length === 1 ? "page" : "pages"}{" "}
                  {formatPageList(active.unreadablePages)}. Anything on{" "}
                  {active.unreadablePages.length === 1 ? "it" : "them"} isn&apos;t covered below.
                </div>
              )}

              {active.flags.length === 0 ? (
                <div className="rounded-[1.75rem] border border-dashed border-gray-300 bg-gray-50 p-10 text-center">
                  <p className="text-sm font-semibold text-gray-700">
                    Nothing jumped out. That&apos;s a good sign. But read it anyway.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {active.flags.map((flag, i) => (
                      <FlagCard key={i} flag={flag} />
                    ))}
                  </div>
                  {!active.isPast && (
                    <button
                      type="button"
                      onClick={copyQuestions}
                      className="inline-flex items-center justify-center rounded-2xl bg-gray-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-black gap-2"
                    >
                      <Copy size={16} />
                      Copy questions for your landlord
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4 lg:col-span-2">
              {!active.isPast && (
                <PropertyContext
                  leaseCheckId={active.leaseCheckId}
                  property={active.property}
                  rentBasis={active.rentBasis}
                  landlordName={active.landlordName}
                  onProperty={(property) => setResult((prev) => ({ ...prev, property }))}
                />
              )}
              <LeaseDisclaimer variant="footer" />
            </div>
          </div>
        )}

        <PastChecks
          checks={pastChecks}
          onSelect={(check) => {
            setViewingPast(check);
            setResult(null);
          }}
        />
      </section>
    </main>
  );
}

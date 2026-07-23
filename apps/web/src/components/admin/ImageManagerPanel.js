"use client";

import { useState } from "react";

// ─── Image Manager Panel ───────────────────────────────────────────────────────

export default function ImageManagerPanel({ listingId, initialImages, dbTarget, isProd, onClose, onSaved }) {
  const [images, setImages] = useState(Array.isArray(initialImages) ? initialImages : []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renamingUrl, setRenamingUrl] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [panelError, setPanelError] = useState(null);

  function getFilename(url) {
    try {
      const parts = url.split("/");
      const last = parts[parts.length - 1];
      const dashIdx = last.indexOf("-");
      return dashIdx !== -1 ? last.slice(dashIdx + 1) : last;
    } catch {
      return url;
    }
  }

  function moveUp(idx) {
    if (idx === 0) return;
    setImages((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }

  function moveDown(idx) {
    setImages((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }

  async function handleDelete(url) {
    if (!confirm("Delete this image? This cannot be undone.")) return;
    if (isProd && !confirm("PRODUCTION: This will permanently delete this image from the PRODUCTION database. Are you absolutely sure?")) return;
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, imageUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setImages(data.images);
    } catch (e) {
      setPanelError(e.message);
    }
  }

  function startRename(url) {
    setRenamingUrl(url);
    setRenameValue(getFilename(url));
  }

  async function confirmRename() {
    if (!renameValue.trim() || !renamingUrl) return;
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, oldUrl: renamingUrl, newFilename: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rename failed");
      setImages((prev) => prev.map((u) => (u === renamingUrl ? data.newUrl : u)));
      setRenamingUrl(null);
    } catch (e) {
      setPanelError(e.message);
    }
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return;
    if (!confirm(`Upload ${files.length} photo(s)?`)) return;
    setUploading(true);
    setPanelError(null);
    try {
      // Step 1: get presigned PUT URLs from the server
      const presignRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          files: files.map((f) => ({ name: f.name, type: f.type })),
        }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || `Presign failed (HTTP ${presignRes.status})`);

      // Step 2: upload each file directly to R2 (bypasses Vercel size limit)
      await Promise.all(
        presignData.presigned.map(({ uploadUrl }, i) =>
          fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": files[i].type },
            body: files[i],
          }).then((r) => {
            if (!r.ok) throw new Error(`R2 upload failed for "${files[i].name}" (HTTP ${r.status})`);
          })
        )
      );

      // Step 3: tell the server which URLs were successfully uploaded
      const publicUrls = presignData.presigned.map((p) => p.publicUrl);
      const confirmRes = await fetch("/api/upload", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, urls: publicUrls }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || `Failed to save images (HTTP ${confirmRes.status})`);

      setImages((prev) => [...prev, ...publicUrls]);
    } catch (e) {
      setPanelError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (isProd && !confirm("PRODUCTION: Saving image changes to the PRODUCTION database. Proceed?")) return;
    setSaving(true);
    setPanelError(null);
    try {
      const res = await fetch("/api/admin/listing-images", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-db-target": dbTarget },
        body: JSON.stringify({ listingId, images }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data.images);
    } catch (e) {
      setPanelError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Manage Photos</h2>
            <p className="text-xs text-gray-500 mt-0.5">{images.length} image{images.length !== 1 ? "s" : ""} · {listingId}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-200 text-gray-500">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {panelError && (
          <div className="mx-5 mt-3 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
            {panelError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {images.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-10">No images yet</p>
          )}
          {images.map((url, idx) => (
            <div key={url + idx} className="flex items-center gap-3 p-2 border border-gray-200 rounded-lg bg-white hover:bg-gray-50">
              <img
                src={`/_next/image?url=${encodeURIComponent(url)}&w=128&q=15`}
                alt={`img-${idx}`}
                className="w-16 h-12 object-cover rounded border border-gray-200 flex-shrink-0"
                onError={(e) => { e.target.style.display = "none"; }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-700 mb-0.5">#{idx + 1}</p>
                {renamingUrl === url ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setRenamingUrl(null); }}
                      autoFocus
                      className="flex-1 border border-blue-400 rounded px-2 py-0.5 text-xs focus:outline-none"
                    />
                    <button onClick={confirmRename} className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
                    <button onClick={() => setRenamingUrl(null)} className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 truncate">{getFilename(url)}</p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => moveUp(idx)} disabled={idx === 0} title="Move up" className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd"/></svg>
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx === images.length - 1} title="Move down" className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                </button>
                <button onClick={() => startRename(url)} title="Rename" className="p-1 rounded hover:bg-gray-200 text-gray-500">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
                </button>
                <button onClick={() => handleDelete(url)} title="Delete" className="p-1 rounded hover:bg-red-100 text-red-500">
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-gray-200">
          <label className={`flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed rounded-lg cursor-pointer text-sm transition-colors ${uploading ? "border-gray-200 text-gray-400 cursor-not-allowed" : "border-blue-300 text-blue-600 hover:bg-blue-50"}`}>
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                Uploading…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                Add Photos
              </>
            )}
            <input type="file" accept="image/*" multiple disabled={uploading} className="hidden" onChange={(e) => handleUpload(Array.from(e.target.files || []))} />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

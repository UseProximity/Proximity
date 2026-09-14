// Shared presigned-upload flow: ask the server for presigned PUT URLs, send
// the files straight to R2 from the browser, then confirm the URLs with the
// server. This is the same three-request flow already used by AddListingWizard
// and ImageManagerPanel, pulled out so a new caller doesn't have to reimplement
// it (and, more importantly, doesn't bypass Vercel's serverless body limit the
// way a direct multipart upload does).
//
// `attach: false` mirrors the old multipart flow's flag: the file is stored,
// but not filed into the listing's photo gallery, because the caller is
// putting it somewhere else (a floor plan on the unit record).
export async function uploadImagesToR2({ listingId, unitId = null, files, attach = true }) {
  const presignRes = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      listingId,
      unitId,
      files: files.map((f) => ({ name: f.name, type: f.type })),
    }),
  });
  const presignData = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok) {
    throw new Error(presignData.error || `Presign failed (HTTP ${presignRes.status})`);
  }
  const { presigned } = presignData;

  const uploadResults = await Promise.allSettled(
    presigned.map(({ uploadUrl }, i) =>
      fetch(uploadUrl, {
        method: "PUT",
        body: files[i],
        headers: { "Content-Type": files[i].type },
      })
    )
  );
  const failed = uploadResults.filter((r) => r.status === "rejected" || !r.value?.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} image(s) failed to upload. Please try again.`);
  }

  const urls = presigned.map((p) => p.publicUrl);
  const confirmRes = await fetch("/api/upload", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listingId, unitId, urls, attach }),
  });
  const confirmData = await confirmRes.json().catch(() => ({}));
  if (!confirmRes.ok) {
    throw new Error(confirmData.error || `Failed to save images (HTTP ${confirmRes.status})`);
  }

  return { urls };
}

// Wraps the two-step presigned-upload flow behind POST /api/upload (presign)
// and PUT /api/upload (confirm), matching web's AddListingWizard.js/
// StepPhotos.js upload flow: create the listing first, presign, PUT bytes
// directly to R2, then confirm. Both require a bearer token and listing
// ownership (or a super role) per apps/web/src/app/api/upload/route.js's
// getRequestUser check.
export class UploadsResource {
  constructor(client) {
    this.client = client;
  }

  // files: [{ name, type }] — returns { presigned: [{ uploadUrl, publicUrl, key }] }
  presignUpload(listingId, files) {
    return this.client.request("/api/upload", {
      method: "POST",
      body: JSON.stringify({ listingId, files }),
    });
  }

  // Direct-to-R2 PUT of the actual file bytes. Deliberately bypasses
  // ApiClient.request(), which always attaches Bearer auth and assumes a
  // JSON request/response — this call needs neither (R2 doesn't check our
  // auth) and must send the file's real MIME type as Content-Type.
  async uploadToPresignedUrl(uploadUrl, blob, contentType) {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
    if (!res.ok) {
      const err = new Error(`Upload to storage failed with status ${res.status}`);
      err.status = res.status;
      throw err;
    }
  }

  // urls: [string] — confirms uploaded files and records them on the listing.
  confirmUpload(listingId, urls) {
    return this.client.request("/api/upload", {
      method: "PUT",
      body: JSON.stringify({ listingId, urls }),
    });
  }
}

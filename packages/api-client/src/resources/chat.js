// Wraps the in-app messaging routes under apps/web/src/app/api/chat/*. Request
// and response shapes follow the web client (apps/web/src/context/MessagesContext.js)
// and the routes themselves, which accept a mobile Bearer token via getRequestUser.
//
// Errors are thrown by ApiClient.request() with `.status` and `.body`, so callers
// can branch on `err.body.code === "PASSWORD_REQUIRED"` (403), 422 (message or
// attachment refused by moderation) and 429 (rate limit).
export class ChatResource {
  constructor(client) {
    this.client = client;
  }

  // Inbox for the signed-in user. Returns an array of threads.
  listThreads() {
    return this.client.request("/api/chat/threads");
  }

  // Starts, or continues, the single conversation between this user and the
  // listing's landlord. `leaseId` is optional: it only decides the recipient on a
  // property with competing leases. Returns { threadId, ... }.
  // `confirmed` is sent only as true, after the person has agreed to a 409
  // CONFIRM_SEND prompt (the message holds contact details); see the send route.
  startListingChat({ listingId, body, leaseId, confirmed }) {
    return this.client.request("/api/chat/threads", {
      method: "POST",
      body: JSON.stringify({ listingId, body, leaseId, ...(confirmed === true ? { confirmed: true } : {}) }),
    });
  }

  // `limit` (1 to 100) and `before` (ISO timestamp) are optional, as on the server.
  getMessages(threadId, { limit, before } = {}) {
    const query = [];
    if (limit !== undefined && limit !== null) query.push(`limit=${encodeURIComponent(limit)}`);
    if (before !== undefined && before !== null) query.push(`before=${encodeURIComponent(before)}`);
    const qs = query.length ? `?${query.join("&")}` : "";
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/messages${qs}`);
  }

  // Text and/or attachments. `attachments` is the list returned by
  // presignAttachments (after the bytes were uploaded), each
  // { key, fileName, contentType, sizeBytes }. Omit it for a text-only message.
  // `confirmed` is sent only as true, after the person has agreed to a 409
  // CONFIRM_SEND prompt (the text or caption holds contact details).
  sendMessage(threadId, { body, attachments, confirmed } = {}) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ body, attachments, ...(confirmed === true ? { confirmed: true } : {}) }),
    });
  }

  markRead(threadId) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/read`, {
      method: "POST",
    });
  }

  // files: [{ name, type, size }]. Returns { presigned: [{ uploadUrl, key,
  // fileName, contentType, sizeBytes }] }. `size` must be the exact byte length
  // of the file that will be PUT to `uploadUrl`.
  presignAttachments(threadId, files) {
    return this.client.request(
      `/api/chat/threads/${encodeURIComponent(threadId)}/attachments/presign`,
      {
        method: "POST",
        body: JSON.stringify({ files }),
      }
    );
  }

  // Blocks the other person in this conversation. The server works out who that
  // is from the thread. Their conversation leaves your inbox and neither of you
  // can send into it afterwards. There is no unblock call yet.
  blockThread(threadId) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/block`, {
      method: "POST",
    });
  }

  // Reports the other person, optionally pointing at one of their messages.
  // `reason` is one of CHAT_REPORT_REASONS' values (@proximity/shared). Reporting
  // the same message or conversation twice is a success on the server.
  reportThread(threadId, { messageId, reason }) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/report`, {
      method: "POST",
      body: JSON.stringify({ messageId, reason }),
    });
  }

  // Landlord only. Emailed replies held in this conversation because they came from
  // someone not set up to reply for the landlord, plus the landlord's whole
  // approved/declined sender list. Returns { held: [...], senders: [...] }; the
  // student side always gets both empty.
  getReplySenders(threadId) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/reply-senders`);
  }

  // Decides on the sender of one held reply. `decision` is "approve" or "decline";
  // `scope` is "address" or "domain" (domain only when the held reply says
  // canApproveDomain). Approving delivers the held replies after the response, so
  // it returns { ok, pattern, delivering } at once. A reply already handled is a 404.
  decideReplySender(threadId, { heldId, decision, scope = "address" }) {
    return this.client.request(`/api/chat/threads/${encodeURIComponent(threadId)}/reply-senders`, {
      method: "POST",
      body: JSON.stringify({ heldId, decision, scope }),
    });
  }

  // Removes one entry from the landlord's list of senders (approved or declined).
  removeReplySender(id) {
    return this.client.request(`/api/chat/reply-senders/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  // Short-lived Supabase Realtime JWT. Returns { accessToken, expiresAt }.
  getRealtimeToken() {
    return this.client.request("/api/chat/realtime-token");
  }

  // Authenticated download of an attachment. Goes through requestBinary, not
  // request(): no JSON Content-Type, and the body comes back as a Blob.
  // Returns { blob, contentType, fileName }.
  fetchAttachment(attachmentId, { download = false, signal } = {}) {
    return this.client.requestBinary(attachmentPath(attachmentId, download), { signal });
  }

  // { uri, headers } for components that fetch the file themselves (an image
  // component or a file download). The uri is not usable without the bearer
  // header, and the token is read now, so call this per render or per download.
  async getAttachmentSource(attachmentId, { download = false } = {}) {
    const token = await this.client.getToken();
    return {
      uri: this.client.baseUrl + attachmentPath(attachmentId, download),
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    };
  }
}

function attachmentPath(attachmentId, download) {
  const base = `/api/chat/attachments/${encodeURIComponent(attachmentId)}`;
  return download ? `${base}?download=1` : base;
}

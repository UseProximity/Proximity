// Local file cache for chat photos. A sent photo is fetched from
// /api/chat/attachments/<id>, which needs the bearer token. Handing that token to
// a native <Image> meant the request bypassed the api client's refresh-and-retry,
// so an expired token (15 minutes) produced a 401 that nothing recovered from. Here
// the download is made by expo-file-system with the current token, an expired one is
// renewed and the download tried once more, and the image component then shows the
// local file, which needs no token at all.
//
// Files live in the OS cache directory under chat-images/, one per attachment id.
// A file is reused while it exists and is not empty; a failed download never leaves
// one behind, and a file that fails to display is deleted so the next try fetches
// it again.
import { Directory, File, Paths } from "expo-file-system";
import apiClient from "./apiClient";

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Downloads in progress, by attachment id: { promise, fresh }. A thumbnail and the
// full-screen viewer (or two mounts of the same thumbnail) share one request. `fresh`
// marks a download started by a retry.
const inflight = new Map();
// One token renewal at a time, shared by every download that hits a 401 together.
let renewal = null;

// Attachment ids are UUIDs from the server; refuse anything that could change the path.
function isSafeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9-]+$/.test(id);
}

function cacheFile(attachment) {
  const extension = EXTENSIONS[attachment.contentType] ?? "img";
  return new File(new Directory(Paths.cache, "chat-images"), `${attachment.id}.${extension}`);
}

function removeQuietly(file) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Nothing more to do: the next download overwrites it.
  }
}

// Any authenticated api call renews an expired access token (the api client
// refreshes on a 401 and stores the new one), so one cheap call is enough.
function renewAccessToken() {
  if (!renewal) {
    renewal = apiClient.chat
      .getRealtimeToken()
      .catch(() => {})
      .finally(() => {
        renewal = null;
      });
  }
  return renewal;
}

async function download(attachment, file) {
  try {
    new Directory(Paths.cache, "chat-images").create({ intermediates: true, idempotent: true });
  } catch {
    // The download below reports a real problem with the directory.
  }

  const attempt = async () => {
    // The token is read here, per attempt, never held between attempts.
    const { uri, headers } = await apiClient.chat.getAttachmentSource(attachment.id);
    return File.downloadFileAsync(uri, file, { headers, idempotent: true });
  };

  try {
    try {
      return await attempt();
    } catch (error) {
      if (!/\b401\b/.test(String(error?.message))) throw error;
      await renewAccessToken();
      return await attempt();
    }
  } catch (error) {
    // Android can leave a partly written file after a failed download.
    removeQuietly(file);
    throw error;
  }
}

// Resolves to the local file URI of an image attachment, downloading it first when
// it is not cached. Rejects when it cannot be fetched.
//
// `fresh` is for a retry after the image failed to display: the cached file is
// discarded and downloaded again. It never runs alongside another download of the
// same attachment, so one cannot delete or overwrite the other's result. With a
// download already in flight it waits for it and uses its result if it succeeds: a
// normal download only exists because no usable file was there when it started, so
// its file is newer than the failure being retried. Only if it fails does the retry
// download again. A download started by another retry (a thumbnail and the viewer
// retrying together) is simply shared.
export function getChatImageUri(attachment, { fresh = false } = {}) {
  if (!isSafeId(attachment?.id)) return Promise.reject(new Error("Invalid attachment id"));
  const id = attachment.id;
  const pending = inflight.get(id);
  if (pending && (!fresh || pending.fresh)) return pending.promise;

  const file = cacheFile(attachment);
  if (!pending && !fresh && file.exists && file.size > 0) return Promise.resolve(file.uri);

  const run = () => {
    if (fresh) removeQuietly(file);
    return download(attachment, file).then((downloaded) => downloaded.uri);
  };
  const entry = { fresh };
  entry.promise = (pending ? pending.promise.catch(run) : run()).finally(() => {
    if (inflight.get(id) === entry) inflight.delete(id);
  });
  inflight.set(id, entry);
  return entry.promise;
}

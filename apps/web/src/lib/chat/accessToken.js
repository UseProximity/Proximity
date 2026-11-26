/*
 * Chat magic-link tokens. Raw tokens live only in the email URL; the DB stores SHA-256
 * hashes (chat_access_tokens). Mint on notify, peek without burning for the interstitial,
 * consume via rpc_consume_chat_access_token on sign-in.
 */
import { createHash, randomBytes } from "crypto";
import supabase from "@/lib/supabase";

/** How long a thread-access link stays valid after we email it. */
export const CHAT_ACCESS_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function hashChatAccessToken(rawToken) {
  return createHash("sha256").update(String(rawToken), "utf8").digest("hex");
}

export function generateChatAccessToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Insert a single-use thread_access row. Returns the raw token for the email URL, or null
 * if the insert failed (caller should still send the email without a magic link, or skip).
 */
export async function mintChatAccessToken({ userId, threadId }) {
  if (!userId || !threadId) return null;

  const rawToken = generateChatAccessToken();
  const tokenHash = hashChatAccessToken(rawToken);
  const expiresAt = new Date(Date.now() + CHAT_ACCESS_TOKEN_TTL_MS).toISOString();

  const { error } = await supabase.from("chat_access_tokens").insert({
    token_hash: tokenHash,
    user_id: userId,
    thread_id: threadId,
    purpose: "thread_access",
    single_use: true,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("mintChatAccessToken failed:", error);
    return null;
  }

  return rawToken;
}

/**
 * Validate a raw token without burning it, so /chat-link can name the account and pick its
 * UI before the user commits. Only the explicit click redeems, which keeps link scanners
 * from consuming the single-use row on prefetch.
 */
export async function peekChatAccessToken(rawToken) {
  const trimmed = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!trimmed) return null;

  const tokenHash = hashChatAccessToken(trimmed);
  const { data, error } = await supabase
    .from("chat_access_tokens")
    .select("user_id, thread_id, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .eq("purpose", "thread_access")
    .maybeSingle();

  if (error) {
    console.error("peekChatAccessToken failed:", error);
    return null;
  }
  if (!data || data.used_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, email, name, deleted_at")
    .eq("id", data.user_id)
    .maybeSingle();

  if (userError) {
    console.error("peekChatAccessToken user lookup failed:", userError);
    return null;
  }
  if (!user || user.deleted_at) return null;

  return {
    userId: data.user_id,
    threadId: data.thread_id,
    email: user.email ?? null,
    name: user.name ?? null,
  };
}

/*
 * Verify that a message posted to one of our endpoints really came from Amazon SNS.
 *
 * SNS signs every message with a certificate it hosts on sns.<region>.amazonaws.com.
 * Anyone can POST to a public endpoint, so nothing in a message is trusted until:
 *   1. the signing certificate URL is an https URL on an SNS host (so an attacker
 *      cannot point us at a certificate of their own),
 *   2. the signature over the canonical fields checks out against that certificate, and
 *   3. the topic is one we expect, so a validly signed message from someone else's
 *      SNS topic is still refused.
 *
 * Used by /api/ses/events now, and by the inbound reply endpoint later.
 */
import { createVerify, X509Certificate } from "crypto";

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map();

export function isSnsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && SNS_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function canonicalString(msg) {
  const keys =
    msg.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys
    .filter((k) => msg[k] !== undefined && msg[k] !== null)
    .map((k) => `${k}\n${msg[k]}\n`)
    .join("");
}

async function signingCert(url) {
  if (certCache.has(url)) return certCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`certificate fetch failed: ${res.status}`);
  const pem = await res.text();
  // Parse once so a non-certificate response fails here, not in verify().
  new X509Certificate(pem);
  certCache.set(url, pem);
  return pem;
}

/**
 * Returns true only for a genuine SNS message from one of `allowedTopics`.
 * Never throws.
 */
export async function verifySnsMessage(msg, allowedTopics) {
  try {
    if (!msg || typeof msg !== "object") return false;
    if (!allowedTopics.filter(Boolean).includes(msg.TopicArn)) return false;
    if (!isSnsUrl(msg.SigningCertURL)) return false;
    if (typeof msg.Signature !== "string") return false;

    const algorithm = msg.SignatureVersion === "2" ? "RSA-SHA256" : msg.SignatureVersion === "1" ? "RSA-SHA1" : null;
    if (!algorithm) return false;

    const pem = await signingCert(msg.SigningCertURL);
    const verifier = createVerify(algorithm);
    verifier.update(canonicalString(msg), "utf8");
    return verifier.verify(pem, msg.Signature, "base64");
  } catch (err) {
    console.error("verifySnsMessage failed:", err);
    return false;
  }
}

import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";

/**
 * Runs the native Sign in with Apple sheet.
 *
 * The raw nonce never leaves the device except to our own backend; Apple only
 * sees its SHA-256, which it embeds in the identity token as the `nonce`
 * claim. The backend re-hashes the raw value and compares, which proves the
 * token was minted for this request and can't be replayed.
 *
 * Returns { credential, rawNonce }. Rejects with code "ERR_REQUEST_CANCELED"
 * when the user dismisses the sheet.
 */
export async function requestAppleCredential() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const rawNonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  return { credential, rawNonce };
}

export function isAppleCancellation(err) {
  return err?.code === "ERR_REQUEST_CANCELED";
}

// Resolves false on Android and web, where the package falls back to a stub,
// so the Apple button simply never renders there.
export function isAppleSignInAvailable() {
  return AppleAuthentication.isAvailableAsync();
}

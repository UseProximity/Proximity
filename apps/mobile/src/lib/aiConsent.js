import { useCallback, useEffect, useState } from "react";
import * as secureStorage from "./secureStorage";

// Explicit consent to share matchmaking data with a third-party AI provider
// (Anthropic). Stored per signed-in user in SecureStore, so a second account on
// the same phone is asked again. Bump AI_CONSENT_VERSION whenever the wording or
// the scope of what is shared changes: a stored value for an older version no
// longer counts, and the gate asks again.
export const AI_CONSENT_VERSION = 1;

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const keyFor = (userId) => `ai_consent_${userId}`;

async function readConsent(userId) {
  try {
    return (await secureStorage.get(keyFor(userId))) === String(AI_CONSENT_VERSION);
  } catch {
    // Fail closed: if the flag can't be read, ask again rather than assume yes.
    return false;
  }
}

/**
 * Consent status for `userId`: "loading" | "needed" | "granted".
 * The status is tied to the user id it was read for, so after a user switch the
 * previous user's "granted" can never be reported for the new one, not even for
 * a single render.
 */
export function useAiConsent(userId) {
  const [read, setRead] = useState({ userId: null, granted: false });

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    readConsent(userId).then((granted) => {
      if (!cancelled) setRead({ userId, granted });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const grant = useCallback(async () => {
    if (!userId) return;
    // The user has agreed: honour it for this session even if saving fails.
    setRead({ userId, granted: true });
    try {
      await secureStorage.set(keyFor(userId), String(AI_CONSENT_VERSION));
    } catch (err) {
      console.warn("aiConsent: could not save consent", err);
    }
  }, [userId]);

  const status = !userId || read.userId !== userId ? "loading" : read.granted ? "granted" : "needed";
  return { status, grant };
}

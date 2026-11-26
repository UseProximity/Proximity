/*
 * The signed-out reviewer's inline profile-setup token, kept in localStorage so
 * "I'll finish this later" survives a refresh or a closed tab on the same phone.
 *
 * The review forms send it back with each further signed-out review, which is
 * how the server tells this browser (keep offering the profile step) apart from
 * a stranger typing the same address (it emails the owner instead).
 */
const SETUP_TOKEN_KEY = "prx_review_setup_token";

export function readStoredToken() {
  try {
    return localStorage.getItem(SETUP_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function storeToken(token) {
  try {
    if (token) localStorage.setItem(SETUP_TOKEN_KEY, token);
  } catch {
    /* private mode: the emailed link is the fallback */
  }
}
export function clearStoredToken() {
  try {
    localStorage.removeItem(SETUP_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

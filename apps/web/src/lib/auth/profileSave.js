/*
 * Saving the "Complete Your Profile" popup. Client-safe, no server imports.
 *
 * An answer that is not a success does not prove the profile was not saved: the
 * server may have committed the write and then timed out, or the answer may have
 * been lost on the way back. The session is the one thing that can tell, because
 * refreshing it reads profile_complete from the database. So a failed or missing
 * answer is checked against it before the user is told the save failed.
 *
 * `refreshSession` is next-auth's update(), called with a payload so it re-reads
 * the database. Resolves true when the profile is saved, false when it is not.
 * Never throws.
 */
export async function submitProfile(payload, refreshSession, request = fetch) {
  try {
    const res = await request("/api/editProfile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
  } catch {
    // Same as any other failed answer: the write may still have gone through.
  }

  try {
    return (await refreshSession())?.user?.profileComplete === true;
  } catch {
    return false;
  }
}

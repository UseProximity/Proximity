/*
 * Saving the "Complete Your Profile" popup. Client-safe, no server imports.
 *
 * A 4xx is a definite rejection and always a failed save. A server error or a
 * missing answer does not prove the profile was not saved: the server may have
 * committed the write and then failed or timed out, or the answer may have been
 * lost on the way back. The session is the one thing that can tell, because
 * refreshing it reads profile_complete from the database. So only those are
 * checked against it before the user is told the save failed.
 *
 * `refreshSession` is next-auth's update(), called with a payload so it re-reads
 * the database. Resolves true when the profile is saved, false when it is not.
 * Never throws.
 */
export async function submitProfile(payload, refreshSession) {
  try {
    const res = await fetch("/api/editProfile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return true;
    // A 4xx is a definite rejection: nothing was saved, so the session is not asked.
    if (res.status < 500) return false;
  } catch {
    // A lost answer, like a server error: the write may still have gone through.
  }

  try {
    return (await refreshSession())?.user?.profileComplete === true;
  } catch {
    return false;
  }
}

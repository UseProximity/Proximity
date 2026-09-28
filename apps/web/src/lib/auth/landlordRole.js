/*
 * Turn the signed-in account into a landlord.
 *
 * A first Google sign-in always creates a student (auth.js has no way to know
 * what the person came to do). Callers that do know, the home page after
 * "Login as Landlord" and Add Listing after a publish gate, correct it here:
 * save the role, then push it into the session so the header and layouts see it
 * without a sign-out.
 *
 * `update` is the function from next-auth's useSession. Resolves true if the
 * role was changed.
 */
export async function becomeLandlord(update) {
  const res = await fetch("/api/editProfile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "landlord" }),
  });
  if (!res.ok) return false;
  await update({ role: "landlord" });
  return true;
}

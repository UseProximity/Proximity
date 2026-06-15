/*
 * Staging-only: lists admin/super users' emails to populate the test-email recipient
 * picker. Returns 404 off staging so it never exists in production. Reads the dev DB
 * (staging's default client), so the list reflects the snapshot's admins/supers.
 */
import { auth } from "@/auth";
import supabase from "@/lib/supabase";
import { isStaging } from "@/lib/appEnv";

export async function GET() {
  if (!isStaging()) return Response.json({ error: "Not found" }, { status: 404 });

  const session = await auth();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("users")
    .select("email, name, roles!inner(name)")
    .in("roles.name", ["admin", "super"])
    .not("email", "is", null);

  if (error) return Response.json({ error: "Could not load recipients" }, { status: 500 });

  const recipients = (data ?? [])
    .map((u) => ({ email: u.email, name: u.name, role: u.roles?.name }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return Response.json({ recipients });
}

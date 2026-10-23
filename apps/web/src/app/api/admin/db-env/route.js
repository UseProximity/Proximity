// @auth admin
import { requireDbRole } from "@/lib/userRole";
import { isProdData, appEnv } from "@/lib/appEnv";

export async function GET() {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // Reflects the DB the default client targets: staging resolves to "dev". Doubles as a
  // quick check that staging is wired to the dev database.
  const env = isProdData() ? "prod" : "dev";
  return Response.json({ env, appEnv: appEnv() });
}

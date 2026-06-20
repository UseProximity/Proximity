import { auth } from "@/auth";
import { isProdData, appEnv } from "@/lib/appEnv";

export async function GET() {
  const session = await auth();
  if (!session || (session.user.role !== "super" && session.user.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  // Reflects the DB the default client targets: staging resolves to "dev". Doubles as a
  // quick check that staging is wired to the dev database.
  const env = isProdData() ? "prod" : "dev";
  return Response.json({ env, appEnv: appEnv() });
}

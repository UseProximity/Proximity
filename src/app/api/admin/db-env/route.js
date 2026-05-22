import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session || (session.user.role !== "super" && session.user.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const env = process.env.NODE_ENV === "production" ? "prod" : "dev";
  return Response.json({ env });
}

import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function AddSubLeasePage() {
  const session = await auth();
  const dest = "/dashboard/student?addSublease=1";
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(dest)}`);
  }
  redirect(dest);
}

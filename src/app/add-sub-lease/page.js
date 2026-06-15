import { redirect } from "next/navigation";

// Legacy route — the add-sublease flow now lives at /add-sublease (role gating
// and auth handled by that route's layout).
export default function AddSubLeasePage() {
  redirect("/add-sublease");
}

import { redirect } from "next/navigation";

export default function AddSubLeasePage() {
  redirect("/dashboard/student?addSublease=1");
}

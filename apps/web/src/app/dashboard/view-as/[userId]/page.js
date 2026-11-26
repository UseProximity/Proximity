import { Suspense } from "react";
import { redirect } from "next/navigation";
import supabase from "@/lib/supabase";
import { requireDbRole } from "@/lib/userRole";
import ProximityDashboard from "@/app/dashboard/landlord/page";
import StudentDashboardPage from "@/app/dashboard/student/page";

export default async function ViewAsPage({ params }) {
  const session = await requireDbRole(["super", "admin"]);
  if (!session) {
    redirect("/");
  }

  const { userId } = await params;

  const { data: targetUser } = await supabase
    .from("users")
    .select("id, name, roles!role_id(name)")
    .eq("id", userId)
    .single();

  if (!targetUser) redirect("/dashboard/admin");

  const targetRole = targetUser.roles?.name ?? "student";

  if (targetRole === "student") {
    return (
      <Suspense>
        <StudentDashboardPage initialViewAsId={userId} />
      </Suspense>
    );
  }

  // landlord or super — show landlord dashboard
  return (
    <Suspense>
      <ProximityDashboard initialViewAsId={userId} />
    </Suspense>
  );
}

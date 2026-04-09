import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import supabase from "@/libs/supabase";
import ProximityDashboard from "@/app/dashboard/landlord/page";
import StudentDashboardPage from "@/app/dashboard/student/page";

export default async function ViewAsPage({ params }) {
  const session = await auth();
  if (!session || session.user.role !== "super") {
    redirect("/");
  }

  const { userId } = await params;

  const { data: targetUser } = await supabase
    .from("users")
    .select("id, role, name")
    .eq("id", userId)
    .single();

  if (!targetUser) redirect("/dashboard/admin");

  if (targetUser.role === "student") {
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

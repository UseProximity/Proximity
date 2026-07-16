import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Footer from "@/components/layout/Footer";

export default async function LeaseCheckLayout({ children }) {
  const session = await auth();
  if (!session) redirect("/login?callbackUrl=/lease-check");
  return (
    <>
      {children}
      <Footer />
    </>
  );
}

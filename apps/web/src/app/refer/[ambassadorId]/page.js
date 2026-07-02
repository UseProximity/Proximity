/*
 * Public landing page for an ambassador's shareable review link: /refer/<userId>.
 * Validates the ambassador id server-side and hands the referrer's name to the client
 * form. Invalid / unknown ids render a friendly notice instead of the form. Not indexed.
 */
import supabase from "@/lib/supabase";
import ReferReviewClient from "./ReferReviewClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Leave a Review | Proximity",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function InvalidLink() {
  return (
    <div className="max-w-lg mx-auto px-4 py-24 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">This link isn’t valid</h1>
      <p className="text-gray-600">
        The referral link you opened doesn’t match an active Proximity ambassador. Please
        double-check the link you were given.
      </p>
    </div>
  );
}

export default async function ReferPage({ params }) {
  const { ambassadorId } = await params;

  if (!UUID_RE.test(ambassadorId || "")) return <InvalidLink />;

  const { data: referrer } = await supabase
    .from("users")
    .select("id, name")
    .eq("id", ambassadorId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!referrer) return <InvalidLink />;

  return (
    <ReferReviewClient
      referrerId={referrer.id}
      referrerName={referrer.name || "a Proximity ambassador"}
    />
  );
}

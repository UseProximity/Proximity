import CampusHubClient from "./campus-hub-client";

export const metadata = {
  title: "WashU Campus Housing Reviews and Student Hub | Proximity",
  description:
    "Real dorm reviews from WashU students. Compare South 40 and Village housing, room types, and what living on campus is actually like before you choose.",
  alternates: { canonical: "/CampusHub" },
};

export default function CampusHubPage() {
  return <CampusHubClient />;
}

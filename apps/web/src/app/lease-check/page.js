import LeaseCheckClient from "@/components/lease-check/LeaseCheckClient";

export const metadata = {
  title: "Lease Check | Proximity",
  description:
    "Upload your lease before you sign it. AI flags what to read closely, in plain English.",
};

export default function LeaseCheckPage() {
  return <LeaseCheckClient />;
}

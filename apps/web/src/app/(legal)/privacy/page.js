import { getLegalDoc } from "@/lib/legal";
import LegalPage from "../LegalPage";

const doc = getLegalDoc("privacy");

export const metadata = {
  title: `${doc.title} | Proximity`,
  description: doc.description,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
  return <LegalPage doc={doc} />;
}

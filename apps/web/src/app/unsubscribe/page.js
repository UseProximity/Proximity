import UnsubscribeClient from "./UnsubscribeClient";

export const metadata = {
  title: "Unsubscribe | Proximity",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({ searchParams }) {
  const params = await searchParams;
  return <UnsubscribeClient token={params?.t ?? ""} />;
}

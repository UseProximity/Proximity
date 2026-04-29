import ResetPasswordClient from "./ResetPasswordClient";

export default async function ResetPasswordPage({ searchParams }) {
  const params = await searchParams;
  const token = params?.token ?? "";
  return <ResetPasswordClient token={token} />;
}

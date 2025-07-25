import { Header } from "@/components/Header";

export default function StudentDashboard() {
  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto p-6 mt-10">
        <h1 className="text-3xl font-bold text-red-600 mb-4">
          Student Dashboard
        </h1>
        <p className="text-gray-700 mb-6">
          Welcome, student! Here you can view saved listings and your messages.
        </p>

        <div className="space-y-4">
          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Saved Listings
            </h2>
            <p className="text-gray-500">
              Your bookmarked or favorited properties appear here.
            </p>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">Messages</h2>
            <p className="text-gray-500">
              Any landlord communication or contact will show here.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

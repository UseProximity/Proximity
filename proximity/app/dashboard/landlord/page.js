import { Header } from "@/components/Header";

export default function LandlordDashboard() {
  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto p-6 mt-10">
        <h1 className="text-3xl font-bold text-red-600 mb-4">
          Landlord Dashboard
        </h1>
        <p className="text-gray-700 mb-6">
          Welcome, landlord! Here you can manage your listings.
        </p>

        <div className="space-y-4">
          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Your Listings
            </h2>
            <p className="text-gray-500">
              This is where you would see your posted properties.
            </p>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Add New Listing
            </h2>
            <p className="text-gray-500">
              <a href="/add-listing" className="text-red-600 hover:underline">
                Click here to add a new listing
              </a>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

import { Header } from "@/components/Header";
import { notFound } from "next/navigation";
import Link from "next/link";

export default function HouseDetails({ params }) {
  const { address } = params;

  const houses = [
    {
      landlord: {
        id: "landlord1",
        fullName: "John Smith",
        gender: "Male",
        age: 45,
        yearsExperience: 10,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/men/32.jpg",
        bio: "Friendly and professional landlord focused on providing comfortable student housing. Quick maintenance responses.",
        phone: "(555) 123-4567",
        email: "john.smith@example.com",
      },
      address: "333 Sherman Ave",
      lat: 38.649553,
      lng: -90.303128,
      price: "$2,000",
      beds: 4,
      baths: 2.5,
      sqft: 2610,
      leaseType: "12 month lease",
      image:
        "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord1",
        fullName: "John Smith",
        gender: "Male",
        age: 45,
        yearsExperience: 10,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/men/32.jpg",
        bio: "Friendly and professional landlord focused on providing comfortable student housing. Quick maintenance responses.",
        phone: "(555) 123-4567",
        email: "john.smith@example.com",
      },
      address: "120 Maple St",
      lat: 38.64892,
      lng: -90.297921,
      price: "$1,500",
      beds: 5,
      baths: 3,
      sqft: 3200,
      leaseType: "9 month lease",
      image:
        "https://images.unsplash.com/photo-1460518451285-97b6aa326961?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord1",
        fullName: "John Smith",
        gender: "Male",
        age: 45,
        yearsExperience: 10,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/men/32.jpg",
        bio: "Friendly and professional landlord focused on providing comfortable student housing. Quick maintenance responses.",
        phone: "(555) 123-4567",
        email: "john.smith@example.com",
      },
      address: "45 Oak Dr",
      lat: 38.647589,
      lng: -90.299832,
      price: "$800",
      beds: 3,
      baths: 2,
      sqft: 1800,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1507089947368-19c1da9775ae?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord4",
        fullName: "Michael Brown",
        gender: "Male",
        age: 52,
        yearsExperience: 15,
        rating: 1,
        profileImage: "https://randomuser.me/api/portraits/men/76.jpg",
        bio: "Experienced landlord, but reviews mention slow maintenance response.",
        phone: "(555) 222-7788",
        email: "michael.brown@example.com",
      },
      address: "88 Pine Ln",
      lat: 38.650015,
      lng: -90.301701,
      price: "$3,500",
      beds: 4,
      baths: 2.5,
      sqft: 2400,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord5",
        fullName: "Sarah Johnson",
        gender: "Female",
        age: 38,
        yearsExperience: 7,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/women/44.jpg",
        bio: "Passionate about maintaining clean and safe rental properties. Very responsive to tenant needs.",
        phone: "(555) 444-9911",
        email: "sarah.johnson@example.com",
      },
      address: "200 Cedar Ct",
      lat: 38.65114,
      lng: -90.29724,
      price: "$1,760",
      beds: 5,
      baths: 4,
      sqft: 3500,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1523217582562-09d0def993a6?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord6",
        fullName: "David Lee",
        gender: "Male",
        age: 41,
        yearsExperience: 12,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/men/54.jpg",
        bio: "Friendly landlord, well-maintained homes. Tenants appreciate quick communication.",
        phone: "(555) 555-3322",
        email: "david.lee@example.com",
      },
      address: "17 Birch Blvd",
      lat: 38.64837,
      lng: -90.300181,
      price: "$1,260",
      beds: 3,
      baths: 2,
      sqft: 1600,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord7",
        fullName: "Jessica Miller",
        gender: "Female",
        age: 35,
        yearsExperience: 6,
        rating: 3,
        profileImage: "https://randomuser.me/api/portraits/women/65.jpg",
        bio: "Provides affordable housing options for students. Some tenants mention delayed repairs.",
        phone: "(555) 777-4433",
        email: "jessica.miller@example.com",
      },
      address: "301 Willow Way",
      lat: 38.650712,
      lng: -90.302752,
      price: "$1,900",
      beds: 4,
      baths: 3,
      sqft: 2700,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1472224371017-08207f84aaae?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord8",
        fullName: "Robert Wilson",
        gender: "Male",
        age: 50,
        yearsExperience: 20,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/men/85.jpg",
        bio: "Veteran landlord who takes pride in maintaining beautiful properties.",
        phone: "(555) 888-5566",
        email: "robert.wilson@example.com",
      },
      address: "56 Elm St",
      lat: 38.650066,
      lng: -90.29884,
      price: "$2,300",
      beds: 3,
      baths: 2,
      sqft: 1750,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord9",
        fullName: "Karen White",
        gender: "Female",
        age: 47,
        yearsExperience: 14,
        rating: 2,
        profileImage: "https://randomuser.me/api/portraits/women/90.jpg",
        bio: "Some complaints about maintenance delays, but properties are generally well-located.",
        phone: "(555) 999-2233",
        email: "karen.white@example.com",
      },
      address: "400 Spruce Ave",
      lat: 38.649017,
      lng: -90.296935,
      price: "$1,000",
      beds: 5,
      baths: 3.5,
      sqft: 3100,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1468327768560-75b778cbb551?auto=format&fit=crop&w=600&q=80",
    },
    {
      landlord: {
        id: "landlord10",
        fullName: "Emily Davis",
        gender: "Female",
        age: 33,
        yearsExperience: 5,
        rating: 4,
        profileImage: "https://randomuser.me/api/portraits/women/12.jpg",
        bio: "Young landlord known for modern, well-furnished student homes.",
        phone: "(555) 111-8899",
        email: "emily.davis@example.com",
      },
      address: "22 Chestnut Rd",
      lat: 38.647149,
      lng: -90.304528,
      price: "$1,100",
      beds: 4,
      baths: 2.5,
      sqft: 2300,
      leaseType: "Academic Year",
      image:
        "https://images.unsplash.com/photo-1505691723518-41cb85eea23e?auto=format&fit=crop&w=600&q=80",
    },
  ];

  const decodedAddress = decodeURIComponent(address);
  const house = houses.find((h) => h.address === decodedAddress);

  if (!house) {
    notFound();
  }

  const reviews = [
    {
      name: "Emily R.",
      rating: 5,
      comment:
        "Loved living here! The landlord was very responsive and the neighborhood felt safe and quiet. Highly recommend.",
    },
    {
      name: "Jake T.",
      rating: 1,
      comment: "Shit Place.",
    },
    {
      name: "Sophia L.",
      rating: 4,
      comment:
        "Great place for students, close to everything. A few minor repairs needed during my stay, but they were fixed quickly.",
    },
  ];

  return (
    <>
      <Header />
      <div className="bg-gray-100 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Image + Gallery */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="md:col-span-2">
              <img
                src={house.image}
                alt={house.address}
                className="rounded-xl w-full h-[400px] object-cover shadow"
              />
            </div>
            <div className="flex flex-col justify-center gap-3 bg-white p-6 rounded-xl shadow-md">
              <div className="text-3xl font-bold text-gray-900">
                {house.price}
              </div>
              <div className="text-gray-700">{house.address}</div>
              <div className="text-sm text-gray-500">
                Listed by <strong>{house.landlord.fullName}</strong>
              </div>

              {/*Landlord profile and Rating Thing */}
              <Link href={`/landlord/${encodeURIComponent(house.landlord.id)}`}>
                {/**FIX-ME make the url unique for each landlord (not using the name) */}
                <div className="flex items-center gap-2 mt-1">
                  <img
                    src={house.landlord.profileImage}
                    alt={house.landlord.fullName}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    <div className="text-yellow-500 text-sm leading-tight">
                      {"★".repeat(house.landlord.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - house.landlord.rating)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">Landlord Rating</p>
                  </div>
                </div>
              </Link>

              <button className="bg-red-600 text-white py-2 px-4 rounded-lg text-lg hover:bg-red-700 mt-4">
                Request a tour
              </button>
              <button className="text-red-600 border border-red-600 py-2 px-4 rounded-lg text-lg hover:bg-red-50">
                Contact Landlord
              </button>
            </div>
          </div>

          {/* Specs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">{house.beds}</div>
              <div className="text-sm text-gray-500">Beds</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">{house.baths}</div>
              <div className="text-sm text-gray-500">Baths</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {house.sqft.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500">Sq Ft</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-lg font-semibold">{house.leaseType}</div>
              <div className="text-sm text-gray-500">Lease Type</div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <h2 className="text-xl font-semibold mb-4">Property Overview</h2>
            <p className="text-gray-700 leading-relaxed">
              Welcome to this charming listing located at{" "}
              <strong>{house.address}</strong>! This beautiful home features{" "}
              {house.beds} spacious bedrooms and {house.baths} elegant
              bathrooms, boasting a total of {house.sqft.toLocaleString()}{" "}
              square feet. Perfect for families, professionals, or students
              looking for a spacious and modern place to live near campus or the
              city center.
            </p>
          </div>

          {/* Reviews */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">
              Reviews For The Property
            </h2>
            <div className="space-y-4">
              {reviews.map((review, index) => (
                <div key={index} className="border-b pb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-900">
                      {review.name}
                    </span>
                    <span className="text-yellow-500">
                      {"★".repeat(review.rating)}
                      <span className="text-gray-300">
                        {"★".repeat(5 - review.rating)}
                      </span>
                    </span>
                  </div>
                  <p className="text-gray-700 mt-1">{review.comment}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

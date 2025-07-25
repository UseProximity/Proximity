"use client";

import Link from "next/link";
import { Header } from "@/components/Header";
import dynamic from "next/dynamic";
import { useState } from "react";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Browse() {
  const [price, setPrice] = useState("");
  const [bedBaths, setBedBaths] = useState("");
  const [size, setSize] = useState("");
  const [leaseType, setLeaseType] = useState("");

  const handlePriceChange = (e) => {
    setPrice(e.target.value);
  };

  const handleBedBathsChange = (e) => {
    setBedBaths(e.target.value);
  };

  const handleSizeChange = (e) => {
    setSize(e.target.value);
  };

  const handleLeaseTypeChange = (e) => {
    setLeaseType(e.target.value);
  };

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

  // Filtered houses based on selected filters
  const filteredHouses = houses.filter((house) => {
    let matchesPrice = true;
    let matchesBeds = true;
    let matchesSize = true;
    let matchesLease = true;

    // Price filter example (convert to numeric values)
    if (price) {
      const priceNum = parseInt(house.price.replace(/[$,]/g, ""));
      if (price === "Under $1,000") matchesPrice = priceNum < 1000;
      if (price === "$1,000 - $1,500")
        matchesPrice = priceNum >= 1000 && priceNum <= 1500;
      if (price === "$1,500 - $2,000")
        matchesPrice = priceNum >= 1500 && priceNum <= 2000;
      if (price === "Over $2000") matchesPrice = priceNum > 2000;
    }

    // Beds/Baths filter
    if (bedBaths) {
      if (bedBaths === "1 Bed, 1 Bath")
        matchesBeds = house.beds === 1 && house.baths === 1;
      if (bedBaths === "2 Bed, 1 Bath")
        matchesBeds = house.beds === 2 && house.baths >= 1;
      if (bedBaths === "3 Bed, 2+ Bath")
        matchesBeds = house.beds === 3 && house.baths >= 2;
      if (bedBaths === "4+ Bedrooms") matchesBeds = house.beds >= 4;
    }

    // Size filter
    if (size) {
      if (size === "Under 500 sq ft") matchesSize = house.sqft < 500;
      if (size === "500 - 750 sq ft")
        matchesSize = house.sqft >= 500 && house.sqft <= 750;
      if (size === "750 - 1,000 sq ft")
        matchesSize = house.sqft >= 750 && house.sqft <= 1000;
      if (size === "1,000 - 1,250 sq ft")
        matchesSize = house.sqft >= 1000 && house.sqft <= 1250;
      if (size === "1,250 - 1,500 sq ft")
        matchesSize = house.sqft >= 1250 && house.sqft <= 1500;
      if (size === "Over 1,500 sq ft") matchesSize = house.sqft > 1500;
    }

    // Lease Type filter (you don’t have leaseType data in houses yet, so this won’t do anything unless you add it)
    if (leaseType) {
      matchesLease = house.leaseType === leaseType;
    }

    return matchesPrice && matchesBeds && matchesSize && matchesLease;
  });

  return (
    <>
      <Header />

      <div className="min-h-screen bg-gray-50">
        <div className="flex flex-col md:flex-row h-screen">
          {/* Map Section */}
          <div className="md:w-1/2 w-full h-64 md:h-full relative">
            {/*<div className="absolute top-0 left-0 w-full h-full rounded-none md:rounded-r-3xl shadow-lg z-0" />
            <div className="absolute top-0 left-0 w-full h-full z-10"></div> */}
            <MapView houses={filteredHouses} />
          </div>
          {/* Listings Section */}
          <div className="md:w-1/2 w-full overflow-y-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-6 text-center">
              Available Listings
            </h1>
            {/* Filter Buttons */}
            <div className="flex flex-wrap justify-center gap-4 mb-8">
              {/*Price Filter */}
              <select
                value={price}
                onChange={handlePriceChange}
                className={`flex items-center px-6 py-3 rounded-xl bg-white shadow border font-semibold text-gray-800 transition hover:bg-gray-100 hover:shadow-lg`}
              >
                <option value="">Select Price</option>
                {[
                  "Under $1,000",
                  "$1,000 - $1,500",
                  "$1,500 - $2,000",
                  "Over $2000",
                ].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {/*Bed/Baths Filter */}
              <select
                value={bedBaths}
                onChange={handleBedBathsChange}
                className={`flex items-center px-6 py-3 rounded-xl bg-white shadow border font-semibold text-gray-800 transition hover:bg-gray-100 hover:shadow-lg`}
              >
                <option value="">Select Bed/Baths</option>
                {[
                  "1 Bed, 1 Bath",
                  "2 Bed, 1 Bath",
                  "3 Bed, 2+ Bath",
                  "4+ Bedrooms",
                ].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {/*Size Filter */}
              <select
                value={size}
                onChange={handleSizeChange}
                className={`flex items-center px-6 py-3 rounded-xl bg-white shadow border font-semibold text-gray-800 transition hover:bg-gray-100 hover:shadow-lg`}
              >
                <option value="">Select Size</option>
                {[
                  "Under 500 sq ft",
                  "500 - 750 sq ft",
                  "750 - 1,000 sq ft",
                  "1,000 - 1,250 sq ft",
                  "1,250 - 1,500 sq ft",
                  "Over 1,500 sq ft",
                ].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {/*Lease Type */}

              <select
                value={leaseType}
                onChange={handleLeaseTypeChange}
                className={`flex items-center px-6 py-3 rounded-xl bg-white shadow border font-semibold text-gray-800 transition hover:bg-gray-100 hover:shadow-lg`}
              >
                <option value="">Select Lease Type</option>
                {["12 month lease", "9 month lease", "Academic Year"].map(
                  (option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  )
                )}
              </select>
            </div>

            {/*Listing of the Houses */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-6">
              {filteredHouses.map((house) => (
                <Link
                  key={house.address}
                  href={`/browse/${encodeURIComponent(house.address)}`}
                  className="block bg-white rounded-2xl shadow-md border hover:shadow-xl transition duration-300 overflow-hidden"
                >
                  <img
                    src={house.image}
                    alt={house.address}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-6">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-2xl font-bold text-gray-900">
                        {house.price}
                      </span>
                      <div className="flex space-x-2">
                        {/* Share Icon */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-6 w-6 text-gray-400 hover:text-blue-500 cursor-pointer"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 8a3 3 0 11-6 0 3 3 0 016 0zm6 8a3 3 0 11-6 0 3 3 0 016 0zm-6 0a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                        {/* Heart Icon */}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-6 w-6 text-gray-400 hover:text-red-500 cursor-pointer"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.293l1.318-1.318a4.5 4.5 0 116.364 6.364L12 21.293l-7.682-7.682a4.5 4.5 0 010-6.364z"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="flex space-x-4 text-gray-700 text-sm mb-2">
                      <span>{house.beds} Beds</span>
                      <span>{house.baths} Baths</span>
                      <span>{house.sqft.toLocaleString()} Sq. Ft.</span>
                    </div>
                    <div className="text-gray-500 text-sm">{house.address}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

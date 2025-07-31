"use client";

import { useState } from "react";
import Image from "next/image";
import Modal from "../../components/Modal";
import { AiFillStar } from "react-icons/ai";
import { Header } from "@/components/Header";

const allDorms = [
  "Beaumont",
  "Danforth",
  "Dardick",
  "Dauten",
  "Eliot A",
  "Hurd",
  "Koenig",
  "Lee",
  "Lien",
  "Park",
  "Umrath",
  "Eliot B",
  "Gregg",
  "Hitzeman",
  "Liggett",
  "Mudd",
  "Myers",
  "Nemerov",
  "Rutledge",
  "Shanedling",
  "Shepley",
  "SoFoHo",
  "Wheeler",
  "Greenway Apartments",
  "Millbrook",
  "University Drive",
  "Village East",
  "Rosedale Apartments",
  "The Lofts",
  "Washington Ave Apartments",
  "520 Kingsland",
  "Village & Lopata House",
];

const reviews = [
  {
    name: "Adrian",
    classYear: 2028,
    rating: 5,
    dorm: "Beaumont",
    dormType: "Modern Double",
    tags: ["On-Campus", "Quiet Floor"],
    content: "Spacious dorm, great natural light, but noisy at night.",
    date: "July 2025",
  },
  {
    name: "Sophie",
    classYear: 2027,
    rating: 5,
    dorm: "Danforth",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Quiet Floor"],
    content: "Super cozy and clean dorm, would recommend.",
    date: "July 2025",
  },
  // Add more review entries here if needed
];

const dormImages = {};
allDorms.forEach((dorm) => {
  if (dorm && typeof dorm === "string") {
    const imageName = dorm
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "");
    dormImages[dorm] = [`/images/${imageName}.jpeg`];
  }
});

export default function CampusHub() {
  const [selectedType, setSelectedType] = useState("All");
  const [selectedRating, setSelectedRating] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDorm, setSelectedDorm] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const dormTypes = [
    "Traditional Single",
    "Traditional Double",
    "Modern Single",
    "Modern Double",
  ];

  const dormGroups = reviews.reduce((acc, review) => {
    if (!acc[review.dorm]) acc[review.dorm] = [];
    acc[review.dorm].push(review);
    return acc;
  }, {});

  const filteredDorms = allDorms.filter((dorm) => {
    const dormReviews = dormGroups[dorm] || [];
    const matchesRating =
      selectedRating === "All" ||
      dormReviews.some((r) => r.rating === Number(selectedRating));
    const matchesType =
      selectedType === "All" ||
      dormReviews.some((r) => r.dormType === selectedType);
    const matchesSearch =
      searchQuery === "" ||
      dorm.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dormReviews.some((r) =>
        r.content.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesRating && matchesType && matchesSearch;
  });

  return (
    <>
      <Header />
      <div className="max-w-7xl mx-auto p-6">
        <h1 className="text-4xl font-bold text-center mb-2">
          Verified Reviews from WashU Students
        </h1>
        <p className="text-center text-gray-600 mb-6">
          Every review is written by real students who lived at the property.
        </p>

        <div className="flex flex-wrap gap-4 justify-center mb-8">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-4 py-2 border rounded"
          >
            <option value="All">Select Dorm Type</option>
            {dormTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={selectedRating}
            onChange={(e) => setSelectedRating(e.target.value)}
            className="px-4 py-2 border rounded"
          >
            <option value="All">All Ratings</option>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>
                {r} Stars
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-4 py-2 border rounded"
          />

          <button
            onClick={() => {
              setSelectedRating("All");
              setSelectedType("All");
              setSearchQuery("");
            }}
            className="px-4 py-2 bg-gray-200 rounded"
          >
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filteredDorms.map((dorm) => {
            const dormReviews = dormGroups[dorm] || [];
            const roomType = dormReviews[0]?.dormType || "No reviews yet";
            return (
              <div
                key={dorm}
                className="bg-white rounded-lg shadow cursor-pointer hover:shadow-lg transition"
                onClick={() => {
                  setSelectedDorm({ name: dorm, reviews: dormReviews });
                  setModalOpen(true);
                }}
              >
                <Image
                  src={dormImages[dorm]?.[0] || "/images/placeholder.jpeg"}
                  alt={dorm}
                  width={400}
                  height={192}
                  className="w-full h-48 object-cover rounded-t-lg"
                />

                <div className="p-4">
                  <h2 className="text-lg font-bold">{dorm}</h2>
                  <p className="text-sm text-gray-600">{roomType}</p>
                  <p className="text-sm text-gray-500">
                    {dormReviews.length} review{dormReviews.length !== 1 && "s"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal */}
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
          {selectedDorm && (
            <div className="flex flex-col md:flex-row gap-6 w-full h-full overflow-y-auto">
              {/* Left side */}
              <div className="w-full md:w-2/3">
                <h2 className="text-3xl font-bold mb-4">{selectedDorm.name}</h2>
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {dormImages[selectedDorm.name]?.map((img, idx) => (
                    <Image
                      key={idx}
                      src={img}
                      alt=""
                      width={500}
                      height={350}
                      className="w-full h-[300px] md:h-[350px] object-cover rounded-lg"
                    />
                  ))}
                </div>

                {selectedDorm.reviews.length > 0 ? (
                  <div className="space-y-4">
                    {selectedDorm.reviews.map((r, idx) => (
                      <div key={idx} className="bg-gray-100 p-4 rounded">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold">
                            {r.name}, Class of {r.classYear}
                          </span>
                          <div className="flex">
                            {[...Array(r.rating)].map((_, i) => (
                              <AiFillStar key={i} className="text-yellow-500" />
                            ))}
                          </div>
                        </div>
                        <div className="text-gray-700 mb-1">{r.content}</div>
                        <div className="text-xs text-gray-500">
                          {r.dormType} • {r.tags.join(", ")} • Posted {r.date}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500">No reviews yet</p>
                )}
              </div>

              {/* Right sidebar */}
              <div className="w-full md:w-1/3 space-y-4">
                <Image
                  src="/images/room-placeholder.jpeg"
                  alt="Dorm Setup"
                  width={350}
                  height={180}
                  className="w-full h-44 object-cover rounded"
                />
                <div>
                  <h3 className="font-semibold mb-2 text-lg">
                    Recommended Items
                  </h3>
                  <ul className="text-sm list-disc list-inside space-y-1">
                    <li>
                      <a
                        href="https://www.amazon.com/dp/B01N5IB20Q"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline"
                      >
                        Clip-on Fan
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.amazon.com/dp/B09JPFMNMT"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline"
                      >
                        LED Desk Lamp
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://www.amazon.com/dp/B081H3Y5NW"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline"
                      >
                        Mini Fridge
                      </a>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </>
  );
}

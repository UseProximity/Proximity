"use client";

import { useState } from "react";
import Modal from "../../components/Modal";
import { AiFillStar } from "react-icons/ai";
import { Header } from "@/components/Header";

// Full dorm list
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
  {
    name: "Ben",
    classYear: 2026,
    rating: 3,
    dorm: "Dardick",
    dormType: "Modern Single",
    tags: ["On-Campus", "Old Building"],
    content: "It was okay, but lots of maintenance issues.",
    date: "July 2025",
  },
  {
    name: "Leo",
    classYear: 2026,
    rating: 3,
    dorm: "Koenig",
    dormType: "Traditional Double",
    tags: ["On-Campus"],
    content: "Average dorm, nothing too special.",
    date: "July 2025",
  },
  {
    name: "Grace",
    classYear: 2028,
    rating: 2,
    dorm: "Mudd",
    dormType: "Modern Single",
    tags: ["On-Campus", "Old Building"],
    content: "Great location but terrible heating system.",
    date: "July 2025",
  },
  {
    name: "Ellie",
    classYear: 2027,
    rating: 5,
    dorm: "Lien",
    dormType: "Modern Double",
    tags: ["On-Campus", "Quiet Floor"],
    content: "Super friendly community and clean facilities.",
    date: "July 2025",
  },
  {
    name: "Alex",
    classYear: 2025,
    rating: 4,
    dorm: "Umrath",
    dormType: "Modern Double",
    tags: ["On-Campus"],
    content: "Maintenance was quick and friendly.",
    date: "July 2025",
  },
  {
    name: "Morgan",
    classYear: 2026,
    rating: 5,
    dorm: "Eliot A",
    dormType: "Modern Double",
    tags: ["On-Campus", "New Building"],
    content: "Brand new facilities and spacious room.",
    date: "July 2025",
  },
];

const dormImages = allDorms.reduce((acc, dorm) => {
  acc[dorm] = [`/images/${dorm.toLowerCase().replace(/\s+/g, "-")}.jpg`];
  return acc;
}, {});

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
    "Modern Triple",
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

        {/* Filters */}
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

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filteredDorms.map((dorm) => {
            const reviews = dormGroups[dorm] || [];
            const roomType = reviews[0]?.dormType || "N/A";
            return (
              <div
                key={dorm}
                className="bg-white rounded-lg shadow cursor-pointer hover:shadow-lg transition"
                onClick={() => {
                  setSelectedDorm({ name: dorm, reviews });
                  setModalOpen(true);
                }}
              >
                <img
                  src={dormImages[dorm]?.[0] || "/images/fallback.jpg"}
                  alt={dorm}
                  className="w-full h-48 object-cover rounded-t-lg"
                />
                <div className="p-4">
                  <h2 className="text-lg font-bold">{dorm}</h2>
                  <p className="text-sm text-gray-600">{roomType}</p>
                  <p className="text-sm text-gray-500">
                    {reviews.length} student review{reviews.length !== 1 && "s"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal */}
        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          contentLabel="Dorm Details"
          style={{
            content: {
              maxWidth: "900px",
              margin: "auto",
              inset: "60px",
              borderRadius: "10px",
              padding: "20px",
            },
          }}
        >
          {selectedDorm && selectedDorm.name && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">{selectedDorm.name}</h2>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-sm text-gray-500 hover:text-gray-800"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {dormImages[selectedDorm.name]?.map((img, idx) => (
                  <img
                    key={idx}
                    src={img}
                    alt=""
                    className="w-full h-40 object-cover rounded"
                  />
                ))}
              </div>

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
            </>
          )}
        </Modal>
      </div>
    </>
  );
}

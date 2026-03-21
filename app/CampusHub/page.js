"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import ModalDorms from "../../components/ModalDorms";
import { AiFillStar } from "react-icons/ai";

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
    name: "Marcus",
    classYear: 2026,
    rating: 4,
    dorm: "Dardick",
    dormType: "Modern Single",
    tags: ["On-Campus", "Study Floor"],
    content:
      "Great location and modern amenities. The rooms are a bit small but well-designed.",
    date: "June 2025",
  },
  {
    name: "Emma",
    classYear: 2028,
    rating: 5,
    dorm: "Dardick",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Social Floor"],
    content: "Love the community here! Close to dining and great study spaces.",
    date: "May 2025",
  },
  {
    name: "James",
    classYear: 2027,
    rating: 4,
    dorm: "Dauten",
    dormType: "Modern Single",
    tags: ["On-Campus", "Quiet Floor"],
    content:
      "Perfect for studying, very quiet and clean. Great views from upper floors.",
    date: "June 2025",
  },
  {
    name: "Sarah",
    classYear: 2026,
    rating: 5,
    dorm: "Eliot A",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Historic"],
    content:
      "Classic WashU experience! Beautiful architecture and great sense of community.",
    date: "July 2025",
  },
  {
    name: "Alex",
    classYear: 2028,
    rating: 4,
    dorm: "Eliot A",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Historic"],
    content: "Love the traditional feel and central location on campus.",
    date: "May 2025",
  },
  {
    name: "Maya",
    classYear: 2027,
    rating: 5,
    dorm: "Hurd",
    dormType: "Modern Double",
    tags: ["On-Campus", "New Building"],
    content: "Brand new facilities with amazing amenities. Highly recommend!",
    date: "June 2025",
  },
  {
    name: "David",
    classYear: 2026,
    rating: 4,
    dorm: "Koenig",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Social Floor"],
    content:
      "Great social atmosphere and close to everything. Rooms are decent size.",
    date: "July 2025",
  },
  {
    name: "Rachel",
    classYear: 2028,
    rating: 5,
    dorm: "Lee",
    dormType: "Modern Single",
    tags: ["On-Campus", "Quiet Floor"],
    content: "Perfect for focused studying. Modern facilities and very clean.",
    date: "May 2025",
  },
  {
    name: "Tyler",
    classYear: 2027,
    rating: 4,
    dorm: "Lien",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Study Floor"],
    content: "Good location and solid amenities. Would live here again.",
    date: "June 2025",
  },
  {
    name: "Jessica",
    classYear: 2026,
    rating: 5,
    dorm: "Park",
    dormType: "Modern Double",
    tags: ["On-Campus", "Social Floor"],
    content:
      "Amazing community and beautiful common areas. Best dorm experience!",
    date: "July 2025",
  },
  {
    name: "Chris",
    classYear: 2028,
    rating: 4,
    dorm: "Umrath",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Central Location"],
    content: "Super convenient location. Easy access to classes and dining.",
    date: "May 2025",
  },
  {
    name: "Lauren",
    classYear: 2027,
    rating: 5,
    dorm: "Eliot B",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Historic"],
    content: "Love the historic charm and tight-knit community feel.",
    date: "June 2025",
  },
  {
    name: "Kevin",
    classYear: 2026,
    rating: 4,
    dorm: "Gregg",
    dormType: "Modern Single",
    tags: ["On-Campus", "Quiet Floor"],
    content:
      "Great for studying and very peaceful. Modern renovations are nice.",
    date: "July 2025",
  },
  {
    name: "Ashley",
    classYear: 2028,
    rating: 5,
    dorm: "Hitzeman",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Social Floor"],
    content:
      "Best social life on campus! Love my floormates and the atmosphere.",
    date: "May 2025",
  },
  {
    name: "Brandon",
    classYear: 2027,
    rating: 4,
    dorm: "Liggett",
    dormType: "Modern Single",
    tags: ["On-Campus", "Study Floor"],
    content: "Perfect for academics. Quiet environment and good study spaces.",
    date: "June 2025",
  },
  {
    name: "Megan",
    classYear: 2026,
    rating: 5,
    dorm: "Mudd",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Central Location"],
    content:
      "Great location and friendly community. Would definitely recommend.",
    date: "July 2025",
  },
  {
    name: "Nathan",
    classYear: 2028,
    rating: 4,
    dorm: "Myers",
    dormType: "Modern Double",
    tags: ["On-Campus", "New Building"],
    content: "Modern amenities and spacious rooms. Great common areas too.",
    date: "May 2025",
  },
  {
    name: "Olivia",
    classYear: 2027,
    rating: 5,
    dorm: "Nemerov",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Quiet Floor"],
    content:
      "Perfect for writers and artists. Very inspiring and peaceful environment.",
    date: "June 2025",
  },
  {
    name: "Jordan",
    classYear: 2026,
    rating: 4,
    dorm: "Rutledge",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Historic"],
    content:
      "Classic dorm experience with great traditions and community events.",
    date: "July 2025",
  },
  {
    name: "Samantha",
    classYear: 2028,
    rating: 5,
    dorm: "Shanedling",
    dormType: "Modern Single",
    tags: ["On-Campus", "Study Floor"],
    content:
      "Excellent for academics and personal growth. Very supportive community.",
    date: "May 2025",
  },
  {
    name: "Eric",
    classYear: 2027,
    rating: 4,
    dorm: "Shepley",
    dormType: "Traditional Double",
    tags: ["On-Campus", "Social Floor"],
    content:
      "Great social atmosphere and convenient location. Really enjoyed living here.",
    date: "June 2025",
  },
  {
    name: "Amanda",
    classYear: 2026,
    rating: 5,
    dorm: "SoFoHo",
    dormType: "Modern Single",
    tags: ["On-Campus", "Apartment Style"],
    content:
      "Best of both worlds - independence with campus community. Love the setup!",
    date: "July 2025",
  },
  {
    name: "Michael",
    classYear: 2028,
    rating: 4,
    dorm: "Wheeler",
    dormType: "Traditional Single",
    tags: ["On-Campus", "Quiet Floor"],
    content:
      "Great for focused study and personal reflection. Very peaceful environment.",
    date: "May 2025",
  },
  {
    name: "Nicole",
    classYear: 2027,
    rating: 5,
    dorm: "Greenway Apartments",
    dormType: "Apartment Style",
    tags: ["Off-Campus", "Independent Living"],
    content:
      "Perfect transition to independent living while staying connected to campus.",
    date: "June 2025",
  },
  {
    name: "Ryan",
    classYear: 2026,
    rating: 4,
    dorm: "Millbrook",
    dormType: "Apartment Style",
    tags: ["Off-Campus", "Quiet"],
    content:
      "Great for upperclassmen. Good balance of independence and community.",
    date: "July 2025",
  },
  {
    name: "Hannah",
    classYear: 2028,
    rating: 5,
    dorm: "University Drive",
    dormType: "Apartment Style",
    tags: ["Off-Campus", "Modern"],
    content:
      "Modern apartments with great amenities. Perfect for junior/senior year.",
    date: "May 2025",
  },
  {
    name: "Zach",
    classYear: 2027,
    rating: 4,
    dorm: "Village East",
    dormType: "Apartment Style",
    tags: ["Off-Campus", "Social"],
    content:
      "Great community feel even though it's off-campus. Really enjoyed it.",
    date: "June 2025",
  },
];

const dormImages = {};
allDorms.forEach((dorm) => {
  if (dorm && typeof dorm === "string") {
    const imageName = dorm
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "");
    dormImages[dorm] = [`/dorms/${imageName}.jpeg`];
  }
});

export default function CampusHub() {
  const [selectedType, setSelectedType] = useState("All");
  const [selectedRating, setSelectedRating] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDorm, setSelectedDorm] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const cardRefs = useRef({});

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

  // Card fade-up on scroll into view
  useEffect(() => {
    // Reset all cards to hidden whenever filteredDorms changes
    Object.values(cardRefs.current).forEach((el) => {
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateY(24px)";
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    Object.values(cardRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [filteredDorms]);

  // Prevent unwanted scrolling on filter interactions
  useEffect(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      if (
        this.tagName === "SELECT" ||
        this.tagName === "INPUT" ||
        this.tagName === "BUTTON"
      ) {
        return;
      }
      originalScrollIntoView.call(this);
    };
    return () => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    };
  }, []);

  const handleFilterFocus = (e) => { e.target.scrollIntoView = () => {}; };
  const handleFilterMouseEnter = (e) => { e.target.scrollIntoView = () => {}; };
  const handleFilterClick = (e) => { e.target.scrollIntoView = () => {}; };

  const dormTypes = [
    "Traditional Single",
    "Traditional Double",
    "Modern Single",
    "Modern Double",
  ];

  return (
    <>
      {/* ── Parallax Hero Banner ── */}
      <div
        className="relative h-72 flex items-center justify-center text-white text-center"
        style={{
          backgroundImage: "url('/dorms/beaumont.jpeg')",
          backgroundAttachment: "fixed",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 px-4">
          <p className="text-red-300 font-semibold text-sm uppercase tracking-widest mb-2">
            Washington University in St. Louis
          </p>
          <h1 className="text-5xl font-bold mb-3">On Campus Hub</h1>
          <p className="text-white/80 text-lg max-w-xl mx-auto">
            Verified reviews from real WashU students who lived there.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6" style={{ scrollBehavior: "auto" }}>
        <div
          className="flex flex-wrap gap-4 justify-center mb-8 mt-6"
          style={{ scrollMargin: 0 }}
        >
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            onFocus={handleFilterFocus}
            onMouseEnter={handleFilterMouseEnter}
            onClick={handleFilterClick}
            className="px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
            style={{ scrollMargin: 0, scrollBehavior: "auto" }}
          >
            <option value="All">Select Dorm Type</option>
            {dormTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={selectedRating}
            onChange={(e) => setSelectedRating(e.target.value)}
            onFocus={handleFilterFocus}
            onMouseEnter={handleFilterMouseEnter}
            onClick={handleFilterClick}
            className="px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
            style={{ scrollMargin: 0, scrollBehavior: "auto" }}
          >
            <option value="All">All Ratings</option>
            {[5, 4, 3, 2, 1].map((r) => (
              <option key={r} value={r}>{r} Stars</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={handleFilterFocus}
            onMouseEnter={handleFilterMouseEnter}
            onClick={handleFilterClick}
            className="px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
            style={{ scrollMargin: 0, scrollBehavior: "auto" }}
          />

          <button
            onClick={() => {
              setSelectedRating("All");
              setSelectedType("All");
              setSearchQuery("");
            }}
            onFocus={handleFilterFocus}
            onMouseEnter={handleFilterMouseEnter}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 transition-colors"
            style={{ scrollMargin: 0, scrollBehavior: "auto" }}
          >
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {filteredDorms.map((dorm, index) => {
            const dormReviews = dormGroups[dorm] || [];
            const roomType = dormReviews[0]?.dormType || "No reviews yet";
            return (
              <div
                key={dorm}
                ref={(el) => (cardRefs.current[dorm] = el)}
                className="bg-white rounded-lg shadow cursor-pointer hover:shadow-lg hover:-translate-y-1"
                style={{
                  opacity: 0,
                  transform: "translateY(24px)",
                  transition: `opacity 0.5s ease ${index * 40}ms, transform 0.5s ease ${index * 40}ms, box-shadow 0.2s ease`,
                }}
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
        <ModalDorms isOpen={modalOpen} onClose={() => setModalOpen(false)}>
          {selectedDorm && (
            <div className="flex flex-col md:flex-row gap-6 w-full h-full overflow-y-auto">
              {/* Left side */}
              <div className="w-full md:w-2/3">
                <h2 className="text-3xl font-bold mb-4">{selectedDorm.name}</h2>
                <div className="mb-6">
                  {dormImages[selectedDorm.name]?.map((img, idx) => (
                    <Image
                      key={idx}
                      src={img}
                      alt=""
                      width={800}
                      height={400}
                      className="w-full h-[250px] md:h-[300px] object-cover rounded-lg"
                      style={{ objectPosition: "center" }}
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
                  width={400}
                  height={300}
                  className="w-full h-52 object-cover rounded"
                  style={{ objectPosition: "center" }}
                />
                <div>
                  <h3 className="font-semibold mb-2 text-lg">
                    Recommended Items
                  </h3>
                  <ul className="text-sm list-disc list-inside space-y-1">
                    <li>
                      <a
                        href="https://a.co/d/3sc3sdI"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline"
                      >
                        Clip-on Fan
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://a.co/d/4cALohf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline"
                      >
                        LED Desk Lamp
                      </a>
                    </li>
                    <li>
                      <a
                        href="https://a.co/d/5MDxPZh"
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
        </ModalDorms>
      </div>
    </>
  );
}
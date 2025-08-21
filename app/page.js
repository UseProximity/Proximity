"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, useInView } from "framer-motion";
import UniversityLogosCarousel from "@/components/UniversityLogosCarousel";
import {
  Lock,
  X,
  Menu,
  Search,
  FileText,
  Send,
  MapPin,
  Users,
  DollarSign,
} from "lucide-react";
import Footer from "@/components/Footer";

// Features Overview Component
function FeaturesOverview() {
  const FEATURES = [
    {
      id: 1,
      icon: Search,
      title: "All Listings. One Platforms",
      description:
        "Access on-market, off-market, and student sublease listings—finally all in one place.",
      image: "/placeholder.svg?height=400&width=600&text=All+Listings",
    },
    {
      id: 2,
      icon: FileText,
      title: "Property & Landlord Reviews",
      description:
        "Read honest reviews from students about properties, neighborhoods, and landlords—so you know what you're walking into.",
      image: "/placeholder.svg?height=400&width=600&text=Student+Reviews",
    },
    {
      id: 3,
      icon: Send,
      title: "Student Subleasing Made Simple",
      description:
        "Skip the sketchy Facebook groups and Sidechat posts. Find or post subleases with verified student renters in seconds.",
      image: "/placeholder.svg?height=400&width=600&text=Simple+Subleasing",
    },
    {
      id: 4,
      icon: MapPin,
      title: "Student Density & Crime Heatmaps",
      description:
        "Find out which areas are safe, popular, and student-friendly - so you can make informed decisions about where to live.",
      image: "/placeholder.svg?height=400&width=600&text=Heatmaps",
    },
    {
      id: 5,
      icon: Users,
      title: "Shop With Potential Roommates",
      description:
        "Browse listings and match with roommates based on lifestyle, budget, and housing preferences.",
      image: "/placeholder.svg?height=400&width=600&text=Roommate+Matching",
    },
    {
      id: 6,
      icon: DollarSign,
      title: "Rent Comparisons You Can Trust",
      description:
        "See what similar units are going for nearby, so you never overpay or get scammed again.",
      image: "/placeholder.svg?height=400&width=600&text=Rent+Comparisons",
    },
  ];

  const getRandomStartPosition = (index) => {
    const positions = [
      { x: -400, y: -200 },
      { x: 400, y: -300 },
      { x: -500, y: 100 },
      { x: 600, y: 50 },
      { x: -300, y: 400 },
      { x: 500, y: 350 },
    ];
    return (
      positions[index] || {
        x: Math.random() * 800 - 400,
        y: Math.random() * 600 - 300,
      }
    );
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.1,
        when: "beforeChildren",
      },
    },
  };

  const magneticCardVariants = {
    hidden: (index) => {
      const startPos = getRandomStartPosition(index);
      return {
        x: startPos.x,
        y: startPos.y,
        opacity: 0,
        scale: 0.3,
        rotate: Math.random() * 360 - 180,
      };
    },
    visible: (index) => ({
      x: 0,
      y: 0,
      opacity: 1,
      scale: 1,
      rotate: 0,
      transition: {
        type: "spring",
        stiffness: 120,
        damping: 25,
        mass: 0.8,
        delay: 0,
        duration: 0.6,
      },
    }),
  };

  const badgeVariants = {
    hidden: { scale: 0, opacity: 0 },
    visible: (index) => ({
      scale: 1,
      opacity: 1,
      transition: {
        delay: 0,
        type: "spring",
        stiffness: 400,
        damping: 25,
        duration: 0.3,
      },
    }),
  };

  const floatingVariants = {
    animate: {
      y: [0, -4, 0],
      transition: {
        duration: 4,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      },
    },
  };

  const ref = useRef(null);
  const isInView = useInView(ref, {
    once: true,
    margin: "-100px",
    amount: 0.3,
  });

  return (
    <div className="w-full mt-4">
      <div className="mx-auto max-w-full px-2 md:px-4">
        <motion.div
          ref={ref}
          className="grid grid-cols-2 lg:grid-cols-3 gap-1 sm:gap-4 md:gap-8 px-2 md:px-12 py-4 md:py-8"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
        >
          {FEATURES.map((feature, index) => (
            <motion.div
              key={feature.id}
              className="group relative"
              custom={index}
              variants={magneticCardVariants}
              initial="hidden"
              animate={isInView ? "visible" : "hidden"}
              whileHover={{
                scale: 1.03,
                y: -8,
                transition: {
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                },
              }}
              style={{
                perspective: "1000px",
              }}
            >
              <motion.div
                variants={floatingVariants}
                animate={isInView ? "animate" : ""}
                style={{
                  animationDelay: "0.7s",
                }}
              >
                <motion.div
                  className="w-full h-[220px] sm:h-[260px] md:h-[320px] rounded-lg sm:rounded-xl md:rounded-3xl overflow-hidden shadow-lg border border-gray-200 cursor-pointer relative"
                  style={{
                    boxShadow:
                      "0 8px 20px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.04)",
                    background:
                      "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)",
                  }}
                  whileHover={{
                    boxShadow:
                      "0 20px 40px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.08)",
                  }}
                >
                  <motion.div
                    className="absolute -inset-1 rounded-lg sm:rounded-xl md:rounded-3xl opacity-0"
                    style={{
                      background:
                        "radial-gradient(circle at 50% 50%, rgba(220, 38, 38, 0.1) 0%, transparent 70%)",
                      filter: "blur(20px)",
                      zIndex: -1,
                    }}
                    whileHover={{
                      opacity: 0.6,
                      transition: { duration: 0.3 },
                    }}
                  />

                  <div className="absolute inset-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-gray-50/60 to-gray-100/40" />
                  </div>

                  <div className="relative z-10 p-2 sm:p-3 md:p-8 h-full flex flex-col">
                    <div className="flex items-start mb-1 sm:mb-2 md:mb-4">
                      <motion.div
                        className="w-6 h-6 sm:w-8 sm:h-8 md:w-12 md:h-12 bg-red-600 rounded-md sm:rounded-lg md:rounded-xl flex items-center justify-center shadow-sm flex-shrink-0 mt-0.5"
                        whileHover={{
                          scale: 1.1,
                          rotate: 5,
                          transition: {
                            type: "spring",
                            stiffness: 400,
                            damping: 20,
                          },
                        }}
                      >
                        <feature.icon className="w-3 h-3 sm:w-4 sm:h-4 md:w-6 md:h-6 text-white" />
                      </motion.div>

                      <div className="ml-1.5 sm:ml-2 md:ml-4 flex-1">
                        {feature.id === 1 ? (
                          <motion.h3
                            className="text-sm sm:text-base md:text-xl font-bold leading-tight text-gray-900 group-hover:text-red-600 transition-colors duration-300"
                            whileHover={{ scale: 1.02 }}
                          >
                            <span className="sm:hidden">
                              All Listings
                              <br />
                              One Platform
                            </span>
                            <span className="hidden sm:inline">
                              {feature.title}
                            </span>
                          </motion.h3>
                        ) : (
                          <motion.h3
                            className="text-sm sm:text-base md:text-xl font-bold leading-tight text-gray-900 group-hover:text-red-600 transition-colors duration-300 line-clamp-3"
                            whileHover={{ scale: 1.02 }}
                          >
                            {feature.title}
                          </motion.h3>
                        )}
                      </div>
                    </div>

                    <div className="flex-1">
                      <p className="text-sm sm:text-base md:text-lg leading-relaxed text-gray-700 line-clamp-4">
                        {feature.description}
                      </p>
                    </div>
                  </div>

                  <motion.div
                    className="absolute inset-0 bg-gradient-to-br from-red-50/0 to-red-50/0"
                    whileHover={{
                      background:
                        "linear-gradient(135deg, rgba(220, 38, 38, 0.02) 0%, rgba(220, 38, 38, 0.01) 100%)",
                      transition: { duration: 0.3 },
                    }}
                  />
                </motion.div>
              </motion.div>

              <motion.div
                className="absolute w-4 h-4 sm:w-5 sm:h-5 md:w-8 md:h-8 bg-red-600 text-white rounded-full flex items-center justify-center text-xs md:text-sm font-bold shadow-lg"
                style={{
                  top: "-2px",
                  left: "-2px",
                  zIndex: 10,
                }}
                custom={index}
                variants={badgeVariants}
                initial="hidden"
                animate={isInView ? "visible" : "hidden"}
                whileHover={{
                  scale: 1.15,
                  transition: { duration: 0.2 },
                }}
              >
                {feature.id}
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <style jsx>{`
        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .line-clamp-4 {
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}

// Student Banner Component
function StudentBanner() {
  return (
    <section className="w-full py-8 md:py-16">
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div
          className="relative rounded-2xl md:rounded-3xl p-6 md:p-12 text-center text-white shadow-2xl"
          style={{
            background:
              "linear-gradient(135deg, #dc2626 0%, #ef4444 25%, #f87171 75%, #dc2626 100%)",
            boxShadow: "0 25px 50px rgba(220, 38, 38, 0.3)",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10 rounded-2xl md:rounded-3xl" />

          <div className="relative z-10 space-y-4 md:space-y-6">
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold leading-tight">
              Made for Students, by Students
            </h2>

            <div className="space-y-1 md:space-y-2 text-base sm:text-lg md:text-xl lg:text-2xl font-light opacity-95">
              <p>
                Trusted by students at some of the world&apos;s top universities
              </p>
            </div>
          </div>

          <div
            className="absolute -inset-1 rounded-2xl md:rounded-3xl opacity-50"
            style={{
              background:
                "linear-gradient(45deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.1))",
              backgroundSize: "200% 200%",
              animation: "subtle-glow 4s ease-in-out infinite alternate",
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes subtle-glow {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: 100% 100%;
          }
        }
      `}</style>
    </section>
  );
}

// Hero Section Component
function HeroSection() {
  const [currentText, setCurrentText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  const router = useRouter();

  const phrases = useMemo(
    () => [
      "3 bed near the Loop with parking",
      "1 bed under $900 with a gym",
      "Pet-friendly sublease near campus",
      "Top-rated landlord near WashU",
      "Housing near campus with low crime",
    ],
    []
  );

  // Smart search mapping
  const searchMapping = {
    // Direct page mappings
    browse: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    listings: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    search: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    find: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    houses: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    apartments: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    properties: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    housing: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    rent: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },
    rental: {
      path: "/browse",
      title: "Browse Listings",
      description: "Find apartments and houses",
    },

    sublease: {
      path: "/add-sub-lease",
      title: "Add Sublease",
      description: "Post your sublease listing",
    },
    sublet: {
      path: "/add-sub-lease",
      title: "Add Sublease",
      description: "Post your sublease listing",
    },

    roommate: {
      path: "/roommate-finder",
      title: "Find Roommates",
      description: "Match with compatible roommates",
    },
    roommates: {
      path: "/roommate-finder",
      title: "Find Roommates",
      description: "Match with compatible roommates",
    },

    reviews: {
      path: "/CampusHub",
      title: "Campus Hub",
      description: "Read dorm and property reviews",
    },
    review: {
      path: "/CampusHub",
      title: "Campus Hub",
      description: "Read dorm and property reviews",
    },
    campus: {
      path: "/CampusHub",
      title: "Campus Hub",
      description: "Read dorm and property reviews",
    },
    dorm: {
      path: "/CampusHub",
      title: "Campus Hub",
      description: "Read dorm and property reviews",
    },
    dorms: {
      path: "/CampusHub",
      title: "Campus Hub",
      description: "Read dorm and property reviews",
    },

    dashboard: {
      path: "/dashboard/student",
      title: "Student Dashboard",
      description: "Manage your profile and favorites",
    },
    profile: {
      path: "/dashboard/student",
      title: "Student Dashboard",
      description: "Manage your profile and favorites",
    },
    account: {
      path: "/dashboard/student",
      title: "Student Dashboard",
      description: "Manage your profile and favorites",
    },

    "add listing": {
      path: "/add-listing",
      title: "Add Listing",
      description: "List your property for rent",
    },
    "list property": {
      path: "/add-listing",
      title: "Add Listing",
      description: "List your property for rent",
    },
    "add property": {
      path: "/add-listing",
      title: "Add Listing",
      description: "List your property for rent",
    },

    landlord: {
      path: "/dashboard/landlord",
      title: "Landlord Dashboard",
      description: "Manage your properties and listings",
    },
    owner: {
      path: "/dashboard/landlord",
      title: "Landlord Dashboard",
      description: "Manage your properties and listings",
    },
  };

  const performSearch = (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    const normalizedQuery = query.toLowerCase().trim();
    const results = [];

    // Check if it's a complex housing query with enhanced patterns
    const isHousingQuery = (query) => {
      const housingPatterns = [
        /\d+\s*(?:bed|bedroom|br|bdr)s?/i,
        /\d+(?:\.\d+)?\s*(?:bath|bathroom|ba)s?/i,
        /under\s*\$?\d+/i,
        /below\s*\$?\d+/i,
        /less\s+than\s*\$?\d+/i,
        /max\s*\$?\d+/i,
        /maximum\s*\$?\d+/i,
        /\$\d+\s*(?:or\s+)?(?:less|under|below|max|maximum)/i,
        /\d+\s*(?:dollar|bucks?)\s*(?:or\s+)?(?:less|under|below|max|maximum)/i,
        /(?:up\s+to|upto)\s*\$?\d+/i,
        /not\s+more\s+than\s*\$?\d+/i,
        /(?:within|around)\s*\$?\d+/i,
        /near\s+\w+/i,
        /in\s+\w+/i,
        /(?:close\s+to|by)\s+\w+/i,
        /with\s+(?:parking|gym|pool|laundry|washer|dryer|dishwasher|ac|balcony|patio)/i,
        /(?:studio|apartment|house|condo|townhouse)/i,
        /(?:pet\s*friendly|pets?\s*allowed)/i,
        /(?:furnished|unfurnished)/i,
      ];

      return housingPatterns.some((pattern) => pattern.test(query));
    };

    if (isHousingQuery(query)) {
      results.push({
        path: "/browse",
        title: "Search for: " + query,
        description: "Find listings matching your criteria",
        matchType: "housing",
        relevance: 100,
        isHousingSearch: true,
        searchQuery: query,
      });
    }

    // Direct matches
    for (const [key, value] of Object.entries(searchMapping)) {
      if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
        // Check if we already have a result with this path to avoid duplicates
        if (!results.find((r) => r.path === value.path)) {
          results.push({
            ...value,
            matchType: "direct",
            relevance: key === normalizedQuery ? 100 : 80,
          });
        }
      }
    }

    // Fuzzy matches for multi-word queries
    const words = normalizedQuery.split(" ");
    for (const [key, value] of Object.entries(searchMapping)) {
      const keyWords = key.split(" ");
      const wordMatches = words.filter((word) =>
        keyWords.some(
          (keyWord) => keyWord.includes(word) || word.includes(keyWord)
        )
      );

      if (
        wordMatches.length > 0 &&
        !results.find((r) => r.path === value.path)
      ) {
        results.push({
          ...value,
          matchType: "fuzzy",
          relevance: (wordMatches.length / words.length) * 60,
        });
      }
    }

    // If no results found, show "no results" message
    if (results.length === 0) {
      results.push({
        path: null,
        title: "No results found",
        description:
          "Try searching for browse, roommates, sublease, reviews, or housing criteria like '2 bed under $1000'",
        matchType: "none",
        relevance: 0,
        isNoResult: true,
      });
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    setSearchResults(results.slice(0, 5)); // Show top 5 results
    setShowResults(results.length > 0);
  };

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    performSearch(query);
  };

  const selectResult = (result) => {
    if (result.isNoResult) return;

    if (result.isHousingSearch) {
      // Navigate to browse with search parameters
      const searchParams = new URLSearchParams();
      searchParams.set("search", result.searchQuery);
      router.push(`${result.path}?${searchParams.toString()}`);
    } else {
      router.push(result.path);
    }
    setShowResults(false);
    setSearchQuery("");
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // Check if it's a housing search using the same enhanced function
    const isHousingQuery = (query) => {
      const housingPatterns = [
        /\d+\s*(?:bed|bedroom|br|bdr)s?/i,
        /\d+(?:\.\d+)?\s*(?:bath|bathroom|ba)s?/i,
        /under\s*\$?\d+/i,
        /below\s*\$?\d+/i,
        /less\s+than\s*\$?\d+/i,
        /max\s*\$?\d+/i,
        /maximum\s*\$?\d+/i,
        /\$\d+\s*(?:or\s+)?(?:less|under|below|max|maximum)/i,
        /\d+\s*(?:dollar|bucks?)\s*(?:or\s+)?(?:less|under|below|max|maximum)/i,
        /(?:up\s+to|upto)\s*\$?\d+/i,
        /not\s+more\s+than\s*\$?\d+/i,
        /(?:within|around)\s*\$?\d+/i,
        /near\s+\w+/i,
        /in\s+\w+/i,
        /(?:close\s+to|by)\s+\w+/i,
        /with\s+(?:parking|gym|pool|laundry|washer|dryer|dishwasher|ac|balcony|patio)/i,
        /(?:studio|apartment|house|condo|townhouse)/i,
        /(?:pet\s*friendly|pets?\s*allowed)/i,
        /(?:furnished|unfurnished)/i,
      ];

      return housingPatterns.some((pattern) => pattern.test(query));
    };

    if (isHousingQuery(searchQuery)) {
      const searchParams = new URLSearchParams();
      searchParams.set("search", searchQuery);
      router.push(`/browse?${searchParams.toString()}`);
    } else {
      // Try to find a matching page
      const normalizedQuery = searchQuery.toLowerCase().trim();
      for (const [key, value] of Object.entries(searchMapping)) {
        if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
          router.push(value.path);
          return;
        }
      }
      // Default to browse if no match
      router.push("/browse");
    }
  };

  useEffect(() => {
    const currentPhrase = phrases[currentIndex];

    const timeout = setTimeout(
      () => {
        if (isPaused) {
          setIsPaused(false);
          setIsDeleting(true);
          return;
        }

        if (!isDeleting) {
          if (currentText.length < currentPhrase.length) {
            setCurrentText(currentPhrase.slice(0, currentText.length + 1));
          } else {
            setIsPaused(true);
          }
        } else {
          if (currentText.length > 0) {
            setCurrentText(currentText.slice(0, -1));
          } else {
            setIsDeleting(false);
            setCurrentIndex((prevIndex) => (prevIndex + 1) % phrases.length);
          }
        }
      },
      isPaused ? 1500 : isDeleting ? 30 : 60
    );

    return () => clearTimeout(timeout);
  }, [currentText, currentIndex, isDeleting, isPaused, phrases]);

  return (
    <section className="w-full py-8 md:py-16">
      <div className="mx-auto max-w-4xl px-4 md:px-6">
        <div className="text-center space-y-4 md:space-y-6">
          <div className="space-y-4 md:space-y-6">
            <h1 className="text-4xl sm:text-5xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-gray-900 leading-tight">
              <div className="mb-2 md:mb-4">Find Your Perfect</div>
              <div className="inline-block relative">
                <div
                  className="inline-block px-4 py-2 md:px-7 md:py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl md:rounded-2xl shadow-lg transform hover:scale-105 transition-all duration-300"
                  style={{
                    boxShadow:
                      "0 10px 25px rgba(220, 38, 38, 0.3), 0 0 0 1px rgba(220, 38, 38, 0.1)",
                    animation: "subtle-glow 3s ease-in-out infinite alternate",
                  }}
                >
                  Student Housing
                </div>
              </div>
            </h1>
            <p className="text-base sm:text-xl md:text-2xl text-gray-600 leading-relaxed max-w-3xl mx-auto px-2">
              <span className="font-semibold">Proximity</span> is the first
              centralized platform to discover, review, and secure off-campus
              housing with confidence.
            </p>
          </div>

          <div className="pt-4 md:pt-8 space-y-4">
            <div className="relative max-w-2xl mx-auto">
              <form onSubmit={handleSearchSubmit} className="relative">
                <div
                  className="relative overflow-hidden bg-white border-2 border-gray-200 hover:border-red-300 focus-within:border-red-500 rounded-xl md:rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 p-1"
                  style={{
                    boxShadow:
                      "0 10px 25px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)",
                    backgroundColor: "#ffffff",
                    backgroundImage: "none",
                  }}
                >
                  <div className="flex items-center">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={handleSearchChange}
                        placeholder={currentText || "Search for housing..."}
                        className="w-full px-4 md:px-6 py-4 md:py-5 text-base md:text-lg bg-white border-0 outline-none placeholder-gray-500 text-gray-900"
                        style={{
                          backgroundColor: "#ffffff",
                          backgroundImage: "none",
                        }}
                        onFocus={() => setShowResults(searchResults.length > 0)}
                        onBlur={() =>
                          setTimeout(() => setShowResults(false), 200)
                        }
                      />
                    </div>

                    <button
                      type="submit"
                      className="bg-gradient-to-r from-red-600 via-red-500 to-red-600 hover:from-red-700 hover:via-red-600 hover:to-red-700 text-white px-6 py-4 md:px-8 md:py-5 text-base md:text-lg font-semibold rounded-lg md:rounded-xl transform hover:scale-105 transition-all duration-300 shadow-lg border-0 flex items-center gap-2 md:gap-3"
                      style={{
                        boxShadow: "0 8px 20px rgba(220, 38, 38, 0.3)",
                      }}
                    >
                      <svg
                        className="w-4 h-4 md:w-5 md:h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </button>
                  </div>

                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-red-50 to-transparent opacity-0 hover:opacity-30 transform -skew-x-12 -translate-x-full hover:translate-x-full transition-all duration-1000 pointer-events-none"
                    style={{ width: "50%" }}
                  />
                </div>

                {/* Search Results Dropdown */}
                {showResults && searchResults.length > 0 && (
                  <div className="absolute top-full mt-2 w-full bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                    {searchResults.map((result, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => selectResult(result)}
                        className={`w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors duration-200 flex items-center justify-between ${
                          result.isNoResult
                            ? "cursor-default hover:bg-white"
                            : ""
                        }`}
                        disabled={result.isNoResult}
                      >
                        <div>
                          <div
                            className={`font-medium ${
                              result.isNoResult
                                ? "text-gray-500"
                                : "text-gray-900"
                            }`}
                          >
                            {result.title}
                          </div>
                          <div className="text-sm text-gray-500">
                            {result.description}
                          </div>
                        </div>
                        {!result.isNoResult && (
                          <svg
                            className="w-4 h-4 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </form>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center max-w-lg mx-auto">
              <button
                onClick={() => router.push("/browse")}
                className="w-full sm:w-auto bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white px-6 py-3 rounded-xl font-semibold text-base shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
                style={{
                  boxShadow: "0 10px 25px rgba(220, 38, 38, 0.3)",
                }}
              >
                Explore the Map
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </button>

              <button
                className="w-full sm:w-auto bg-white hover:bg-gray-50 text-red-600 border-2 border-red-600 hover:border-red-700 px-6 py-3 rounded-xl font-semibold text-base shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-300 flex items-center justify-center gap-2"
                onClick={() => router.push("/CampusHub")}
                style={{
                  backgroundColor: "#ffffff",
                  backgroundImage: "none",
                }}
              >
                Explore Campus Hub
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 8l4 4m0 0l-4 4m4-4H3"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <FeaturesOverview />
      <StudentBanner />
      <UniversityLogosCarousel />

      <style jsx>{`
        @keyframes subtle-glow {
          0% {
            box-shadow: 0 10px 25px rgba(220, 38, 38, 0.3),
              0 0 0 1px rgba(220, 38, 38, 0.1);
          }
          100% {
            box-shadow: 0 15px 35px rgba(220, 38, 38, 0.4),
              0 0 20px rgba(220, 38, 38, 0.2);
          }
        }

        @keyframes button-glow {
          0% {
            box-shadow: 0 20px 40px rgba(220, 38, 38, 0.4),
              0 0 0 1px rgba(220, 38, 38, 0.1),
              inset 0 1px 0 rgba(255, 255, 255, 0.2);
          }
          100% {
            box-shadow: 0 25px 50px rgba(220, 38, 38, 0.5),
              0 0 30px rgba(220, 38, 38, 0.3),
              inset 0 1px 0 rgba(255, 255, 255, 0.3);
          }
        }
      `}</style>
    </section>
  );
}

// Main Landing Page Component
export default function ProximityLandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <main>
        <HeroSection />
      </main>
      <Footer />
    </div>
  );
}

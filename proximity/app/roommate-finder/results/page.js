"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import Modal from "../../../components/Modal";
import { AiFillHeart, AiOutlineHeart } from "react-icons/ai";
import { BsShieldCheck } from "react-icons/bs";

// Mock data - 61 roommate profiles
const mockProfiles = [
  {
    _id: "1",
    name: "Emma Chen",
    age: 20,
    gender: "Female",
    email: "emma.chen@wustl.edu",
    phone: "(314) 555-0123",
    image: "/images/default-profile.jpg",
    bio: "Junior studying Computer Science. Love hiking, cooking, and Netflix. Looking for a clean, friendly roommate!",
    budget: { min: 800, max: 1200 },
    pets: "No",
    smoking: "No",
    ac: "Required",
    verified: true,
    cleanliness: "Very Clean",
    socialLevel: "Moderately Social",
    sleepSchedule: "Early Bird",
    studyHabits: "Quiet Study",
    interests: ["Hiking", "Cooking", "Reading", "Photography"],
    contactPreference: "Both",
  },
  {
    _id: "2",
    name: "Marcus Johnson",
    age: 21,
    gender: "Male",
    email: "marcus.j@wustl.edu",
    phone: "(314) 555-0124",
    image: "/images/default-profile.jpg",
    bio: "Senior in Business. Play intramural basketball and love gaming. Pretty chill roommate!",
    budget: { min: 700, max: 1000 },
    pets: "No Preference",
    smoking: "No",
    ac: "Preferred",
    verified: false,
    cleanliness: "Moderately Clean",
    socialLevel: "Very Social",
    sleepSchedule: "Night Owl",
    studyHabits: "Social Study",
    interests: ["Basketball", "Gaming", "Movies", "Sports"],
    contactPreference: "Text",
  },
  {
    _id: "3",
    name: "Sarah Mitchell",
    age: 19,
    gender: "Female",
    email: "sarah.m@wustl.edu",
    phone: "(314) 555-0125",
    image: "/images/default-profile.jpg",
    bio: "Sophomore studying Biology. Pre-med student who loves yoga and organic food.",
    budget: { min: 900, max: 1300 },
    pets: "Yes",
    smoking: "No",
    ac: "Required",
    verified: true,
    cleanliness: "Very Clean",
    socialLevel: "Quiet",
    sleepSchedule: "Early Bird",
    studyHabits: "Quiet Study",
    interests: ["Yoga", "Cooking", "Studying", "Nature"],
    contactPreference: "Email",
  },
];

// Generate additional mock profiles to reach 30
const generateMockProfiles = () => {
  const names = [
    "Alex Taylor",
    "Jordan Davis",
    "Casey Brown",
    "Riley Wilson",
    "Avery Garcia",
    "Cameron Lee",
    "Morgan Smith",
    "Quinn Johnson",
    "Blake Miller",
    "Taylor Brown",
    "Sage Wilson",
    "River Jones",
    "Skylar Garcia",
    "Rowan Martinez",
    "Phoenix Anderson",
    "Dakota White",
    "Parker Thompson",
    "Jamie Clark",
    "Emery Lewis",
    "Reese Walker",
    "Finley Hall",
    "Drew Allen",
    "Ryan Young",
    "Casey King",
    "Hayden Wright",
    "Logan Lopez",
    "Carter Hill",
    "Peyton Scott",
    "Avery Green",
    "Cameron Adams",
    "Morgan Baker",
    "Quinn Turner",
    "Blake Roberts",
    "Taylor Phillips",
    "Sage Campbell",
    "River Parker",
    "Skylar Evans",
    "Rowan Edwards",
    "Phoenix Collins",
    "Dakota Stewart",
    "Parker Sanchez",
    "Jamie Morris",
    "Emery Rogers",
    "Reese Reed",
    "Finley Cook",
    "Drew Bailey",
    "Ryan Rivera",
    "Casey Cooper",
    "Hayden Richardson",
    "Logan Cox",
    "Carter Ward",
    "Peyton Torres",
    "Avery Peterson",
    "Cameron Gray",
    "Morgan Ramirez",
    "Quinn James",
    "Blake Watson",
    "Taylor Brooks",
  ];
  const genders = ["Male", "Female", "Non-binary"];
  const interests = [
    "Music",
    "Art",
    "Sports",
    "Technology",
    "Travel",
    "Food",
    "Books",
    "Movies",
    "Gaming",
    "Fitness",
    "Cooking",
    "Photography",
    "Dancing",
    "Hiking",
    "Swimming",
  ];

  const additionalProfiles = [];
  for (let i = 4; i <= 61; i++) {
    additionalProfiles.push({
      _id: i.toString(),
      name: names[i - 4] || `Student ${i}`,
      age: Math.floor(Math.random() * 4) + 18, // 18-21
      gender: genders[Math.floor(Math.random() * genders.length)],
      email: `user${i}@wustl.edu`,
      phone: `(314) 555-0${i.toString().padStart(3, "0")}`,
      image: "/images/default-profile.jpg",
      bio: `${
        Math.random() > 0.5
          ? "Sophomore"
          : Math.random() > 0.5
          ? "Junior"
          : "Senior"
      } at WashU looking for a compatible roommate. ${
        Math.random() > 0.5
          ? "Love music and hanging out!"
          : "Studious but fun!"
      }`,
      budget: {
        min: Math.floor(Math.random() * 400) + 600,
        max: Math.floor(Math.random() * 600) + 1000,
      },
      pets: ["Yes", "No", "No Preference"][Math.floor(Math.random() * 3)],
      smoking: ["Yes", "No", "No Preference"][Math.floor(Math.random() * 3)],
      ac: ["Required", "Preferred", "No Preference"][
        Math.floor(Math.random() * 3)
      ],
      verified: Math.random() > 0.3,
      cleanliness: ["Very Clean", "Moderately Clean", "Relaxed"][
        Math.floor(Math.random() * 3)
      ],
      socialLevel: ["Very Social", "Moderately Social", "Quiet"][
        Math.floor(Math.random() * 3)
      ],
      sleepSchedule: ["Early Bird", "Night Owl", "Flexible"][
        Math.floor(Math.random() * 3)
      ],
      studyHabits: ["Quiet Study", "Group Study", "Music While Studying"][
        Math.floor(Math.random() * 3)
      ],
      interests: interests.slice(0, Math.floor(Math.random() * 4) + 2),
      contactPreference: ["Email", "Phone", "Both"][
        Math.floor(Math.random() * 3)
      ],
    });
  }
  return additionalProfiles;
};

const allProfiles = [...mockProfiles, ...generateMockProfiles()];

export default function RoommateResults() {
  const searchParams = useSearchParams();
  const [profiles] = useState(allProfiles);
  const [filteredProfiles, setFilteredProfiles] = useState(allProfiles);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [favorites, setFavorites] = useState(new Set());

  // Get filters from URL parameters
  const [filters, setFilters] = useState({
    gender: searchParams.get("gender") || "",
    ageMin: searchParams.get("ageMin") || "",
    ageMax: searchParams.get("ageMax") || "",
    budgetMin: searchParams.get("budgetMin") || "",
    budgetMax: searchParams.get("budgetMax") || "",
    pets: searchParams.get("pets") || "",
    smoking: searchParams.get("smoking") || "",
    ac: searchParams.get("ac") || "",
    cleanliness: searchParams.get("cleanliness") || "",
    socialLevel: searchParams.get("socialLevel") || "",
    sleepSchedule: searchParams.get("sleepSchedule") || "",
    studyHabits: searchParams.get("studyHabits") || "",
    interests: searchParams.get("interests")
      ? searchParams.get("interests").split(",")
      : [],
  });

  // Calculate compatibility percentage for each profile
  const calculateMatchPercentage = (profile, userFilters) => {
    let totalCriteria = 0;
    let matchedCriteria = 0;

    // Gender match
    if (userFilters.gender) {
      totalCriteria++;
      if (profile.gender === userFilters.gender) matchedCriteria++;
    }

    // Age range match
    if (userFilters.ageMin || userFilters.ageMax) {
      totalCriteria++;
      const ageMin = userFilters.ageMin ? parseInt(userFilters.ageMin) : 0;
      const ageMax = userFilters.ageMax ? parseInt(userFilters.ageMax) : 100;
      if (profile.age >= ageMin && profile.age <= ageMax) matchedCriteria++;
    }

    // Budget compatibility
    if (userFilters.budgetMin || userFilters.budgetMax) {
      totalCriteria++;
      const userBudgetMin = userFilters.budgetMin
        ? parseInt(userFilters.budgetMin)
        : 0;
      const userBudgetMax = userFilters.budgetMax
        ? parseInt(userFilters.budgetMax)
        : 10000;

      // Check if budgets overlap
      const budgetOverlap = !(
        profile.budget.max < userBudgetMin || profile.budget.min > userBudgetMax
      );
      if (budgetOverlap) matchedCriteria++;
    }

    // Exact preference matches
    const exactMatchFields = [
      "pets",
      "smoking",
      "ac",
      "cleanliness",
      "socialLevel",
      "sleepSchedule",
      "studyHabits",
    ];
    exactMatchFields.forEach((field) => {
      if (userFilters[field]) {
        totalCriteria++;
        if (
          profile[field] === userFilters[field] ||
          profile[field] === "No Preference"
        ) {
          matchedCriteria++;
        }
      }
    });

    // Interests match (partial credit)
    if (userFilters.interests.length > 0) {
      totalCriteria++;
      const commonInterests = userFilters.interests.filter((interest) =>
        profile.interests.includes(interest)
      );
      const interestMatch =
        commonInterests.length / userFilters.interests.length;
      matchedCriteria += interestMatch;
    }

    return totalCriteria > 0
      ? Math.round((matchedCriteria / totalCriteria) * 100)
      : 0;
  };

  // Apply filters with percentage matching (60% threshold)
  useEffect(() => {
    const profilesWithMatches = profiles.map((profile) => ({
      ...profile,
      matchPercentage: calculateMatchPercentage(profile, filters),
    }));

    // Filter profiles with at least 60% match
    let filtered = profilesWithMatches.filter(
      (profile) => profile.matchPercentage >= 60
    );

    // Sort by match percentage (highest first)
    filtered.sort((a, b) => b.matchPercentage - a.matchPercentage);
    setFilteredProfiles(filtered);
  }, [filters, profiles]);

  const toggleFavorite = (profileId) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(profileId)) {
      newFavorites.delete(profileId);
    } else {
      newFavorites.add(profileId);
    }
    setFavorites(newFavorites);
  };

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto p-6">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-4">Potential Roommates</h1>
            <p className="text-gray-600 mb-4">
              Based on your preferences, we found {filteredProfiles.length}{" "}
              compatible roommates with 60%+ compatibility
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-blue-800 text-sm">
                ✨ Smart Matching: Profiles are sorted by compatibility
                percentage and only shown if they match at least 60% of your
                preferences
              </p>
            </div>

            {/* Filter Summary */}
            <div className="bg-white rounded-lg shadow-md p-4 mb-6">
              <h3 className="font-semibold mb-2">Your Preferences:</h3>
              <div className="flex flex-wrap gap-2 text-sm">
                {filters.gender && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Gender: {filters.gender}
                  </span>
                )}
                {(filters.ageMin || filters.ageMax) && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Age: {filters.ageMin || "Any"} - {filters.ageMax || "Any"}
                  </span>
                )}
                {(filters.budgetMin || filters.budgetMax) && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Budget: ${filters.budgetMin || "Any"} - $
                    {filters.budgetMax || "Any"}
                  </span>
                )}
                {filters.pets && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Pets: {filters.pets}
                  </span>
                )}
                {filters.smoking && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Smoking: {filters.smoking}
                  </span>
                )}
                {filters.ac && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    A/C: {filters.ac}
                  </span>
                )}
                {filters.cleanliness && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Cleanliness: {filters.cleanliness}
                  </span>
                )}
                {filters.socialLevel && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Social: {filters.socialLevel}
                  </span>
                )}
                {filters.sleepSchedule && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Sleep: {filters.sleepSchedule}
                  </span>
                )}
                {filters.interests.length > 0 && (
                  <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                    Interests: {filters.interests.join(", ")}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Profile Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredProfiles.map((profile) => (
              <div
                key={profile._id}
                className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition cursor-pointer"
                onClick={() => {
                  setSelectedProfile(profile);
                  setModalOpen(true);
                }}
              >
                <div className="relative">
                  <img
                    src={profile.image}
                    alt={profile.name}
                    className="w-full h-48 object-cover"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(profile._id);
                    }}
                    className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:bg-gray-50"
                  >
                    {favorites.has(profile._id) ? (
                      <AiFillHeart className="text-red-500" />
                    ) : (
                      <AiOutlineHeart className="text-gray-600" />
                    )}
                  </button>
                  {profile.verified && (
                    <div className="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded-full text-xs flex items-center">
                      <BsShieldCheck className="mr-1" />
                      Verified
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-lg">{profile.name}</h3>
                    <div
                      className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        profile.matchPercentage >= 90
                          ? "bg-green-100 text-green-800"
                          : profile.matchPercentage >= 80
                          ? "bg-blue-100 text-blue-800"
                          : profile.matchPercentage >= 70
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-orange-100 text-orange-800"
                      }`}
                    >
                      {profile.matchPercentage}% Match
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm">
                    {profile.age} years old • {profile.gender}
                  </p>
                  <p className="text-gray-700 text-sm mt-2 line-clamp-2">
                    {profile.bio}
                  </p>

                  <div className="mt-3 space-y-1">
                    <div className="flex flex-wrap gap-1">
                      <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                        ${profile.budget.min}-${profile.budget.max}
                      </span>
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs">
                        {profile.cleanliness}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                        {profile.socialLevel}
                      </span>
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                        {profile.sleepSchedule}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex flex-wrap gap-1">
                      {profile.interests.slice(0, 2).map((interest, idx) => (
                        <span
                          key={idx}
                          className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs"
                        >
                          {interest}
                        </span>
                      ))}
                      {profile.interests.length > 2 && (
                        <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs">
                          +{profile.interests.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredProfiles.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg mb-4">
                No roommates match your current preferences.
              </p>
              <p className="text-gray-400 mb-6">
                Try adjusting your criteria or go back to update your
                preferences.
              </p>
              <button
                onClick={() => window.history.back()}
                className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700"
              >
                Back to Preferences
              </button>
            </div>
          )}

          {/* Profile Modal */}
          {selectedProfile && (
            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
              <div className="space-y-4">
                {/* Profile Header with Image */}
                <div className="flex gap-4">
                  {/* Profile Image */}
                  <div className="w-24 h-24 flex-shrink-0">
                    <img
                      src={selectedProfile.image}
                      alt={selectedProfile.name}
                      className="w-full h-full object-cover rounded-lg"
                    />
                  </div>

                  {/* Header Info */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-xl font-bold">
                          {selectedProfile.name}
                        </h2>
                        <p className="text-gray-600 text-base">
                          {selectedProfile.age} years old •{" "}
                          {selectedProfile.gender}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <div
                            className={`px-3 py-1 rounded-full text-sm font-semibold ${
                              selectedProfile.matchPercentage >= 90
                                ? "bg-green-100 text-green-800"
                                : selectedProfile.matchPercentage >= 80
                                ? "bg-blue-100 text-blue-800"
                                : selectedProfile.matchPercentage >= 70
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-orange-100 text-orange-800"
                            }`}
                          >
                            {selectedProfile.matchPercentage}% Match
                          </div>
                          {selectedProfile.verified && (
                            <div className="flex items-center text-green-600">
                              <BsShieldCheck className="mr-1 text-sm" />
                              <span className="text-sm">Verified</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFavorite(selectedProfile._id)}
                        className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"
                      >
                        {favorites.has(selectedProfile._id) ? (
                          <AiFillHeart className="text-red-500 text-lg" />
                        ) : (
                          <AiOutlineHeart className="text-gray-600 text-lg" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-3">
                  <button className="bg-red-600 text-white py-3 px-4 rounded-lg text-base font-semibold hover:bg-red-700 transition">
                    Add Friend
                  </button>
                  <button className="border border-red-600 text-red-600 py-3 px-4 rounded-lg text-base font-semibold hover:bg-red-50 transition">
                    Contact
                  </button>
                </div>

                {/* Two Column Layout for Content */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {/* Left Column */}
                  <div className="space-y-3">
                    {/* About */}
                    <div>
                      <h3 className="font-semibold text-base mb-2">About</h3>
                      <p className="text-gray-700 text-sm leading-relaxed">
                        {selectedProfile.bio}
                      </p>
                    </div>

                    {/* Budget */}
                    <div>
                      <h3 className="font-semibold text-base mb-2">Budget</h3>
                      <p className="text-gray-700 text-sm">
                        ${selectedProfile.budget.min} - $
                        {selectedProfile.budget.max}/month
                      </p>
                    </div>

                    {/* Contact */}
                    <div>
                      <h3 className="font-semibold text-base mb-2">Contact</h3>
                      <div className="space-y-1 text-sm">
                        <p className="text-gray-700">
                          📧 {selectedProfile.email}
                        </p>
                        <p className="text-gray-700">
                          📱 {selectedProfile.phone}
                        </p>
                        <p className="text-gray-700">
                          💬 {selectedProfile.contactPreference}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Right Column */}
                  <div className="space-y-2">
                    {/* Preferences Grid */}
                    <div>
                      <h3 className="font-semibold text-sm mb-1">
                        Preferences
                      </h3>
                      <div className="grid grid-cols-1 gap-1">
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">Smoking:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.smoking}
                          </span>
                        </div>
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">Clean:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.cleanliness}
                          </span>
                        </div>
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">Pets:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.pets}
                          </span>
                        </div>
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">A/C:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.ac}
                          </span>
                        </div>
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">Social:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.socialLevel}
                          </span>
                        </div>
                        <div className="bg-gray-50 p-1.5 rounded">
                          <span className="font-medium text-xs">Sleep:</span>
                          <span className="text-gray-600 text-xs ml-1">
                            {selectedProfile.sleepSchedule}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interests - Full Width */}
                <div>
                  <h3 className="font-semibold text-base mb-2">Interests</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedProfile.interests.map((interest, idx) => (
                      <span
                        key={idx}
                        className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm"
                      >
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Modal>
          )}
        </div>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/Header";

export default function RoommateFinder() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    gender: "",
    ageMin: "",
    ageMax: "",
    budgetMin: "",
    budgetMax: "",
    pets: "",
    smoking: "",
    ac: "",
    cleanliness: "",
    socialLevel: "",
    sleepSchedule: "",
    studyHabits: "",
    interests: [],
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleInterestChange = (interest) => {
    setFormData((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Navigate to results page with filters as query params
    const queryParams = new URLSearchParams();
    Object.keys(formData).forEach((key) => {
      if (Array.isArray(formData[key])) {
        queryParams.set(key, formData[key].join(","));
      } else if (formData[key]) {
        queryParams.set(key, formData[key]);
      }
    });
    router.push(`/roommate-finder/results?${queryParams.toString()}`);
  };

  const interestOptions = [
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
  ];

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Find Your Perfect Roommate
            </h1>
            <p className="text-gray-600 mb-8">
              Fill out your preferences to find compatible roommates
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Basic Preferences */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Preferred Gender
                  </label>
                  <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">Any</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Age Range
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      name="ageMin"
                      placeholder="Min"
                      value={formData.ageMin}
                      onChange={handleInputChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <input
                      type="number"
                      name="ageMax"
                      placeholder="Max"
                      value={formData.ageMax}
                      onChange={handleInputChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              </div>

              {/* Budget Range */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Budget Range (per month)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    type="number"
                    name="budgetMin"
                    placeholder="Minimum budget"
                    value={formData.budgetMin}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                  <input
                    type="number"
                    name="budgetMax"
                    placeholder="Maximum budget"
                    value={formData.budgetMax}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              {/* Lifestyle Preferences */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Pets
                  </label>
                  <select
                    name="pets"
                    value={formData.pets}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Yes">Pet Friendly</option>
                    <option value="No">No Pets</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Smoking
                  </label>
                  <select
                    name="smoking"
                    value={formData.smoking}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Yes">Smoking OK</option>
                    <option value="No">Non-Smoking</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Air Conditioning
                  </label>
                  <select
                    name="ac"
                    value={formData.ac}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Required">Required</option>
                    <option value="Preferred">Preferred</option>
                  </select>
                </div>
              </div>

              {/* Living Style */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Cleanliness Level
                  </label>
                  <select
                    name="cleanliness"
                    value={formData.cleanliness}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Very Clean">Very Clean</option>
                    <option value="Moderately Clean">Moderately Clean</option>
                    <option value="Relaxed">Relaxed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Social Level
                  </label>
                  <select
                    name="socialLevel"
                    value={formData.socialLevel}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Very Social">Very Social</option>
                    <option value="Moderately Social">Moderately Social</option>
                    <option value="Quiet">Quiet</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sleep Schedule
                  </label>
                  <select
                    name="sleepSchedule"
                    value={formData.sleepSchedule}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="">No Preference</option>
                    <option value="Early Bird">Early Bird</option>
                    <option value="Night Owl">Night Owl</option>
                    <option value="Flexible">Flexible</option>
                  </select>
                </div>
              </div>

              {/* Study Habits */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Study Habits
                </label>
                <select
                  name="studyHabits"
                  value={formData.studyHabits}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">No Preference</option>
                  <option value="Quiet Study">Quiet Study</option>
                  <option value="Group Study">Group Study</option>
                  <option value="Music While Studying">
                    Music While Studying
                  </option>
                </select>
              </div>

              {/* Interests */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Interests (select all that apply)
                </label>
                <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
                  {interestOptions.map((interest) => (
                    <label key={interest} className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.interests.includes(interest)}
                        onChange={() => handleInterestChange(interest)}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">
                        {interest}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-center pt-6">
                <button
                  type="submit"
                  className="bg-red-600 text-white px-12 py-3 rounded-lg font-semibold text-lg hover:bg-red-700 transition duration-200 shadow-lg"
                >
                  Find Roommates
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

"use client";
import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import SavedListingsSection from "@/components/SavedListingsSection";

export default function StudentDashboard() {
  const [defaultStudent, setDefaultStudent] = useState(null);
  const [studentListings, setStudentListings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStudentData();
  }, []);

  const fetchStudentData = async () => {
    try {
      const response = await fetch("/api/student/dashboard");
      if (response.ok) {
        const data = await response.json();
        setDefaultStudent(data.student);
        setStudentListings(data.listings);
      }
    } catch (error) {
      console.error("Error fetching student data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <>
        <Header />
        <main className="max-w-4xl mx-auto p-6 mt-10">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
          </div>
        </main>
      </>
    );
  }

  if (!defaultStudent) {
    return (
      <>
        <Header />
        <main className="max-w-4xl mx-auto p-6 mt-10">
          <div className="text-center py-8">
            <p className="text-gray-500">Error loading student data</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto p-6 mt-10 space-y-6">
        {/* Editable Profile Card */}
        <div className="bg-white p-6 rounded-lg shadow-md flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{defaultStudent.name}</h1>
            <p className="text-gray-600 text-sm mt-1">
              {defaultStudent.description}
            </p>
            <p className="text-gray-400 text-sm">
              {defaultStudent.age} years old • {defaultStudent.gender}
            </p>
            <p className="text-gray-500 text-sm mt-1">
              📞 {defaultStudent.phone} • ✉️ {defaultStudent.email}
            </p>
            <button className="mt-3 px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600">
              Edit Profile
            </button>
          </div>
          <img
            src={defaultStudent.image}
            alt={defaultStudent.name}
            className="w-20 h-20 rounded-full object-cover"
          />
        </div>

        {/* Reputation Card (Read-Only) */}
        <div className="bg-gray-50 p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Your Reputation
          </h2>
          <div className="text-yellow-500 text-lg">
            {"★".repeat(defaultStudent.rating)}
            <span className="text-gray-300">
              {"★".repeat(5 - defaultStudent.rating)}
            </span>
          </div>
          <p className="text-gray-500 text-sm">
            {studentListings.length} active listings
          </p>
        </div>

        {/* Dashboard Section */}
        <h1 className="text-3xl font-bold text-red-600">Student Dashboard</h1>
        <p className="text-gray-700">
          Welcome, student! Here you can view saved listings and your reviews.
        </p>

        <div className="space-y-4">
          {/* Saved Listings Section */}
          <SavedListingsSection />

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">
              Roommate Profile
            </h2>
            <p className="text-gray-500 mb-3">
              Manage your roommate finder profile and preferences.
            </p>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 text-sm">
                Edit Profile
              </button>
              <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm">
                View Public Profile
              </button>
              <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm">
                Browse Roommates
              </button>
            </div>
          </div>

          <div className="p-4 bg-white border rounded-lg shadow-sm">
            <h2 className="text-lg font-semibold text-red-500">Reviews</h2>
            <p className="text-gray-500">
              Any reviews you&apos;ve made will be shown here.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

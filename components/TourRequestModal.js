"use client";
import React, { useState } from "react";
import Image from "next/image";
import Modal from "./Modal";

export default function TourRequestModal({
  isOpen,
  onClose,
  onConfirm,
  listing,
}) {
  const [selectedDates, setSelectedDates] = useState([]);
  const [selectedTime, setSelectedTime] = useState("11:00 am");
  const [currentWeekStart, setCurrentWeekStart] = useState(new Date());

  // Get current date for displaying week
  const getWeekDates = (startDate) => {
    const dates = [];
    const date = new Date(startDate);
    for (let i = 0; i < 7; i++) {
      dates.push(new Date(date));
      date.setDate(date.getDate() + 1);
    }
    return dates;
  };

  const weekDates = getWeekDates(currentWeekStart);

  const formatDate = (date) => {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return {
      day: days[date.getDay()],
      month: months[date.getMonth()],
      date: date.getDate(),
    };
  };

  const isDateSelected = (date) => {
    return selectedDates.some(
      (selected) => selected.toDateString() === date.toDateString()
    );
  };

  const toggleDate = (date) => {
    if (selectedDates.length >= 3 && !isDateSelected(date)) return;

    if (isDateSelected(date)) {
      setSelectedDates(
        selectedDates.filter(
          (selected) => selected.toDateString() !== date.toDateString()
        )
      );
    } else {
      setSelectedDates([...selectedDates, date]);
    }
  };

  const goToPreviousWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentWeekStart(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentWeekStart(newDate);
  };

  const handleNext = () => {
    if (selectedDates.length > 0) {
      onConfirm({
        dates: selectedDates,
        time: selectedTime,
        listing: listing,
      });
    }
  };

  const timeOptions = [
    "9:00 am",
    "9:30 am",
    "10:00 am",
    "10:30 am",
    "11:00 am",
    "11:30 am",
    "12:00 pm",
    "12:30 pm",
    "1:00 pm",
    "1:30 pm",
    "2:00 pm",
    "2:30 pm",
    "3:00 pm",
    "3:30 pm",
    "4:00 pm",
    "4:30 pm",
    "5:00 pm",
    "5:30 pm",
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="w-full max-w-lg mx-auto max-h-[90vh] overflow-y-auto">
        {/* Header with gradient background */}
        <div className="bg-gradient-to-r from-red-500 to-red-600 text-white p-4 rounded-t-lg sticky top-0 z-10">
          <h2 className="text-2xl font-bold mb-2">Schedule Your Visit</h2>
          <p className="text-red-100">Book a personalized property tour</p>
        </div>

        <div className="p-4 bg-white overflow-hidden">
          {/* Property Card - Different Layout */}
          <div className="bg-gradient-to-r from-gray-50 to-red-50 border-l-4 border-red-500 p-4 rounded-lg mb-6">
            <div className="flex flex-col space-y-4">
              <div className="flex items-center space-x-4">
                <div className="w-20 h-20 bg-gray-200 rounded-xl overflow-hidden shadow-md flex-shrink-0">
                  <Image
                    src={listing?.images?.[0] || "/images/beaumont.jpg"}
                    alt="Property"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-bold text-gray-900">
                    {listing?.address || "Property Address"}
                  </h3>
                  <p className="text-gray-600 font-medium">
                    {listing?.city || "City"}, {listing?.state || "State"}{" "}
                    {listing?.zipCode || "ZIP"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">
                  {listing?.bedrooms || 2} Bedrooms
                </span>
                <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">
                  {listing?.bathrooms || 1} Bathrooms
                </span>
                <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-semibold">
                  {listing?.area || 864} sqft
                </span>
              </div>
            </div>
          </div>

          {/* Description with different styling */}
          <div className="flex items-start space-x-4 mb-8 p-5 bg-red-50 border border-red-200 rounded-xl">
            <div className="w-10 h-10 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg
                className="w-5 h-5 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-gray-900 mb-1">
                Expert Guided Tour
              </h4>
              <p className="text-gray-700">
                Connect with a knowledgeable local agent for a comprehensive
                property walkthrough
              </p>
            </div>
          </div>

          {/* Date Selection with improved layout */}
          <div className="mb-8">
            <h4 className="text-xl font-bold text-gray-900 mb-2">
              Choose Your Preferred Dates
            </h4>
            <p className="text-gray-600 mb-6">
              Select up to 3 available time slots
            </p>

            {/* Week Navigation with different styling */}
            <div className="flex items-center justify-between mb-6 bg-gray-50 p-4 rounded-xl">
              <button
                onClick={goToPreviousWeek}
                className="p-3 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors border border-gray-200"
              >
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
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>

              <div className="flex space-x-4">
                {weekDates.slice(0, 3).map((date, index) => {
                  const formatted = formatDate(date);
                  const isSelected = isDateSelected(date);
                  return (
                    <button
                      key={index}
                      onClick={() => toggleDate(date)}
                      className={`p-5 rounded-xl border-2 transition-all duration-200 transform hover:scale-105 ${
                        isSelected
                          ? "border-red-500 bg-red-500 text-white shadow-lg"
                          : "border-gray-200 hover:border-red-300 bg-white hover:bg-red-50"
                      } ${
                        selectedDates.length >= 3 && !isSelected
                          ? "opacity-50 cursor-not-allowed"
                          : ""
                      }`}
                      disabled={selectedDates.length >= 3 && !isSelected}
                    >
                      <div className="text-center">
                        <div
                          className={`text-sm font-medium ${
                            isSelected ? "text-red-100" : "text-gray-500"
                          }`}
                        >
                          {formatted.day}
                        </div>
                        <div
                          className={`text-xl font-bold ${
                            isSelected ? "text-white" : "text-gray-900"
                          }`}
                        >
                          {formatted.month} {formatted.date}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={goToNextWeek}
                className="p-3 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors border border-gray-200"
              >
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
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Time Selection with better styling */}
          <div className="mb-8">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">
              Select Time
            </h4>
            <select
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full p-4 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 text-lg font-medium bg-white"
            >
              {timeOptions.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </div>

          {/* Add Time Button with new styling */}
          <button className="flex items-center space-x-3 text-red-600 hover:text-red-700 hover:bg-red-50 p-3 rounded-xl transition-colors mb-8 group">
            <div className="w-8 h-8 bg-red-500 group-hover:bg-red-600 rounded-xl flex items-center justify-center transition-colors">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <span className="font-semibold text-lg">Add Another Time Slot</span>
          </button>

          {/* Action Buttons - Different Layout */}
          <div className="flex space-x-4">
            <button
              onClick={onClose}
              className="flex-1 py-4 px-6 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 hover:border-gray-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleNext}
              disabled={selectedDates.length === 0}
              className={`flex-1 py-4 px-6 rounded-xl font-semibold text-white transition-all transform ${
                selectedDates.length > 0
                  ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 hover:scale-105 shadow-lg"
                  : "bg-gray-300 cursor-not-allowed"
              }`}
            >
              Schedule Tour
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

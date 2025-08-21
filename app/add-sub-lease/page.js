"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";

export default function AddSubLease() {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    address: "",
    longitude: "",
    latitude: "",
    description: "",
    rent: "",
    area: "",
    bedrooms: "",
    bathrooms: "",
    images: [],
  });

  const handleChange = (e) => {
    const { name, value, files } = e.target;
    if (name === "images") {
      setFormData((prev) => ({ ...prev, images: [...files] }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isLoading) return;

    setIsLoading(true);

    // TODO from address get longitude and altitude coords

    const dataToSend = {
      ...formData,
      rent: Number(formData.rent),
      area: Number(formData.area),
      bedrooms: Number(formData.bedrooms),
      bathrooms: Number(formData.bathrooms),
      longitude: Number(formData.longitude),
      latitude: Number(formData.latitude),
      leaseType: "sublease",
      ownerId: "68877696221d6bb66c4c7c7d", // TODO always giving a fixed student id until auth resolved
    };

    try {
      await axios.post("/api/addListing", dataToSend);
      toast.success("Sub-Lease Added!");

      setFormData({
        address: "",
        longitude: "",
        latitude: "",
        description: "",
        rent: "",
        area: "",
        bedrooms: "",
        bathrooms: "",
        leaseType: "",
        images: [],
      });
    } catch (e) {
      toast.error(e?.message);
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <main className="max-w-2xl mx-auto p-6 mt-10">
        <h1 className="text-3xl font-bold text-red-600 mb-6">
          Add a Sub-Lease
        </h1>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <input
              type="text"
              name="address"
              required
              value={formData.address}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Longitude */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Longitude
            </label>
            <input
              type="number"
              name="longitude"
              required
              value={formData.longitude}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Latitude */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Latitude
            </label>
            <input
              type="number"
              name="latitude"
              required
              value={formData.latitude}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Rent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Rent ($)
            </label>
            <input
              type="number"
              name="rent"
              required
              value={formData.rent}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Area (sq ft)
            </label>
            <input
              type="number"
              name="area"
              required
              value={formData.area}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Bedrooms */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bedrooms
            </label>
            <input
              type="number"
              name="bedrooms"
              required
              value={formData.bedrooms}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Bathrooms */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bathrooms
            </label>
            <input
              type="number"
              name="bathrooms"
              required
              value={formData.bathrooms}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              name="description"
              required
              value={formData.description}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              rows={5}
            />
          </div>

          {/* Lease Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Lease Type
            </label>
            <select
              name="leaseType"
              value="sublease"
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-md bg-gray-100"
            >
              <option value="">--Select Lease Type--</option>
              <option value="twelve">12 Month Lease</option>
              <option value="nine">9 Month Lease</option>
              <option value="academic">Academic Year</option>
              <option value="sublease">Sub-Lease</option>
            </select>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Image URL
            </label>
            <input
              type="text"
              name="imageUrl"
              value={formData.images[0] || ""}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, images: [e.target.value] }))
              }
              placeholder="Enter an image URL"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>

          <button
            type="submit"
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md font-medium transition"
          >
            {isLoading && (
              <div className="flex items-center justify-center">
                <div className="w-6 h-6 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
              </div>
            )}
            Submit Sub-Lease
          </button>
        </form>
      </main>
    </>
  );
}

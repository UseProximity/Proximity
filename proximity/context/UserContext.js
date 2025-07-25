"use client";
import { createContext, useState, useEffect, useContext } from "react";

// Create the context
const UserContext = createContext();

// Hook for easy access
export const useUser = () => useContext(UserContext);

// Provider component
export function UserProvider({ children }) {
  const [role, setRole] = useState(null);

  // Optional: Load role from localStorage
  useEffect(() => {
    const storedRole = localStorage.getItem("userRole");
    if (storedRole) setRole(storedRole);
  }, []);

  // Set role and persist in localStorage
  const loginAs = (newRole) => {
    setRole(newRole);
    localStorage.setItem("userRole", newRole);
  };

  const logout = () => {
    setRole(null);
    localStorage.removeItem("userRole");
  };

  return (
    <UserContext.Provider value={{ role, loginAs, logout }}>
      {children}
    </UserContext.Provider>
  );
}

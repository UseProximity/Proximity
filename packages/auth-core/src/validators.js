export const SIGNUP_ROLES = new Set(["student", "landlord"]);

export function validateEmail(email) {
  if (!email || typeof email !== "string") return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Invalid email address.";
  return null;
}

export function validatePassword(password) {
  if (!password || typeof password !== "string") return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

export function validateName(name) {
  if (!name || typeof name !== "string" || !name.trim()) return "Name is required.";
  return null;
}

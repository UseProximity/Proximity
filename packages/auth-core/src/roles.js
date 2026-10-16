export const ROLES = {
  STUDENT: "student",
  LANDLORD: "landlord",
  SUPER: "super",
};

export function isLandlord(role) {
  return role === "landlord" || role === "super";
}

export function isSuper(role) {
  return role === "super";
}

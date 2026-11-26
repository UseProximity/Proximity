// Roles the signup form offers. Anything else falls back to student.
export const SIGNUP_ROLES = new Set(["student", "landlord"]);

// Roles a user may give themselves after signup (profile edit, profile
// completion). Privileged roles (super, admin, system) are never on this list:
// only an existing super user can grant them.
export const SELF_ASSIGNABLE_ROLES = new Set([...SIGNUP_ROLES, "parent", "other"]);

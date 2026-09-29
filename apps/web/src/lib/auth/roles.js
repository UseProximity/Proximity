// Roles a user is allowed to self-assign (at signup or via profile edit).
// Privileged roles below can only be granted by an existing super user.
export const SELF_ASSIGNABLE_ROLES = new Set(["student", "landlord"]);

export const PRIVILEGED_ROLES = new Set(["super", "admin"]);

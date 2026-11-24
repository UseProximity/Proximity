export class UserResource {
  constructor(client) {
    this.client = client;
  }

  getUser() {
    return this.client.request("/api/getUser");
  }

  updateProfile(data) {
    return this.client.request("/api/editProfile", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // The lease preferences saved on the profile: { moveIn, months, beds }, used
  // to prefill Find Your Place. See apps/web/src/app/api/account/lease-preferences/route.js.
  getLeasePreferences() {
    return this.client.request("/api/account/lease-preferences");
  }

  // Irreversible from the user's perspective: the account stops working at once
  // and its data is purged after a 30-day grace period. Callers must confirm
  // before calling. See apps/web/src/app/api/account/route.js.
  deleteAccount() {
    return this.client.request("/api/account", { method: "DELETE" });
  }
}

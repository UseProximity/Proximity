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
}

export class ListingsResource {
  constructor(client) {
    this.client = client;
  }

  getListings(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.client.request(`/api/listings${query ? `?${query}` : ""}`);
  }

  getListing(id) {
    return this.client.request(`/api/listings/${id}`);
  }

  getPopularListings() {
    return this.client.request("/api/listings/popular");
  }
}

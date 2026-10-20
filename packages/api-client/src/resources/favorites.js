export class FavoritesResource {
  constructor(client) {
    this.client = client;
  }

  getFavorites() {
    return this.client.request("/api/favorites");
  }

  addFavorite(listingId) {
    return this.client.request("/api/favorites", {
      method: "POST",
      body: JSON.stringify({ listingId }),
    });
  }

  removeFavorite(listingId) {
    return this.client.request(`/api/favorites/${listingId}`, {
      method: "DELETE",
    });
  }
}

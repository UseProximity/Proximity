import { AuthResource } from "./resources/auth.js";
import { ListingsResource } from "./resources/listings.js";
import { UserResource } from "./resources/user.js";
import { FavoritesResource } from "./resources/favorites.js";

export function createApiClient({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed }) {
  return new ApiClient({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed });
}

class ApiClient {
  constructor({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getToken = getToken;
    this.getRefreshToken = getRefreshToken ?? (() => null);
    this.onTokenExpired = onTokenExpired;
    this.onTokenRefreshed = onTokenRefreshed ?? null;

    this.auth = new AuthResource(this);
    this.listings = new ListingsResource(this);
    this.user = new UserResource(this);
    this.favorites = new FavoritesResource(this);
  }

  async request(path, options = {}) {
    const { skipAuth = false, ...fetchOptions } = options;

    const token = skipAuth ? null : await this.getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const url = this.baseUrl + path;
    let res = await fetch(url, { ...fetchOptions, headers });

    // On 401: attempt a token refresh once, then retry the original request.
    // Skip if there is no refresh token — this means the 401 is a real auth
    // failure (wrong credentials, unverified email, etc.), not an expired token.
    const refreshToken = this.getRefreshToken();
    if (res.status === 401 && !skipAuth && refreshToken) {
      try {
        const { accessToken } = await this.auth.refresh(refreshToken);
        if (this.onTokenRefreshed) await this.onTokenRefreshed(accessToken);
        const retryHeaders = { ...headers, Authorization: `Bearer ${accessToken}` };
        res = await fetch(url, { ...fetchOptions, headers: retryHeaders });
      } catch {
        await this.onTokenExpired();
        const err = new Error("Session expired");
        err.status = 401;
        throw err;
      }

      if (res.status === 401) {
        await this.onTokenExpired();
        const err = new Error("Session expired");
        err.status = 401;
        throw err;
      }
    }

    if (!res.ok) {
      let body;
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      const err = new Error(body?.error ?? `Request failed with status ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }

    return res.json();
  }
}

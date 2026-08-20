import { createListingsResource } from "./resources/listings.js";
import { createDormReviewsResource } from "./resources/dormReviews.js";
import { createTestimonialsResource } from "./resources/testimonials.js";
import { createContactLandlordResource } from "./resources/contactLandlord.js";
import { createMatchmakingResource } from "./resources/matchmaking.js";
import { createLandlordResource } from "./resources/landlord.js";
import { AuthResource } from "./resources/auth.js";
import { UserResource } from "./resources/user.js";
import { FavoritesResource } from "./resources/favorites.js";
import { UploadsResource } from "./resources/uploads.js";

// No web equivalent to port — web calls its own API routes directly via
// same-origin fetch under a cookie session (NextAuth). Mobile needs an
// explicit base URL + bearer-token attachment instead, since it's a separate
// app hitting the Next.js API cross-origin.
//
// getToken/getRefreshToken/onTokenExpired/onTokenRefreshed stay pluggable:
// when there's no logged-in user, getToken()/getRefreshToken() return null
// and requests just go out unauthenticated (used by every public resource —
// listings, dormReviews, testimonials, contactLandlord, matchmaking).
//
// testEmailTo is the mobile equivalent of web's `staging_email_to` cookie
// (the "📧 Test emails →" picker): mobile has no cookies, so it sends the
// same preference as an `x-staging-email-to` header instead. The server only
// honors it outside real production (see apps/web/src/lib/outreach.js), so
// it's inert/no-op if ever left set in a production build.
export function createApiClient({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed, testEmailTo }) {
  return new ApiClient({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed, testEmailTo });
}

class ApiClient {
  constructor({ baseUrl, getToken, getRefreshToken, onTokenExpired, onTokenRefreshed, testEmailTo }) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getToken = getToken ?? (() => null);
    this.getRefreshToken = getRefreshToken ?? (() => null);
    this.onTokenExpired = onTokenExpired ?? (() => {});
    this.onTokenRefreshed = onTokenRefreshed ?? null;
    this.testEmailTo = testEmailTo ?? null;

    this.listings = createListingsResource(this);
    this.dormReviews = createDormReviewsResource(this);
    this.testimonials = createTestimonialsResource(this);
    this.contactLandlord = createContactLandlordResource(this);
    this.matchmaking = createMatchmakingResource(this);
    this.landlord = createLandlordResource(this);
    this.auth = new AuthResource(this);
    this.user = new UserResource(this);
    this.favorites = new FavoritesResource(this);
    this.uploads = new UploadsResource(this);
  }

  async request(path, options = {}) {
    const { skipAuth = false, ...fetchOptions } = options;

    const token = skipAuth ? null : await this.getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(this.testEmailTo ? { "x-staging-email-to": this.testEmailTo } : {}),
    };

    const url = this.baseUrl + path;
    let res = await fetch(url, { ...fetchOptions, headers });

    // Only attempt a refresh-and-retry when a token was actually attached to
    // this request. A 401 on an unauthenticated request (e.g. a failed login
    // attempt, or any public resource call) is a normal request error, not a
    // "your session expired" event, and must not trigger a refresh/logout.
    if (res.status === 401 && token) {
      const refreshToken = this.getRefreshToken();
      if (refreshToken) {
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
      } else {
        await this.onTokenExpired();
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

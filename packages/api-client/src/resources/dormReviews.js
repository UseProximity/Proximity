// Wraps GET/POST /api/dormReviews (apps/web/src/app/api/dormReviews/route.js).
// Both fully public. GET accepts an optional ?dorm=<name> filter; POST requires
// name, classYear, rating (1-5), dorm, content (min 10 chars) — dormType/tags optional.
export function createDormReviewsResource(client) {
  return {
    getDormReviews: (dormName) =>
      client.request(dormName ? `/api/dormReviews?dorm=${encodeURIComponent(dormName)}` : "/api/dormReviews"),

    submitDormReview: ({ name, classYear, rating, dorm, dormType, tags, content }) =>
      client.request("/api/dormReviews", {
        method: "POST",
        body: JSON.stringify({ name, classYear, rating, dorm, dormType, tags, content }),
      }),
  };
}

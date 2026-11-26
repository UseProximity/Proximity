// Wraps GET /api/testimonials (apps/web/src/app/api/testimonials/route.js).
// Public, read-only, no params.
export function createTestimonialsResource(client) {
  return {
    getTestimonials: () => client.request("/api/testimonials"),
  };
}

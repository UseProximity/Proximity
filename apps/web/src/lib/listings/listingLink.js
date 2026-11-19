/*
 * Where a tap on a listing card goes. Below 768px the popup is too tight, so a
 * phone goes straight to the full listing page; wider screens open the
 * ?listing= popup over the page they are on (components/listings/GlobalListingModal).
 * A ?listing= address still works on a phone (the popup hands it over), but it
 * first navigates the page underneath, which scrolls it to the top and costs a
 * round trip. Cards skip that.
 */
export const isPhone = () => window.matchMedia("(max-width: 767px)").matches;

export const listingHref = (id, popupPath) =>
  isPhone() ? `/listings/${id}` : `${popupPath}?listing=${id}`;

// For a <Link> whose href is the popup address: on a phone, go to the page instead.
export function openListingPageOnPhone(event, router, id) {
  if (!isPhone()) return;
  event.preventDefault();
  router.push(`/listings/${id}`);
}

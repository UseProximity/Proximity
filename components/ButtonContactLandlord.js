export default function ContactLandlordButton({ landlordEmail }) {
  const subject = "Contacting Landlord - Proximity";
  const body = `Hi,
  
I'm interested in your property listed on Proximity.

Could you share more details?

Thanks!`;

  const ccEmail = "info@useproximity.org";

  const handleClick = () => {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const encodedCc = encodeURIComponent(ccEmail);

    window.location.href = `mailto:${landlordEmail}?cc=${encodedCc}&subject=${encodedSubject}&body=${encodedBody}`;
  };

  return (
    <button
      onClick={handleClick}
      className="bg-gradient-to-r from-red-500 to-red-700 text-white px-5 py-3 rounded-xl font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all duration-200"
    >
      Contact Landlord
    </button>
  );
}

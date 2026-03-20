export default function ContactLandlordButton({ landlordEmail }) {
  // FIXME - Put Ben text instead

  const subject = "Contacting Landlord - Proximity";
  const body = `Hi,
  
  I'm interested in your property listed on Proximity.
  
  Could you share more details?
  
  Thanks!`;

  const handleClick = () => {
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);

    window.location.href = `mailto:${landlordEmail}?subject=${encodedSubject}&body=${encodedBody}`;
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

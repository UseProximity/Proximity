/*
 * "Listed by" line for a licensed real estate agent: name, company and company
 * phone, which Missouri requires on every listing a licensee markets. `listedBy`
 * comes from the listing payload (lib/listings/getListing.js) and is only set
 * for landlords who declared a license, so this renders nothing otherwise.
 */
// (314) 555-0123 for a 10 digit US number (a leading 1 dropped), otherwise as stored.
export function formatPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(phone ?? "");
}

export default function ListedBy({ listedBy, className = "" }) {
  if (!listedBy) return null;
  const { agentName, companyName, companyPhone } = listedBy;
  const tel = String(companyPhone ?? "").replace(/\D/g, "");
  return (
    <p className={`text-[11px] leading-4 text-gray-400 ${className}`}>
      Listed by {agentName}, {companyName}
      {companyPhone && (
        <>
          {", "}
          <a href={`tel:+1${tel.slice(-10)}`} className="underline decoration-gray-300 hover:text-gray-600">
            {formatPhone(companyPhone)}
          </a>
        </>
      )}
    </p>
  );
}

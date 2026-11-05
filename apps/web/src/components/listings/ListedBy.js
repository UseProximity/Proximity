/*
 * "Listed by" line for a licensed real estate agent: name, company and company
 * phone, which Missouri requires on every listing a licensee markets. `listedBy`
 * comes from the listing payload (lib/listings/getListing.js) and is only set
 * for landlords who declared a license, so this renders nothing otherwise.
 */
export default function ListedBy({ listedBy, className = "" }) {
  if (!listedBy) return null;
  const { agentName, companyName, companyPhone } = listedBy;
  const tel = String(companyPhone ?? "").replace(/\D/g, "");
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      Listed by {agentName}, {companyName}
      {companyPhone && (
        <>
          {", "}
          <a href={`tel:+1${tel.slice(-10)}`} className="underline hover:text-gray-700">
            {companyPhone}
          </a>
        </>
      )}
    </p>
  );
}

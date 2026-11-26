/*
 * "Listed by" line for a licensed real estate agent: name, company and company
 * phone, which Missouri requires on every listing a licensee markets. `listedBy`
 * comes from the listing payload (lib/listings/getListing.js) and is only set
 * for landlords who declared a license, so this renders nothing otherwise.
 *
 * The phone is shown because the law requires it, but we want students to
 * reach out through Proximity, not call around it (Wyatt, 2026-11-06). So it
 * is not a link, and it is drawn by a CSS ::before from a data attribute:
 * pseudo-element text can't be selected, copied, found with Ctrl+F or turned
 * into a tap-to-call link by phone browsers. It is still plainly visible.
 * The whole line can't be highlighted or copied either.
 */
// (314) 555-0123 for a 10 digit US number (a leading 1 dropped), otherwise as stored.
export function formatPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : String(phone ?? "");
}

const blockCopy = (e) => e.preventDefault();

export default function ListedBy({ listedBy, className = "" }) {
  if (!listedBy) return null;
  const { agentName, companyName, companyPhone } = listedBy;
  return (
    <p
      onCopy={blockCopy}
      onCut={blockCopy}
      onContextMenu={blockCopy}
      onDragStart={blockCopy}
      className={`select-none text-[11px] leading-4 text-gray-400 ${className}`}
    >
      Listed by {agentName}, {companyName}
      {companyPhone && (
        <>
          {", "}
          <span data-p={formatPhone(companyPhone)} className="before:content-[attr(data-p)]" />
        </>
      )}
    </p>
  );
}

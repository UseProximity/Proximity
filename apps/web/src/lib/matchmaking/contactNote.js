// Single source of truth for the default note Proxy drafts to a listing's owner.
// Pre-fills the editable draft from BOTH entry points: the multi-select "reach out?"
// offer (client) and the agent's "email this owner" tool (server). The student can
// edit it before sending; the actual email uses whatever text they leave in the draft.
export function defaultInquiryNote(firstName) {
  const name = (firstName ?? "").trim();
  return (
    `I'm ${name ? `${name}, ` : ""}a WashU student using Proximity, and I'm interested in your listing. ` +
    `Is it still available? I'd love to learn more and set up a time to connect. Thanks!`
  );
}

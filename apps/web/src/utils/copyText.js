/*
 * Copies text to the clipboard and resolves to true/false. Never throws.
 *
 * navigator.clipboard.writeText rejects when the browser or a site policy
 * denies clipboard access (seen in prod on /support), and is missing entirely
 * on insecure origins. Both cases fall back to the legacy execCommand copy,
 * which still works in many of them. Callers show a manual fallback on false.
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  return legacyCopy(text);
}

function legacyCopy(text) {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.className = "fixed top-0 left-0 opacity-0 pointer-events-none";
  document.body.appendChild(textarea);
  try {
    // iOS Safari ignores select() on its own, and execCommand can still
    // report success with nothing selected, so set the range explicitly and
    // refuse to claim a copy unless the whole text really is selected.
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    if (textarea.selectionEnd - textarea.selectionStart !== text.length) return false;
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

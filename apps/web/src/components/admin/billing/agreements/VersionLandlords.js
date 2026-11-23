"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/admin/adminShared";
import { landlordName } from "@/components/admin/billing/LandlordPicker";
import { BUTTON, FIELD, PRIMARY, call, postJson } from "./shared";

/*
 * Who a custom agreement version applies to (Wyatt, 2026-11-22): a search list
 * where each landlord toggles on or off, the chosen ones as chips with what to
 * know about each (a signed agreement, another custom version, an authorized
 * signer...). Used by the upload form (`LandlordToggles`, nothing saved until
 * upload) and on each custom version (`AppliesTo`, saved with a confirmation).
 */

// The flags route takes this many ids per request.
const FLAG_BATCH = 50;

// What we know about each landlord id, refreshed when the ids change.
function useLandlordFlags(ids, tick = 0) {
  const [flags, setFlags] = useState({});
  const key = [...ids].sort().join(",");
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const all = key.split(",");
    for (let i = 0; i < all.length; i += FLAG_BATCH) {
      call(`/api/admin/billing/agreement-versions/landlord-flags?ids=${all.slice(i, i + FLAG_BATCH).join(",")}`)
        .then((r) => live && setFlags((prev) => ({ ...prev, ...(r.landlords ?? {}) })))
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [key, tick]);
  return flags;
}

/*
 * The flags for one landlord on version `versionId` of `kind` (null while uploading).
 * Returns [{ color, text, title }] plus `addSigner` when the account has an
 * authorized signer who is not chosen yet.
 */
/*
 * Whether changing this landlord's version cancels an unsigned copy they have
 * open (cancelOpenCopies): only a copy of the version's own kind, and only one
 * on another version when they are added (on this one when they are taken off).
 */
export function cancelsCopy(flag, { kind, versionId, adding }) {
  const open = flag?.openCopies?.[kind] ?? [];
  return adding ? open.some((v) => v !== versionId) : open.some((v) => v === versionId);
}

export function flagBadges(flag, { kind = "master", versionId = null, chosenIds = [] } = {}) {
  if (!flag) return { badges: [] };
  const badges = [];
  const other = flag.liveCustom?.[kind];
  if (other && other.versionId !== versionId) {
    badges.push({ color: "amber", text: `On custom: ${other.label ?? "another version"}`, title: "Making this live for them replaces that custom version." });
  }
  if (flag.signed) {
    if (versionId && flag.signed.versionId === versionId) badges.push({ color: "green", text: "Signed this" });
    else badges.push({ color: "blue", text: `Signed ${flag.signed.custom ? "custom" : "standard"}${flag.signed.label ? `: ${flag.signed.label}` : ""}`, title: "Their signed agreement keeps counting. Their dashboard asks them to sign the new one." });
  }
  if (flag.inProgress) badges.push({ color: "amber", text: "Signing in progress", title: "If their version changes, the open copy is cancelled right away." });
  if (flag.paperOut) badges.push({ color: "amber", text: "Paper copy out", title: "The printed copy keeps the wording it was printed with." });
  if (flag.signer) {
    badges.push({ color: "purple", text: `${flag.signer.name} signs for this account`, title: "This version only applies if they sign for themselves. Add their signer too." });
  }
  if (flag.signsFor?.length) {
    badges.push({ color: "gray", text: `Signs for ${flag.signsFor.map((s) => s.name).join(", ")}`, title: "These terms cover every account they sign for." });
  }
  const addSigner = flag.signer && !chosenIds.includes(flag.signer.id) ? flag.signer : null;
  return { badges, addSigner };
}

function Chip({ landlord, flag, kind, versionId, chosenIds, onRemove, onAddSigner, disabled, status }) {
  const { badges, addSigner } = flagBadges(flag, { kind, versionId, chosenIds });
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 px-2 py-1.5">
      <span className="text-sm text-gray-900">{flag?.name || landlordName(landlord)}</span>
      {status && <Badge color={status.color}>{status.text}</Badge>}
      {badges.map((b) => (
        <Badge key={b.text} color={b.color} title={b.title}>
          {b.text}
        </Badge>
      ))}
      {addSigner && onAddSigner && (
        <button type="button" disabled={disabled} className="text-xs text-gray-700 underline disabled:opacity-60" onClick={() => onAddSigner(addSigner)}>
          Add {addSigner.name} too
        </button>
      )}
      <button type="button" disabled={disabled} aria-label="Remove" className="ml-auto text-xs text-gray-500 hover:text-red-700 disabled:opacity-60" onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

// The search list: every match with a toggle, on when chosen.
function SearchToggles({ chosenIds, onToggle, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stale = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await call(`/api/admin/billing/landlords/search?q=${encodeURIComponent(query.trim())}`);
        if (!stale) setResults(body.landlords ?? []);
      } catch (err) {
        if (!stale) setError(err.message);
      } finally {
        if (!stale) setLoading(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="space-y-1">
      <input className={FIELD} value={query} disabled={disabled} placeholder="Search landlords by name, email or company" onChange={(e) => setQuery(e.target.value)} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-100">
        {results.map((l) => {
          const on = chosenIds.includes(l.id);
          return (
            <li key={l.id}>
              <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 ${on ? "bg-gray-50" : ""}`}>
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => onToggle(l)} />
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900">{landlordName(l)}</span>
                  <span className="block truncate text-xs text-gray-500">{[l.company, l.email].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            </li>
          );
        })}
        {!loading && !results.length && <li className="px-3 py-2 text-sm text-gray-500">No landlords match.</li>}
        {loading && !results.length && <li className="px-3 py-2 text-sm text-gray-500">Searching...</li>}
      </ul>
    </div>
  );
}

const toggle = (list, l) => (list.some((x) => x.id === l.id) ? list.filter((x) => x.id !== l.id) : [...list, l]);

// The upload form's picker: `value` is the chosen landlords ({ id, name, email, company }).
export function LandlordToggles({ value, onChange, kind, disabled }) {
  const ids = value.map((l) => l.id);
  const flags = useLandlordFlags(ids);
  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="space-y-1">
          {value.map((l) => (
            <Chip
              key={l.id}
              landlord={l}
              flag={flags[l.id]}
              kind={kind}
              chosenIds={ids}
              disabled={disabled}
              onRemove={() => onChange(value.filter((x) => x.id !== l.id))}
              onAddSigner={(s) => onChange([...value, { id: s.id, name: s.name }])}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-gray-500">Nobody chosen yet. You can upload now and add landlords to it later.</p>
      )}
      <SearchToggles chosenIds={ids} onToggle={(l) => onChange(toggle(value, l))} disabled={disabled} />
    </div>
  );
}

// The words for the confirmation: what happens to each landlord added or taken off.
function changeSummary({ version, adding, removing, flags }) {
  const live = version.status === "live";
  const lines = [];
  for (const l of adding) {
    const f = flags[l.id];
    const notes = [];
    const other = f?.liveCustom?.[version.kind];
    if (other && other.versionId !== version.id) notes.push(`replaces their custom version "${other.label}"`);
    if (version.kind === "master" && f?.signed && f.signed.versionId !== version.id) {
      notes.push(`they signed ${f.signed.custom ? "a custom" : "the standard"} agreement, which keeps counting until they sign this one`);
    }
    if (live && cancelsCopy(f, { kind: version.kind, versionId: version.id, adding: true })) notes.push("their open unsigned copy is cancelled");
    if (f?.paperOut) notes.push("their paper copy out keeps its old wording");
    if (f?.signer && !adding.concat(version.landlords).some((x) => x.id === f.signer.id)) notes.push(`${f.signer.name} signs for them, so this only applies if they sign themselves`);
    if (f?.signsFor?.length) notes.push(`also covers ${f.signsFor.map((s) => s.name).join(", ")}, whom they sign for`);
    lines.push(`+ ${f?.name || landlordName(l)}${notes.length ? `: ${notes.join("; ")}` : ""}`);
  }
  for (const l of removing) {
    const f = flags[l.id];
    const notes = ["signs the standard version next"];
    if (f?.signed?.versionId === version.id) notes.push("the agreement they signed on this version stays in force (void it separately if needed)");
    if (live && cancelsCopy(f, { kind: version.kind, versionId: version.id, adding: false })) notes.push("their open unsigned copy is cancelled");
    lines.push(`- ${f?.name || landlordName(l)}: ${notes.join("; ")}`);
  }
  const when = live ? "This applies now." : "Nothing changes for them until you make the version live.";
  return `Update who "${version.label}" applies to?\n\n${lines.join("\n")}\n\n${when}`;
}

/*
 * On a custom version: the landlords it applies to, Remove on each, Add landlords,
 * then Save (with a confirmation naming what happens to each). Retired versions
 * only list who they were for.
 */
export function AppliesTo({ version, busy, run, onDirtyChange }) {
  const saved = version.landlords ?? [];
  const [draft, setDraft] = useState(saved);
  const [adding, setAdding] = useState(false);
  const savedKey = saved.map((l) => l.id).join(",");
  useEffect(() => {
    setDraft(version.landlords ?? []);
    setAdding(false);
    // Reset when the saved list changes (after a save or a refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);
  const ids = draft.map((l) => l.id);
  const flags = useLandlordFlags([...new Set([...ids, ...saved.map((l) => l.id)])], savedKey);
  const editable = version.status !== "retired";
  const addList = draft.filter((l) => !saved.some((s) => s.id === l.id));
  const removeList = saved.filter((s) => !draft.some((l) => l.id === s.id));
  const dirty = addList.length > 0 || removeList.length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = () => {
    if (!window.confirm(changeSummary({ version, adding: addList, removing: removeList, flags }))) return;
    return run(async () => {
      const r = await postJson(`/api/admin/billing/agreement-versions/${version.id}`, {
        action: "landlords",
        add: addList.map((l) => l.id),
        remove: removeList.map((l) => l.id),
      });
      return r?.warning ?? null;
    }, version.status === "live" ? "Saved. It applies to them now." : "Saved. It applies to them once it is live.");
  };

  if (!editable) {
    return saved.length ? <p className="text-xs text-gray-500">Was for {saved.map((l) => l.name || "a landlord").join(", ")}</p> : null;
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-gray-100 bg-gray-50/50 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs font-medium text-gray-700">
          Applies to {draft.length ? `${draft.length} ${draft.length === 1 ? "landlord" : "landlords"}` : "nobody yet"}
          {version.status !== "live" && draft.length > 0 ? " once it is live" : ""}
        </p>
        <button type="button" disabled={busy} className={BUTTON} onClick={() => setAdding((a) => !a)}>
          {adding ? "Done choosing" : "Add landlords"}
        </button>
      </div>
      {draft.length > 0 && (
        <ul className="space-y-1">
          {draft.map((l) => {
            const isNew = !saved.some((s) => s.id === l.id);
            return (
              <Chip
                key={l.id}
                landlord={l}
                flag={flags[l.id]}
                kind={version.kind}
                versionId={version.id}
                chosenIds={ids}
                disabled={busy}
                status={isNew ? { color: "blue", text: "Adding" } : null}
                onRemove={() => setDraft(draft.filter((x) => x.id !== l.id))}
                onAddSigner={(s) => setDraft([...draft, { id: s.id, name: s.name }])}
              />
            );
          })}
        </ul>
      )}
      {removeList.length > 0 && (
        <p className="text-xs text-red-700">Taking off: {removeList.map((l) => flags[l.id]?.name || l.name || "a landlord").join(", ")}</p>
      )}
      {adding && <SearchToggles chosenIds={ids} onToggle={(l) => setDraft(toggle(draft, l))} disabled={busy} />}
      {dirty && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} className={PRIMARY} onClick={save}>
            Save changes
          </button>
          <button type="button" disabled={busy} className={BUTTON} onClick={() => setDraft(saved)}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

// For the Make live confirmation: what happens to each landlord on the version.
export function useLiveSummary(version) {
  const ids = (version.landlords ?? []).map((l) => l.id);
  const flags = useLandlordFlags(ids);
  return () => {
    const lines = (version.landlords ?? []).map((l) => {
      const f = flags[l.id];
      const notes = [];
      const other = f?.liveCustom?.[version.kind];
      if (other && other.versionId !== version.id) notes.push(`replaces their custom version "${other.label}"`);
      if (version.kind === "master" && f?.signed) notes.push(`signed ${f.signed.custom ? "a custom" : "the standard"} agreement, which keeps counting until they sign this one`);
      if (cancelsCopy(f, { kind: version.kind, versionId: version.id, adding: true })) notes.push("their open unsigned copy is cancelled");
      if (f?.paperOut) notes.push("their paper copy out keeps its old wording");
      if (f?.signer && !ids.includes(f.signer.id)) notes.push(`${f.signer.name} signs for them, so this only applies if they sign themselves`);
      return `- ${f?.name || l.name || "Landlord"}${notes.length ? `: ${notes.join("; ")}` : ""}`;
    });
    return lines.length ? lines.join("\n") : "Nobody is on it yet. It applies to nobody until you add landlords.";
  };
}

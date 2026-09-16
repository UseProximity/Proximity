"use client";

/*
 * Writing the message a batch of students will receive.
 *
 * The two placeholders are the whole point. {link} is filled in server-side with
 * that person's own single-use invite URL, which is why the preview here can
 * only ever show a stand-in: the real token does not exist until the send runs,
 * and a browser that could render one would be a browser holding a working
 * credential for someone else's inbox.
 *
 * The preview is deliberately plain text rather than a rendering of the final
 * HTML. It is here to answer "did I spell the placeholders right and does this
 * read well", and a second copy of the email renderer would be one more thing to
 * keep in step with lib/email.js for no extra answer.
 */

import { useMemo } from "react";

const DEFAULT_SUBJECT = "Where did you live this year?";

const DEFAULT_MESSAGE = `Hi {first_name},

Proximity is where WashU students find off-campus housing. The part that makes it useful is the reviews, and the only people who can write them are the students who lived there.

Would you take two minutes to review the place you lived this year? There is no account to create first: {link}

Thanks,
The Proximity team`;

export { DEFAULT_SUBJECT, DEFAULT_MESSAGE };

function Placeholder({ token, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(token)}
      className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 font-mono text-[11px] text-gray-800"
    >
      {token}
    </button>
  );
}

export default function InviteComposer({
  subject,
  onSubjectChange,
  message,
  onMessageChange,
  sampleRecipient,
  missingFirstNameCount,
}) {
  const usesFirstName = message.includes("{first_name}");
  const hasLink = message.includes("{link}");

  const preview = useMemo(() => {
    const name = sampleRecipient?.first_name?.trim() || "there";
    return message
      .split("{first_name}")
      .join(name)
      .split("{link}")
      .join("[ Write my review ]");
  }, [message, sampleRecipient]);

  function insert(token) {
    onMessageChange(message ? `${message} ${token}` : token);
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="invite-subject" className="block text-xs font-semibold text-gray-700 mb-1">
          Subject
        </label>
        <input
          id="invite-subject"
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder={DEFAULT_SUBJECT}
          className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label htmlFor="invite-message" className="block text-xs font-semibold text-gray-700">
            Message
          </label>
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
            insert:
            <Placeholder token="{first_name}" onInsert={insert} />
            <Placeholder token="{link}" onInsert={insert} />
          </span>
        </div>
        <textarea
          id="invite-message"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          rows={10}
          className="w-full px-2 py-1.5 text-xs font-mono border border-gray-300 rounded focus:outline-none focus:border-blue-400"
        />
      </div>

      {!hasLink && (
        <p className="px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded">
          Your message needs {"{link}"} somewhere, or the email gives the student
          nothing to click.
        </p>
      )}

      {usesFirstName && missingFirstNameCount > 0 && (
        <p className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded">
          {missingFirstNameCount} selected student
          {missingFirstNameCount === 1 ? " has" : "s have"} no first name on file, so
          they would be greeted as &quot;Hi ,&quot;. They will be skipped unless you
          remove {"{first_name}"} from the message.
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1">
          Preview
          {sampleRecipient && (
            <span className="font-normal text-gray-500"> as {sampleRecipient.email}</span>
          )}
        </p>
        <div className="px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-xs text-gray-800 whitespace-pre-wrap">
          {preview || <span className="text-gray-400">Nothing to preview yet.</span>}
        </div>
        <p className="mt-1 text-[11px] text-gray-500">
          Every invite also carries the copy-this-link fallback and the note that the
          link is personal to that address. Those are properties of the link, so they
          are appended automatically.
        </p>
      </div>
    </div>
  );
}

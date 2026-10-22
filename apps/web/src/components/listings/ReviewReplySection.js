"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "react-hot-toast";
import { checkReviewText } from "@/lib/contentRules";
import CardMenu from "@/components/ui/CardMenu";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ReviewEditForm from "@/components/listings/ReviewEditForm";

// The API answers in table columns; the card reads the shape getListing sends.
function toCardReply(row) {
  return {
    id: row.id,
    reply: row.reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at ?? null,
    userId: row.user_id,
  };
}

// readOnly: the owner's "View as Student" preview, where nothing is wired.
export default function ReviewReplySection({ review, owner, isLandlord, readOnly = false }) {
  const { data: session } = useSession();
  const viewerId = session?.user?.id;

  const [replyText, setReplyText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Local copy so a post, edit or delete shows straight away without a reload.
  const [landlordReply, setLandlordReply] = useState(review.landlordReply ?? null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportMsg, setReportMsg] = useState("");

  const reviewId = review.id || review._id; // Support both review.id and review._id for flexibility
  const isAuthor = Boolean(viewerId && landlordReply?.userId === viewerId);

  // A public reply must not name the student who wrote the review.
  const replyProblem = checkReviewText(replyText);

  async function handleReplySubmit() {
    if (!replyText.trim()) return;

    if (isSubmitting) return;

    if (replyProblem) {
      toast.error(replyProblem);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/replyReview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reviewId,
          reply: replyText,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Failed to post reply");
        return;
      }

      toast.success("Reply posted!");
      setLandlordReply(toCardReply(data));
      setReplyText("");
    } catch {
      toast.error("Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEditSave({ text }) {
    try {
      const res = await fetch("/api/replyReview", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId: landlordReply.id, reply: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Couldn't save your reply");
        return;
      }
      setLandlordReply((prev) => ({
        ...prev,
        reply: data.reply,
        editedAt: data.editedAt ?? prev.editedAt,
      }));
      setEditing(false);
    } catch {
      toast.error("Something went wrong");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch("/api/replyReview", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replyId: landlordReply.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || "Couldn't delete your reply");
        return;
      }
      toast.success("Reply deleted");
      setLandlordReply(null);
      setConfirmDelete(false);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  async function handleReport() {
    const res = await fetch("/api/reviewReport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replyId: landlordReply.id }),
    }).catch(() => null);
    setReportMsg(
      res?.ok
        ? "Thanks, we'll take a look at this reply."
        : "Couldn't send your report. Please try again."
    );
  }

  const menuItems = readOnly
    ? []
    : isAuthor
    ? [
        { label: "Edit", onClick: () => setEditing(true) },
        { label: "Delete", onClick: () => setConfirmDelete(true), destructive: true },
      ]
    : viewerId
    ? [{ label: "Report", onClick: handleReport }]
    : [];

  return (
    <div>
      {confirmDelete && (
        <ConfirmDialog
          title="Delete reply?"
          message="Your reply will be removed from this review. You can write a new one afterwards."
          busy={deleting}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {landlordReply && (
        <div className="mt-4 pl-10 border-l-2 border-gray-200">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <img
                src={
                  owner?.image?.trim()
                    ? owner.image
                    : "/default-icons/default-user.png"
                }
                alt={owner?.name || "Landlord"}
                className="w-8 h-8 rounded-full object-cover"
              />
              <div>
                <span className="font-medium text-sm text-gray-900">
                  {owner?.name ? `${owner.name} (Landlord)` : "(Landlord)"}
                </span>
                <div className="text-xs text-gray-400">
                  {new Date(
                    landlordReply.updatedAt || landlordReply.createdAt
                  ).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                  {landlordReply.editedAt && " · Edited"}
                </div>
              </div>
            </div>
            {!editing && <CardMenu items={menuItems} label="Reply actions" />}
          </div>
          {editing ? (
            <ReviewEditForm
              initialText={landlordReply.reply}
              onSave={handleEditSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <p className="text-sm text-gray-600 mt-1">{landlordReply.reply}</p>
          )}
          {reportMsg && <p className="mt-2 text-xs text-gray-500">{reportMsg}</p>}
        </div>
      )}
      {isLandlord && !landlordReply && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Reply to this review..."
            rows={3}
            aria-invalid={replyProblem ? true : undefined}
            className="w-full border border-gray-200 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
          {replyProblem && (
            <p className="mt-2 text-sm text-red-600">{replyProblem}</p>
          )}

          <div className="flex justify-end mt-2">
            <button
              type="button"
              disabled={isSubmitting || !!replyProblem}
              onClick={handleReplySubmit}
              className="bg-red-600 text-white text-xs font-medium px-4 py-2 rounded-full hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting && (
                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}

              {isSubmitting ? "Posting..." : "Reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

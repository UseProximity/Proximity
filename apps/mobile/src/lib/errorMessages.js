// Every user-facing error string in the mobile app lives here, so wording is
// reviewed and changed in one place. Screens pick a constant for the action that
// failed (the fallback passed to getErrorMessage in lib/apiError.js); the
// interpretation of what actually went wrong (no connection, expired session,
// known server answer) stays in apiError.js.
//
// Messages are short, plain and say what happened. Nothing here contains a status
// code, an error code or any other internal detail.

export const ERROR_MESSAGES = {
  NETWORK: "No internet connection. Check your connection and try again.",
  GENERIC: "Something went wrong. Please try again.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  FORBIDDEN: "You don't have permission to do that.",

  AUTH: {
    SESSION_EXPIRED: "Your session has expired. Please sign in again.",
    SIGN_IN: "Couldn't sign in. Please try again.",
    SIGN_IN_GOOGLE: "Couldn't sign in with Google. Please try again.",
    SIGN_IN_APPLE: "Couldn't sign in with Apple. Please try again.",
    SIGN_UP: "Couldn't create your account. Please try again.",
    RESEND_VERIFICATION: "Couldn't send the verification email. Please try again.",
    RESEND_EMAIL: "Couldn't resend the email. Please try again.",
    RESET_EMAIL: "Couldn't send the reset email. Please try again.",
    RESET_PASSWORD: "Couldn't reset your password. Please try again.",
    RESET_LINK_INVALID: "This reset link is invalid or has expired. Request a new one.",
    VERIFY_EMAIL: "Couldn't verify your email. Please try again.",
    VERIFY_LINK_INVALID:
      "This verification link is invalid or has expired. If you already verified your email, sign in. Otherwise sign in to request a new link.",
    INVALID_CREDENTIALS: "Incorrect email or password.",
    EMAIL_NOT_VERIFIED: "Verify your email before signing in.",
    APPLE_EMAIL_NOT_VERIFIED:
      "An account with your Apple email exists but isn't verified yet. Verify it, or sign in the way you signed up.",
    APPLE_EMAIL_REQUIRED: "Apple didn't share a verified email address, so we can't create your account.",
    ACCOUNT_DELETED: "This account has been deleted.",
    VERIFY_SIGN_IN: "Couldn't verify your sign-in. Please try again.",
    EMAIL_EXISTS: "An account with this email already exists.",
    APPLE_ACCOUNT: "This email is linked to an Apple account. Please sign in with Apple.",
    GOOGLE_ACCOUNT: "This email is linked to a Google account. Please sign in with Google.",
    SET_PASSWORD_EMAILED: "This email is already on Proximity but has no password yet. Check your inbox for a link to set one.",
    EMAIL_RECENTLY_DELETED:
      "This email belonged to a recently deleted account. It frees up 30 days after deletion. Need help? Contact info@useproximity.org.",
    EMAIL_INVALID: "Enter a valid email address.",
    NAME_REQUIRED: "Enter your name.",
    FIELDS_REQUIRED: "Fill in all the required fields.",
    PASSWORD_SHORT: "Password must be at least 8 characters.",
  },

  PROFILE: {
    SAVE: "Couldn't save your profile. Please try again.",
    DELETE_ACCOUNT: "Couldn't delete your account. Please try again.",
    DELETE_NOT_ALLOWED: "This account can't be deleted. Contact Proximity support for help.",
    CHANGE_PASSWORD: "Couldn't change your password. Please try again.",
    NAME_REQUIRED: "Name is required",
    EMAIL_REQUIRED: "Email is required",
    EMAIL_INVALID: "Please enter a valid email",
    GRAD_YEAR: "Graduation year must be a 4-digit year",
    NAME_PROMPT: "Please enter your name",
    YEAR_PROMPT: "Please enter a valid 4-digit year",
    CURRENT_PASSWORD_REQUIRED: "Current password is required",
    NEW_PASSWORD_REQUIRED: "New password is required",
    NEW_PASSWORD_SHORT: "New password must be at least 8 characters",
    PASSWORDS_MISMATCH: "New passwords do not match",
    PASSWORD_UNCHANGED: "New password must be different from current password",
    CURRENT_PASSWORD_INCORRECT: "Current password is incorrect",
    PASSWORD_NOT_AVAILABLE: "Password changes aren't available for accounts that sign in with Google or Apple.",
    TEST_EMAIL_INVALID: "Enter a valid email (or leave blank to suppress).",
  },

  LISTINGS: {
    LOAD: "Couldn't load listings. Please try again.",
    LOAD_ONE: "Couldn't load this listing. Please try again.",
    NOT_FOUND: "Listing not found.",
    FAVORITE: "Couldn't update your saved listings. Please try again.",
    MESSAGE_SEND: "Couldn't send your message. Please try again.",
    REPORT_REVIEW: "Couldn't send your report. Please try again.",
    REPORT_LISTING: "Couldn't send your report. Please try again.",
    REPORT_OWN_LISTING: "You can't report your own listing.",
    BLOCK_USER: "Couldn't block this user. Please try again.",
    MINE_LOAD: "Couldn't load your listings. Please try again.",
    MINE_AVAILABILITY: "Couldn't update availability. Please try again.",
    MINE_DELETE: "Couldn't delete this listing. Please try again.",
    PUBLISH: "Couldn't publish your listing. Please try again.",
    PHOTOS_ADD: "Couldn't add those photos. Please try again.",
    PHOTOS_PARTIAL_TITLE: "Listing published",
    photosPartial: (count) =>
      `${count} photo${count === 1 ? "" : "s"} failed to upload. You can re-add them from the listing later.`,
    PHOTOS_FAILED: "Photos failed to upload. You can re-add them from the listing later.",
    CREATE_NOT_ALLOWED: "Your account can't create listings.",
    FIELDS_REQUIRED: "Fill in all the required fields.",
    NAME_TAKEN: "That property name is already taken. Choose a different name.",
    DESCRIPTION_NAMES: "Please don't name people in the description. Describe the role instead, like \u201cthe leasing office\u201d.",
    DESCRIPTION_PROMO:
      "Descriptions can't include links or contact details. Use the contact fields instead, so students reach you through Proximity.",
    NOT_OWNER: "You have a lease at this property but don't own it, so you can't edit it here.",
    REPORT_OWN_REVIEW: "You can't report your own review.",
    REVIEW_NOT_FOUND: "That review is no longer available.",
    BLOCK_SELF: "You can't block yourself.",
    BLOCK_UNAVAILABLE: "This reviewer can't be blocked.",
    CONTACT_EMAIL_REQUIRED: "Add a contact email so students can reach you.",
    SUBLET_CONSENT: "Please confirm you have the right to sublet this place.",
    UNITS_NEGATIVE: "Bedrooms and bathrooms can't be negative.",
    ADDRESS_NOT_FOUND: "We couldn't find that address. Check it and try again.",
    // Add Listing steps.
    STEP_ADDRESS: "Enter the property address to continue.",
    STEP_MOVE_IN: "Pick the date it becomes available, or choose Available now.",
    STEP_UNITS_NONE: "Add at least one unit.",
    STEP_UNIT_BEDS_BATHS: "Each unit needs bedrooms and bathrooms.",
    STEP_UNIT_LEASE_TERM: "Pick at least one lease term for each available unit.",
    STEP_DESCRIPTION: "A short description is required.",
    REVIEW_ADDRESS: "Address needed",
    REVIEW_UNIT_BEDS_BATHS: "Bedrooms and bathrooms needed",
    REVIEW_UNIT_LEASE_TERM: "Pick lease terms for each available unit",
    REVIEW_DESCRIPTION: "A short description is needed",
  },

  CHAT: {
    LOAD_THREADS: "Couldn't load your messages. Please try again.",
    LOAD_THREAD: "Couldn't load this conversation. Please try again.",
    LOAD_EARLIER: "Couldn't load earlier messages. Please try again.",
    SEND_MESSAGE: "Couldn't send your message. Please try again.",
    SEND_ATTACHMENTS: "Couldn't send your attachments. Please try again.",
    // The server answers 403 with exactly this text when either person has blocked
    // the other, and the composer is replaced by it.
    UNAVAILABLE: "This conversation is unavailable",
    TOO_LONG: "Your message is too long. Messages can be up to 5,000 characters.",
    MESSAGE_REQUIRED: "Write a message before sending.",
    PASSWORD_REQUIRED: "Set a password on the Proximity website before you send messages.",
    LANDLORD_UNAVAILABLE: "This landlord can't be messaged right now.",
    OWN_LISTING: "You can't message yourself about your own listing.",
    // The screening verdicts the send routes answer with (422). The server's set is
    // closed: four for a message (lib/chat/moderation.js blockMessage) and two for
    // an attachment (lib/chat/scanAttachment.js blockMessageFor). They are mapped
    // by their exact text below, so a verdict keeps its explanation while any other
    // 422 falls back to the caller's message.
    BLOCKED_ABUSE: "This message cannot be sent. Proximity does not carry abusive or threatening messages.",
    BLOCKED_PHISHING:
      "This message cannot be sent because it asks for login details. Never share a password or a verification code in chat.",
    BLOCKED_PAYMENT:
      "This message cannot be sent because it asks for payment through a method Proximity cannot protect. Never send a deposit before signing a lease and seeing the unit.",
    BLOCKED_CONTACT:
      "Phone numbers, email addresses, outside links and social handles cannot be sent in chat. If you would rather use email, reply to the message emails from Proximity: your reply goes straight to the other person and stays in this conversation.",
    FILE_BLOCKED_PAYMENT:
      "This file cannot be sent because it asks for payment. Never send a deposit before signing a lease and seeing the unit.",
    FILE_BLOCKED_CONTACT:
      "This file cannot be sent because it shares contact details or a link. Keep the conversation on Proximity so every message about this place stays in one place for both of you.",
    FILE_NAME_LONG: "A file name is too long. Rename the file and try again.",
    RATE_LIMIT: "You're sending messages too quickly. Please wait a moment and try again.",
    NOT_FOUND: "This conversation couldn't be found.",
    // Landlord's held email replies (HeldRepliesBanner).
    REPLY_DECIDE: "Something went wrong. Please try again.",
    REPLY_REMOVE: "Couldn't remove that sender. Please try again.",
    REPLY_NOT_WAITING: "That reply is no longer waiting. It may already have been handled.",
    BLOCK: "Couldn't block this user. Please try again.",
    REPORT: "Couldn't send your report. Please try again.",
    REPORT_OWN: "You can't report your own message.",
    REPORT_REASON: "Choose a reason for your report.",
    // Attachments.
    OPEN_PHOTOS: "Couldn't open your photos. Please try again.",
    OPEN_FILES: "Couldn't open your files. Please try again.",
    SOME_PHOTOS: "Some photos couldn't be added.",
    PHOTO_TOO_LARGE: "A photo is too large to send.",
    FILE_TOO_LARGE: "Each file must be 20MB or smaller.",
    FILE_EMPTY: "One of the files is empty.",
    FILE_TYPE: "Only photos and PDFs can be attached.",
    FILE_NOT_PDF: "That file isn't a valid PDF.",
    FILE_UNREADABLE: "Couldn't read that file.",
    UPLOAD_PREPARE: "Couldn't prepare the upload. Please try again.",
    UPLOAD_FILE: "Couldn't upload a file. Please try again.",
    filesLimit: (max) => `Only ${max} files fit in one message.`,
    PHOTO_LIMIT_TITLE: "Photo limit reached",
    ATTACHMENT_LIMIT_TITLE: "Attachment limit reached",
    attachmentLimit: (max) => `You can attach up to ${max} files to a message.`,
    PHOTO_ACCESS_TITLE: "Photo access is off",
    PHOTO_ACCESS: "Allow Proximity to access your photos in Settings to attach them.",
    OPEN_PDF: "Couldn't open this PDF. Please try again.",
    PDF_NOT_READY: "This PDF isn't available yet.",
    PDF_UNSUPPORTED: "Opening files isn't supported on this device.",
    IMAGE_TAP_RETRY: "Tap to retry",
    IMAGE_LOAD_FAILED: "Couldn't load this photo",
    IMAGE_TAP_TRY_AGAIN: "Tap to try again",
  },

  MATCHMAKING: {
    LOAD: "Couldn't reach Proxy. Pull to try again.",
    START: "Couldn't start a chat with Proxy. Pull to try again.",
    OFFLINE: "No internet connection. Pull to try again.",
    LISTING_LOAD: "Couldn't load this listing.",
    // Said by Proxy in the conversation, in its own voice.
    CONTACT: "I couldn't reach out just now, please try again in a bit.",
    TURN: "I couldn't get that through just now, please try again in a bit.",
  },
};

const E = ERROR_MESSAGES;

// What the server says, by its exact text or code, mapped to our own wording. The
// API's texts are written for developers as often as for people, so a server text
// is only ever shown through this table. Anything not listed gets the caller's
// fallback.
export const SERVER_ERRORS = {
  // Auth codes (packages/auth-core errors.js).
  INVALID_CREDENTIALS: E.AUTH.INVALID_CREDENTIALS,
  EMAIL_NOT_VERIFIED: E.AUTH.EMAIL_NOT_VERIFIED,
  ACCOUNT_DELETED: E.AUTH.ACCOUNT_DELETED,
  APPLE_EMAIL_REQUIRED: E.AUTH.APPLE_EMAIL_REQUIRED,
  INVALID_TOKEN: E.AUTH.VERIFY_SIGN_IN,
  TOKEN_EXPIRED: E.AUTH.SESSION_EXPIRED,
  EMAIL_EXISTS: E.AUTH.EMAIL_EXISTS,
  GOOGLE_ACCOUNT: E.AUTH.GOOGLE_ACCOUNT,
  MISSING_FIELDS: E.AUTH.FIELDS_REQUIRED,
  // Sign up and password reset.
  SET_PASSWORD_EMAILED: E.AUTH.SET_PASSWORD_EMAILED,
  "An account with this email already exists.": E.AUTH.EMAIL_EXISTS,
  "This email is linked to an Apple account. Please sign in with Apple.": E.AUTH.APPLE_ACCOUNT,
  "This email uses Google sign-in. Please continue with Google.": E.AUTH.GOOGLE_ACCOUNT,
  "This email is temporarily unavailable because it was recently used by a deleted account. It frees up 30 days after deletion. Need help? Contact info@useproximity.org.":
    E.AUTH.EMAIL_RECENTLY_DELETED,
  "Valid email is required.": E.AUTH.EMAIL_INVALID,
  "Email is required.": E.AUTH.EMAIL_INVALID,
  "Name is required.": E.AUTH.NAME_REQUIRED,
  "Password must be at least 8 characters.": E.AUTH.PASSWORD_SHORT,
  // Password reset and email verification links.
  "Reset link is invalid or has expired.": E.AUTH.RESET_LINK_INVALID,
  "Verification link is invalid or has expired.": E.AUTH.VERIFY_LINK_INVALID,
  // Change password.
  "Current password is incorrect": E.PROFILE.CURRENT_PASSWORD_INCORRECT,
  "New password must be at least 8 characters": E.PROFILE.NEW_PASSWORD_SHORT,
  "New password must be different from current password": E.PROFILE.PASSWORD_UNCHANGED,
  "Current password and new password are required": E.AUTH.FIELDS_REQUIRED,
  "Password change not available for OAuth accounts": E.PROFILE.PASSWORD_NOT_AVAILABLE,
  // Listings.
  "Listing not found": E.LISTINGS.NOT_FOUND,
  "Only students, landlords, and super admins can create listings.": E.LISTINGS.CREATE_NOT_ALLOWED,
  "A contact email is required so students can reach you.": E.LISTINGS.CONTACT_EMAIL_REQUIRED,
  "Please confirm you have the right to sublet this place.": E.LISTINGS.SUBLET_CONSENT,
  "Bedrooms and bathrooms cannot be negative.": E.LISTINGS.UNITS_NEGATIVE,
  "Could not geocode address": E.LISTINGS.ADDRESS_NOT_FOUND,
  // Chat.
  "Message body exceeds the 5000 character limit": E.CHAT.TOO_LONG,
  "Message body required": E.CHAT.MESSAGE_REQUIRED,
  "Conversation not found": E.CHAT.NOT_FOUND,
  "Each file must be 20MB or smaller": E.CHAT.FILE_TOO_LARGE,
  "Images (JPEG, PNG, WebP, GIF) and PDFs only": E.CHAT.FILE_TYPE,
  "Unsupported file type": E.CHAT.FILE_TYPE,
  "You can't report your own message": E.CHAT.REPORT_OWN,
  "Choose a reason for your report": E.CHAT.REPORT_REASON,
  "You have sent a lot of messages in a short time. Try again shortly.": E.CHAT.RATE_LIMIT,
  [E.CHAT.UNAVAILABLE]: E.CHAT.UNAVAILABLE,
  "That reply is no longer waiting": E.CHAT.REPLY_NOT_WAITING,
  // Answers to the chat send, start and attachment routes.
  PASSWORD_REQUIRED: E.CHAT.PASSWORD_REQUIRED, // body.code, not text
  "listing not found": E.LISTINGS.NOT_FOUND,
  "listing has no landlord to contact": E.CHAT.LANDLORD_UNAVAILABLE,
  "listing landlord is no longer an active user": E.CHAT.LANDLORD_UNAVAILABLE,
  "cannot start a chat about your own listing": E.CHAT.OWN_LISTING,
  "message body is required": E.CHAT.MESSAGE_REQUIRED,
  "message body exceeds the 5000 character limit": E.CHAT.TOO_LONG,
  "too many attachments (max 5)": E.CHAT.filesLimit(5),
  "Max 5 files": E.CHAT.filesLimit(5),
  "unsupported attachment type": E.CHAT.FILE_TYPE,
  "attachment exceeds size limit": E.CHAT.FILE_TOO_LARGE,
  "invalid attachment size": E.CHAT.FILE_TOO_LARGE,
  "file name too long": E.CHAT.FILE_NAME_LONG,
  // Account, listing management and review safety.
  "This account cannot be deleted": E.PROFILE.DELETE_NOT_ALLOWED,
  "Missing required fields": E.LISTINGS.FIELDS_REQUIRED,
  "This property name is taken": E.LISTINGS.NAME_TAKEN,
  "You have a lease at this property but don't own the property record, so you can't edit it. Edit your own lease instead.":
    E.LISTINGS.NOT_OWNER,
  "You can't report your own review": E.LISTINGS.REPORT_OWN_REVIEW,
  "You can't report your own listing": E.LISTINGS.REPORT_OWN_LISTING,
  "Review not found": E.LISTINGS.REVIEW_NOT_FOUND,
  "You can't block yourself": E.LISTINGS.BLOCK_SELF,
  "This reviewer can't be blocked": E.LISTINGS.BLOCK_UNAVAILABLE,
  // Generic answers.
  Forbidden: E.FORBIDDEN,
  Unauthorized: E.AUTH.SESSION_EXPIRED,
};

// Server answers that carry a variable part (the words that were flagged), matched
// by their fixed opening and shown as our fixed wording.
export const SERVER_ERROR_PATTERNS = [
  [/^Please don't name people\./, E.LISTINGS.DESCRIPTION_NAMES],
  [/^Descriptions can't include /, E.LISTINGS.DESCRIPTION_PROMO],
];

// The chat screening verdicts (status 422 only), by their exact server text. The
// text is the key, written out in full, and the value is the same wording as a
// constant. A 422 whose text is not listed here falls back to the caller's message.
export const SCREENING_VERDICTS = {
  "This message cannot be sent. Proximity does not carry abusive or threatening messages.": E.CHAT.BLOCKED_ABUSE,
  "This message cannot be sent because it asks for login details. Never share a password or a verification code in chat.":
    E.CHAT.BLOCKED_PHISHING,
  "This message cannot be sent because it asks for payment through a method Proximity cannot protect. Never send a deposit before signing a lease and seeing the unit.":
    E.CHAT.BLOCKED_PAYMENT,
  "Phone numbers, email addresses, outside links and social handles cannot be sent in chat. If you would rather use email, reply to the message emails from Proximity: your reply goes straight to the other person and stays in this conversation.":
    E.CHAT.BLOCKED_CONTACT,
  "This file cannot be sent because it asks for payment. Never send a deposit before signing a lease and seeing the unit.":
    E.CHAT.FILE_BLOCKED_PAYMENT,
  "This file cannot be sent because it shares contact details or a link. Keep the conversation on Proximity so every message about this place stays in one place for both of you.":
    E.CHAT.FILE_BLOCKED_CONTACT,
};

# Proximity Privacy Policy

**Effective date:** August 26, 2026
**Last updated:** August 26, 2026

Proximity LLC ("Proximity," "we," "us," or "our"), a limited liability company organized
under the laws of the State of Missouri, United States, operates the Proximity website at
https://useproximity.org and the Proximity mobile applications for iOS and Android
(together, the "Services").

This Privacy Policy explains what personal information we collect, why we collect it, who
we share it with, how long we keep it, and the choices and rights you have. It covers both
the website and the mobile apps; where something applies to only one of them, we say so.

Proximity is an off-campus housing marketplace for university students and the landlords
who rent to them. The Services are operated from the United States, are directed to
students at universities in the United States, and are intended for people **18 years of
age or older**.

**Privacy contact:** info@useproximity.org
**Postal address:** Proximity LLC, 70 Greendale Rd, Scarsdale, NY 10583-2133

---

## 1. Information we collect

### 1.1 Account information

When you create an account, we collect:

- **Name** and **email address**.
- **Password**: if you sign up with email and password. We store only a salted,
  irreversible hash; we never store your password itself.
- **Sign-in method**: whether your account is linked to Google.
- **Email verification status** and, temporarily, the tokens used to verify your email
  address or reset your password.
- **Account role**: student or landlord.
- **Your school**: derived from the domain of your email address (for example,
  `wustl.edu` identifies a Washington University in St. Louis account). We record it when
  you submit a review; only students at a school we serve are eligible to leave reviews.

### 1.2 Profile information

When you complete or edit your profile, you may also provide:

- **Date of birth**: used to confirm eligibility for properties that require residents to
  be 21 or older.
- **Phone number**
- **Gender**: see Section 2.1 for how this is used.
- **A short "about you" description**
- **Profile photo**
- **Expected graduation month and year**
- **How you heard about Proximity**

If you take part in the ambassador referral program, we also collect the **payout method
(Venmo or Zelle) and the payout handle** you give us.

### 1.3 Information from Google

If you choose "Continue with Google," Google provides us with your **email address, name,
and Google profile picture URL**. We never receive your Google password. On the mobile
apps, Google sign-in happens in a system browser window and we receive only the resulting
identity token, which we verify with Google. If an account already exists with that email
address, signing in with Google links to that same account. We do not read from, or post
to, any other Google service on your behalf.

### 1.4 Content you create

- **Listings** (landlords and subletters): property title, street address, city, state,
  ZIP code, coordinates, description, rent, bedrooms, bathrooms, area, unit and lease
  details, amenities, utilities, move-in dates, lease terms, and whether the property is
  restricted to residents 21 or older.
- **Listing contact details**: the name, email address, and phone number you choose to
  publish on a listing so students can reach you. **These are displayed publicly.**
- **Photos and floor plans** you upload for a listing.
- **Reviews** of off-campus listings and on-campus dorms: star ratings, category ratings,
  written text, and the display name shown with the review. You may post a review
  anonymously; when you do, we do not store a display name against it.
- **Review replies** (landlords) and **helpful / not-helpful votes** on reviews.
- **Information you provide about a landlord when leaving a review**: in the referral
  review flow we ask for the landlord's name, email address, and phone number, and the
  unit number you lived in. This is used internally to identify and contact the property
  owner; it is not displayed on the Services.
- **Matchmaking conversations**: the full transcript of your conversation with our
  matchmaking assistant, the housing preferences derived from it (first name, budget,
  move-in and move-out dates, lease term, group size, neighborhood, furnishing,
  openness to roommates, priorities, and free-text notes), and the recommendations
  generated for you.
- **Inquiries to landlords**: the first name, last name, email address, phone number, and
  message you submit through a listing's contact form. We deliver this by email to the
  landlord, with your email address as the reply-to, and send a confirmation copy to you.
  We record *that* you contacted a listing; we do not store the message text in our
  database.
- **Feedback and bug reports**: the message you send, the page you sent it from, and, if
  you are signed in, your name, email address, and role, so we can follow up. Your IP
  address is used momentarily to rate-limit submissions and is not stored.
- **Lease Check uploads**: see Section 1.7.

### 1.5 Usage and technical information

- **Interaction history**: which listings you save and which you contact, with
  timestamps. We do not keep a per-user record of which listings you merely viewed.
- **Aggregate listing metrics**: daily counts of views, saves, and contacts per listing.
  Views are counted in the aggregate only, not against your account. Landlords see these
  as totals in their dashboard, never as identified visitors.
- **Server logs**: our hosting provider records standard request information (IP address,
  timestamp, request path, user agent) for operating, debugging, and securing the
  Services.
- **Internal change history**: an internal log records changes to records in our
  database, including who made the change and the values before and after, so we can
  investigate errors, disputes, and abuse.
- **Website analytics**: see Section 5.1.

### 1.6 Information we do **not** collect

- **Your device's location.** Neither app requests location permission, and neither uses
  it. Map features use property coordinates, which are attributes of a listing, not of
  you.
- **Your contacts, calendar, or microphone.** Camera and microphone access are explicitly
  disabled in the mobile apps. The apps request photo-library access only when a landlord
  adds listing photos, and read only the images you select.
- **Advertising identifiers.** The mobile apps contain no advertising, attribution, or
  crash-reporting code, and no third-party analytics beyond what is described in Section
  5.
- **Payment card or bank details.** Proximity does not process payments. The only
  payment-related data we hold is a Venmo or Zelle handle voluntarily provided by
  ambassadors.
- **Government ID, income, credit, or background-check information.**
- **Biometric data.**

### 1.7 Lease Check (optional website feature)

Lease Check is currently available on the website only. If you use it, you upload a copy
of your lease as a PDF or photographs. What happens:

1. The file is uploaded directly to our object storage provider.
2. It is sent to Anthropic's Claude API for analysis.
3. **The file is deleted from our storage as soon as the analysis completes.**
4. We keep only the *output*: the file name, file type, page count, which public listing it
   appeared to match, our confidence in that match, the flags raised, the plain-language
   summary, and which pages could not be read. We do **not** store the lease document
   itself, nor the address, rent amount, or landlord name extracted from it.

A lease may contain your full legal name, signature, home address, and financial terms.
Please do not upload a document you are not comfortable sending to an AI provider for
analysis. See Section 4.

---

## 2. How we use your information

| Purpose | Examples |
|---|---|
| **Provide the Services** | Create and authenticate your account; display listings; save favorites; publish your listings; display reviews and replies. |
| **Match you to housing** | Operate the matchmaking assistant; store your preferences so you can resume where you left off; rank and explain listings against those preferences. |
| **Connect students and landlords** | Deliver contact-form messages by email; send inquiry emails on your behalf when you ask the matchmaking assistant to; send you a confirmation copy. |
| **Account and transactional email** | Verify your email address; reset your password; ask landlords to confirm whether a listing is still available; remind new landlords who have not yet posted. |
| **Analyze a lease you upload** | Produce the Lease Check flags and summary. |
| **Keep listings accurate** | Sync availability from a landlord's property-management system, where the landlord has connected one. |
| **Safety, integrity, and support** | Apply eligibility rules (only students at a school we serve may leave reviews, and we use your date of birth to check eligibility on listings restricted to residents 21 or older); investigate abuse and fraud; respond to your questions. |
| **Improve the Services** | Understand which pages and listings are used; act on feedback and bug reports. |
| **Business operations** | Maintain a record of new accounts and listings for onboarding and support. |
| **Legal** | Comply with applicable law and enforce our Terms. |

We do not use your personal information to build advertising profiles, and we do not use it
to train artificial-intelligence models (see Section 4).

### 2.1 How we use gender

If you have recorded a gender on your profile, the matchmaking assistant uses it in one
narrow way: some listings state in their description that the landlord restricts occupancy
to tenants of one gender. Where a listing states such a restriction, the matchmaker will
not recommend it to you unless your recorded gender matches. If your gender is unrecorded,
non-binary, or otherwise not resolvable to the stated restriction, those listings are not
recommended to you. Where you have not recorded a gender, the assistant may also read a
clear first-person statement in your free-text notes (for example, "I'm a girl").

This affects only which listings the matchmaking assistant surfaces. It never restricts
what you can search, browse, view, or contact directly, and it is not used for any other
purpose.

---

## 3. Age requirement

The Services are intended for people **18 years of age or older**. We do not knowingly
collect personal information from anyone under 18. If we learn that we have collected
personal information from someone under 18, we will delete that account and its data.

If you believe a minor has created an account, contact us at info@useproximity.org.

---

## 4. Artificial intelligence

Three Proximity features send information to **Anthropic PBC** (the Claude API), a service
provider located in the United States:

- **Matchmaking.** Each turn of your conversation sends the conversation transcript, the
  housing preferences derived from it, and a catalog of listings that fit your filters.
  The listings are public marketplace data. **Your first name is included in this payload**
  so the assistant can address you naturally. No other identifier (not your email address,
  phone number, date of birth, or account ID) is sent.
- **Lease Check** (website only). The lease document you upload is sent to Anthropic for
  analysis, as described in Section 1.7.
- **Listing drafts** (landlords). A property website URL you supply and the public content
  of that page are sent to Anthropic to pre-fill a listing draft.

Anthropic processes this data solely to return a response to us. We do not use your
personal information to train our own models, and we do not sell or license your
conversations or lease documents.

The matchmaking assistant ranks and explains listings. It does not make any decision that
produces a legal or similarly significant effect about you. It does not approve or deny
you housing, and every recommendation is a suggestion you are free to ignore. A human is
always the one who decides whether to rent to you.

---

## 5. Cookies, local storage, and on-device storage

### 5.1 Website

**Strictly necessary**

Your session is kept alive by an authentication cookie that keeps you signed in and
protects against cross-site request forgery. It is cleared when you sign out.

**Functional: stored in your browser**

We also use your browser's local storage to make the site more convenient to use:

| What it remembers | Why |
|---|---|
| Your in-progress matchmaking conversation | So a page refresh does not lose it. |
| An in-progress listing you are drafting | So you do not lose your work if you leave the page. |
| The page you navigated from | So an action on a listing can be attributed to its source. That source label is included in the analytics events described below. This is cleared when you close the tab. |

**Analytics**

- **Vercel Web Analytics**: aggregate, privacy-preserving page analytics provided by our
  hosting provider. It does not set cookies and does not track you across websites.
- **Google Analytics**: used on our website, not in the mobile apps. It sets its own
  cookies and collects an approximate location derived from your IP address, device and
  browser information, and the pages you view.

You can block or delete cookies through your browser settings, and you can prevent Google
Analytics from collecting data by installing Google's opt-out browser add-on. Blocking the
strictly necessary cookie will sign you out.

### 5.2 Mobile apps

The mobile apps do not use cookies. They store the following **on your device only**, in
your device's secure, encrypted storage:

| What | Why |
|---|---|
| A short-lived sign-in credential and a longer-lived one used to renew it | Keeps you signed in without re-entering your password. |
| A copy of your basic profile (name, email address, role, photo URL) | Shows your profile immediately at launch. |
| Photos you select for a listing, held temporarily | Compressed and uploaded, then discarded. |

Signing out deletes your credentials and cached profile from the device. The mobile apps do
not store your matchmaking conversation on the device. They contain no analytics,
advertising, attribution, or crash-reporting code, do not use push notifications, and do
not use over-the-air updates.

---

## 6. How we share information

We do not sell your personal information for money.

### 6.1 Publicly: this is how the marketplace works

- **Listings you publish** are public, including the contact name, email address, and phone
  number you place on them.
- **Reviews you post** are public, with your display name unless you post anonymously.
- **Landlord replies to reviews** are public.

Public content may be indexed by search engines and copied by third parties beyond our
control.

### 6.2 With other users, to connect you

- When you send a message through a listing's contact form, we email your **name, email
  address, phone number (if provided), and message** to that landlord and set your email
  address as the reply-to.
- When you ask the matchmaking assistant to contact an owner for you, we email your
  **first name and email address** together with your inquiry.

### 6.3 With service providers

We share personal information with vendors who process it on our behalf, under contract
and only for the purposes we specify:

| Provider | What they process | Why |
|---|---|---|
| **Supabase** | All application data described in Section 1 | Managed database hosting |
| **Vercel** | Requests to the website and API, server logs, aggregate web analytics | Application hosting, scheduled jobs, analytics |
| **Cloudflare** | Profile photos, listing photos, floor plans; lease documents transiently | Object storage and delivery |
| **Anthropic PBC** | Matchmaking transcripts and preferences (including your first name); uploaded lease documents; listing-draft page content | AI features (Section 4) |
| **Google** | Sign-in identity; property street addresses (Street View imagery for listing photos); website usage (analytics) | Authentication, listing imagery, analytics |
| **Mapbox** | Map and geocoding requests from your browser or app, which include the map area you are viewing and your IP address | Maps, geocoding, and walking/driving times |
| **Airtable** | New account name, email address, account identifier, sign-up date, and role; new listing details | Internal customer-relationship system for onboarding and support |
| **Google Workspace** | Recipient email addresses and message content | Sending transactional and inquiry email |
| **Nango**, and the property-management system a landlord connects (Buildium, AppFolio, DoorLoop, Rentec Direct) | Landlord-authorized property and unit availability, rent, and lease-end dates. Nango holds the property-management credentials; we store only a reference to the connection, never the credential itself. We do not import tenant records. | Optional landlord listing sync |
| **Firecrawl, Jina, Tavily** | Public web pages at landlord-supplied URLs | Pre-filling a listing draft from a property website |

### 6.4 For legal reasons

We may disclose information where required by law, subpoena, or other legal process, or
where we believe in good faith that disclosure is necessary to protect our rights, your
safety, or the safety of others, or to investigate fraud or abuse.

### 6.5 Business transfers

If Proximity is involved in a merger, acquisition, financing, or sale of assets, your
information may be transferred as part of that transaction. We will notify you before your
information becomes subject to a materially different privacy policy.

---

## 7. How we protect information

- Passwords are stored only as salted, irreversible hashes; we never store or transmit your
  password in readable form.
- Traffic to and from the Services is encrypted in transit.
- On mobile, authentication credentials are held in your device's secure, encrypted
  storage, and the short-lived credential is refreshed automatically.
- On the website, your session is carried in a signed, protected cookie.
- Access to production data is limited to Proximity personnel who need it to operate the
  Services.

No method of transmission or storage is completely secure, and we cannot guarantee absolute
security. If we become aware of a breach affecting your personal information, we will
notify you and the relevant authorities as required by applicable law.

---

## 8. Deleting your account

**You can delete your account yourself, at any time, from either platform.**

- **Website:** your dashboard → **Delete account**
- **Mobile apps:** Profile tab → **Delete Account**

### Immediately, when you confirm

- Your account stops working. You are signed out and can no longer sign in on any device
  or platform.
- Your profile disappears from the Services.
- **Listings you owned alone** are withdrawn from the marketplace.
- **Listings you co-owned with another landlord** remain live under that co-owner. You are
  removed as an owner, and if the listing's published contact details were yours, they are
  replaced with the remaining owner's details so your contact information does not stay
  live on someone else's listing.

### 30 days later

Thirty days after deletion, an automated job permanently erases your personal data:

| Data | What we do |
|---|---|
| Your account record | Name, email address, phone number, date of birth, gender, description, profile photo, graduation details, school, payout handle, and all authentication data are erased. Your email address is released so you can sign up again in future. |
| Profile photos | Permanently deleted from our storage. |
| Reviews you wrote | **Kept, but anonymized.** We remove your name and disconnect the review from your account; the review text stays published, because it describes a property and continues to help other students. |
| Saved listings, contacts, review votes | Permanently deleted. |
| Matchmaking conversations, and the housing preferences derived from them | Permanently deleted. |
| Lease Check results | Permanently deleted. |
| Internal change history | The personal information inside each entry is erased. A record that a change occurred, and when, is retained for security and audit purposes. |

### Important limits

- **The 30-day window is a deletion delay, not a self-service restore period.** There is no
  "undo" in the app. If you delete your account by mistake, email info@useproximity.org
  within 30 days and we will do what we can, but we cannot promise recovery, and after 30
  days it is irreversible.
- **Emails already sent cannot be recalled.** A message you sent to a landlord is already
  in that landlord's inbox and is outside our control.
- **Public content already copied elsewhere cannot be recalled.** We cannot remove material
  that third parties have already saved, cached, or indexed.

---

## 9. How long we keep information

| Category | Retention |
|---|---|
| Account and profile data | While your account is active, then as described in Section 8. |
| Listings | While published. On account deletion, sole-owned listings are withdrawn from the marketplace and retained in hidden form as marketplace history. |
| Reviews | Indefinitely; anonymized on account deletion (Section 8). |
| Matchmaking conversations, and the housing preferences derived from them | While your account is active, then erased under Section 8. |
| Lease Check | The uploaded document is deleted from storage immediately after analysis. The results are erased under Section 8. |
| Saved listings and interaction history | While your account is active, then erased under Section 8. |
| Email sent through the Services | Delivered; the message body is not retained in our database. |
| Aggregate listing metrics | Retained indefinitely in aggregate, non-identifying form. |
| Internal change history | Retained for security and audit purposes. Personal data inside an entry is erased on account deletion. |
| Server logs | Retained by our hosting provider under its standard retention period. |
| Website analytics | Retained under our analytics provider's standard retention settings. |

---

## 10. Your choices

- **Access and correct.** On the website you can view and edit your name, email address,
  phone number, date of birth, gender, description, photo, graduation details, and payout
  handle at any time from your profile. The mobile apps currently let you edit your name,
  email address, and graduation year; for the remaining fields, use the website or email
  us.
- **Delete.** See Section 8.
- **Choose what you publish.** You decide what goes into your profile, your listings, and
  your reviews, and you can post reviews anonymously.
- **Withdraw device permissions.** You can revoke the mobile app's photo-library access in
  your device settings at any time. This affects only the ability to add listing photos.
- **Decline the AI features.** Matchmaking and Lease Check are optional. Nothing is sent to
  Anthropic unless you choose to use them.
- **Request a copy of your data.** Email info@useproximity.org from the address on your
  account and we will provide a copy of the personal information we hold about you.

---

## 11. United States privacy rights

### 11.1 California residents

If you are a California resident, the California Consumer Privacy Act, as amended by the
CPRA, gives you the right to know, access, delete, and correct your personal information,
to opt out of any sale or sharing of it, to limit the use of sensitive personal
information, and not to be discriminated against for exercising these rights. We do not
offer financial incentives in exchange for personal information.

**Categories of personal information we have collected in the preceding 12 months**, using
the statutory categories:

| Category | Collected? | Examples |
|---|---|---|
| Identifiers | Yes | Name, email address, phone number, account identifier, IP address |
| Personal information under Cal. Civ. Code §1798.80 | Yes | Name, phone number, payout handle |
| Protected classification characteristics | Yes | Date of birth / age, gender |
| Commercial information | Yes | Listings saved and contacted |
| Biometric information | No | N/A |
| Internet or network activity | Yes | Pages viewed, referring page, analytics events |
| Geolocation data | No | We do not collect device location |
| Audio, electronic, visual information | Yes | Profile photos, listing photos, uploaded lease documents |
| Professional or employment information | No | N/A |
| Education information | Yes | School, expected graduation month and year |
| Inferences | Yes | Housing preferences derived from your matchmaking conversation |
| Sensitive personal information | Yes | Account log-in credentials; the contents of a lease you upload |

**Sources:** you; Google, if you sign in with Google; and your use of the Services.
**Business purposes for collection and disclosure:** as described in Sections 2 and 6.
**Sale or sharing:** We do not sell personal information for money. We use Google Analytics
on our website, which involves disclosing usage information to Google; you can opt out by
blocking analytics cookies in your browser or by installing Google's opt-out browser
add-on.
**Sensitive personal information:** We use it only to provide the Services you request and
for the purposes permitted by §7027(m) of the CCPA regulations. We do not use or disclose
it to infer characteristics about you.

### 11.2 Other US states

Residents of states with comprehensive privacy laws (including Virginia, Colorado,
Connecticut, Utah, Texas, Oregon, and Montana) may have rights of access, correction,
deletion, and portability, the right to opt out of targeted advertising, sale, and certain
profiling, and the right to appeal a denied request. We honor these requests regardless of
whether a particular statute applies to us by its own thresholds.

### 11.3 How to exercise US privacy rights

Email **info@useproximity.org** from the email address on your Proximity account, stating
what you are asking for. We verify your identity by confirming that you control the account
email address, and we respond within 45 days, extendable by a further 45 days where
permitted by law, with notice to you. An authorized agent may submit a request on your
behalf with written proof of authorization. If we deny a request, you may appeal by
replying to our response; we will respond to the appeal within the period required by your
state's law.

Account deletion does not require a request: it is self-service (Section 8).

---

## 12. Changes to this policy

We may update this Privacy Policy from time to time. When we do, we will revise the "Last
updated" date at the top. If the changes are material, we will notify registered users by
email and by an in-app notice before they take effect. Continuing to use the Services after
an update takes effect means you accept the revised policy.

---

## 13. Contact us

**Proximity LLC**
70 Greendale Rd, Scarsdale, NY 10583-2133
Privacy and general enquiries: **info@useproximity.org**

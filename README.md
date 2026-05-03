# Proximity

Student housing platform for Washington University in St. Louis. Provides verified off-campus listings, honest peer reviews, a roommate matchmaking concierge, and role-based dashboards for students, landlords, and admins.

**Live:** [useproximity.org](https://useproximity.org)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Auth | NextAuth v5 — Google OAuth + email/password |
| Database | Supabase (PostgreSQL) — separate dev and prod projects |
| ORM / Client | `@supabase/supabase-js`, `@supabase/ssr` |
| Storage | Cloudflare R2 (S3-compatible) — listing and profile images |
| Map | Mapbox GL JS |
| Email | Nodemailer over SMTP |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Animation | Framer Motion |
| Deployment | Vercel |
| Analytics | Vercel Analytics + Google Analytics (GA4) |

---

## Project Structure

```
src/
├── app/                        # Next.js App Router — pages and API routes
│   ├── api/                    # All API route handlers
│   ├── dashboard/              # Role-gated dashboards (student, landlord, admin)
│   ├── browse/                 # Listing search and map view
│   ├── matchmaking/            # Roommate concierge form
│   ├── CampusHub/              # Dorm reviews and campus info
│   └── ...                     # login, reset-password, add-listing, etc.
├── components/
│   ├── layout/                 # Header, Footer, Providers
│   ├── ui/                     # Stateless primitives (Modal, HeartIcon, etc.)
│   ├── listings/               # Listing cards, map, modals, filters, reviews
│   ├── dashboard/              # Landlord analytics widgets
│   ├── auth/                   # ButtonAuth, ProfileCompletionModal
│   └── chat/                   # ChatWidget (floating messenger)
├── context/
│   ├── FavoritesContext.js     # Global saved-listing IDs
│   └── ChatContext.js          # In-memory chat conversation state
├── lib/
│   ├── supabase.js             # Service-role admin client (server only)
│   ├── supabaseWithUser.js     # Write-as-user RPCs for action_log attribution
│   ├── supabase/
│   │   ├── client.ts           # Browser anon client
│   │   ├── server.ts           # Server anon client (cookie-based)
│   │   └── middleware.ts       # Middleware session-refresh client
│   ├── r2.js                   # Cloudflare R2 / S3 client
│   └── email.js                # Nodemailer — password reset + verification emails
├── utils/
│   ├── listingFormatters.js    # Rent, unit, and area label helpers
│   ├── walkTimes.js            # Campus walk time calculations
│   ├── washuPlaces.js          # WashU location reference data
│   └── analytics.js            # GA4 event helpers
├── auth.js                     # NextAuth config — providers, JWT, session callbacks
└── middleware.ts               # Edge middleware — Supabase session refresh + URL headers

supabase/migrations/            # 35+ versioned SQL migrations (date-prefixed)
docs/                           # Architecture and schema documentation
mcp/                            # Internal MCP server for AI tooling
public/                         # Static assets — logos, dorm photos, map icons
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (dev and optionally prod)
- Cloudflare R2 bucket
- Mapbox account
- SMTP credentials (Gmail App Password or equivalent)
- Google OAuth app (for Google sign-in)

### Installation

```bash
git clone https://github.com/simaoribeiroo/proximity.git
cd proximity
npm install
```

### Environment Variables

Create `.env.local` in the project root:

```env
# NextAuth
NEXTAUTH_SECRET=your_secret_here

# Google OAuth
GOOGLE_ID=your_google_client_id
GOOGLE_SECRET=your_google_client_secret

# Supabase — Dev
DEV_SUPABASE_URL=https://your-dev-project.supabase.co
DEV_SUPABASE_SERVICE_KEY=your_dev_service_role_key
DEV_SUPABASE_DEFAULT_KEY=your_dev_anon_key

# Supabase — Prod
PROD_SUPABASE_URL=https://your-prod-project.supabase.co
PROD_SUPABASE_SERVICE_KEY=your_prod_service_role_key
PROD_SUPABASE_DEFAULT_KEY=your_prod_anon_key

# Cloudflare R2
CLOUDFLARE_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://your-r2-public-url

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_token

# Email (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@email.com
EMAIL_PASS=your_app_password
```

### Running Locally

```bash
npm run dev       # starts at http://localhost:3000
npm run build     # production build
npm run lint      # ESLint
```

### Database

Migrations are managed with the Supabase CLI. To apply all migrations to your dev project:

```bash
supabase db push
```

Migration files live in `supabase/migrations/` and are applied in date order. See `docs/DATABASE_ARCHITECTURE.md` for schema documentation.

---

## Pages

| Route | Description | Auth |
|---|---|---|
| `/` | Home — hero, featured listings, matchmaking CTA | Public |
| `/browse` | Listing search with map, filters, and saved toggle | Public |
| `/CampusHub` | Dorm reviews and campus housing info | Public |
| `/about` | Team and mission | Public |
| `/matchmaking` | Roommate concierge intake form | Public |
| `/login` | Email/password and Google sign-in | Public |
| `/reset-password` | Password reset via token | Public |
| `/add-listing` | Multi-step listing creation form | Landlord |
| `/add-sub-lease` | Sublease listing form | Student |
| `/_landlord/[landlordId]` | Public landlord profile page | Public |
| `/dashboard` | Role-aware redirect to student/landlord/admin dashboard | Authenticated |
| `/dashboard/student` | Saved listings, contacts, profile | Student |
| `/dashboard/landlord` | Listing management and analytics | Landlord |
| `/dashboard/admin` | User management, review moderation, DB tools | Admin |
| `/dashboard/view-as/[userId]` | Admin impersonation view | Admin |

---

## API Routes

### Auth — `/api/auth/`

| Method | Endpoint | Description |
|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handler — sign in, sign out, session |
| POST | `/api/auth/signup` | Create account with email/password, sends verification email |
| GET | `/api/auth/verify-email` | Consume email verification token |
| POST | `/api/auth/resend-verification` | Re-send verification email |
| POST | `/api/auth/forgot-password` | Generate reset token and send reset email |
| POST | `/api/auth/reset-password` | Consume reset token and update password |

### Users — `/api/`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/getUser` | Fetch the current user's full profile |
| POST | `/api/editProfile` | Update profile fields (name, phone, bio, role, etc.) |
| POST | `/api/uploadProfilePhoto` | Upload profile photo to R2 |
| GET | `/api/searchUsers` | Search users by name or email (admin / matchmaking) |

### Listings — `/api/`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/listings` | Fetch all active listings with units and amenities |
| GET | `/api/listing/[listingId]` | Fetch a single listing by ID |
| POST | `/api/addListing` | Create a new listing with units, amenities, and media |
| POST | `/api/upload` | Upload listing images to R2 |

### Landlord — `/api/landlord/`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/landlord/listings` | Fetch listings owned by the current landlord |
| GET/PATCH/DELETE | `/api/landlord/listings/[listingId]` | Get, update, or delete a specific listing |
| GET/POST/DELETE | `/api/landlord/listings/[listingId]/landlords` | Manage co-landlord assignments |
| GET | `/api/landlord/metrics` | Aggregated analytics (views, contacts, saves) |
| GET | `/api/landlord/reviews` | Reviews submitted for the landlord's listings |

### Favorites — `/api/`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/favorites` | Get all saved listing IDs for the current user |
| POST/DELETE | `/api/favorites/[listingId]` | Save or unsave a listing |

### Reviews — `/api/`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/submitReview` | Submit a review for a listing |
| POST | `/api/reviewVote` | Upvote or downvote a review |
| GET | `/api/pendingReviews` | Reviews awaiting moderation |
| GET | `/api/dormReviews` | Fetch dorm reviews (optionally filtered by dorm) |
| GET | `/api/dorms` | Fetch dorm list with metadata |

### Social / Engagement — `/api/`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/favorites` | (see above) |
| POST | `/api/contactLandlord` | Log a contact event and notify landlord |
| GET | `/api/contacted` | Listings the current user has contacted |
| POST | `/api/matchmaking` | Submit roommate concierge intake form |
| GET | `/api/testimonials` | Fetch homepage testimonials |
| POST | `/api/events` | Track GA4-style events server-side |

### Admin — `/api/admin/`

| Method | Endpoint | Description |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/admin/[table]` | Generic CRUD on any Supabase table |
| GET/PATCH | `/api/admin/pending-reviews` | Approve or reject pending reviews |
| GET | `/api/admin/schema` | Fetch live DB schema for the admin UI |
| GET | `/api/admin/db-env` | Show which DB environment is active |
| GET | `/api/admin/listing-images` | List R2 images for a listing |
| POST | `/api/admin/update-campus-walk-times` | Recalculate walk times for all listings |
| GET | `/api/admin/viewUser` | Look up a user by ID (for impersonation) |

### Webhooks — `/api/webhooks/`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/webhooks/new-user` | Triggered on new user creation — sends welcome email |
| POST | `/api/webhooks/new-listing` | Triggered on new listing — internal notification |

---

## Roles

Three user roles control access throughout the app:

| Role | Access |
|---|---|
| `student` | Browse, save, contact landlords, submit reviews, matchmaking |
| `landlord` | All student access + create/edit listings, view analytics |
| `admin` | All landlord access + user management, review moderation, DB tools, impersonation |

Role is stored in Supabase, cached in the NextAuth JWT, and refreshed automatically every 60 seconds. Always read role from `session.user.role` — never from `dbUser.role` (which is a foreign key ID, not the role name).

---

## Key Architectural Decisions

**Dual Supabase clients:** The service-role client (`src/lib/supabase.js`) is used in API routes where RLS should be bypassed (auth callbacks, admin operations). The anon clients (`src/lib/supabase/client.ts` and `server.ts`) are used for user-facing queries that respect RLS.

**Write-as-user RPCs:** All user-initiated writes go through `src/lib/supabaseWithUser.js` instead of direct Supabase calls. Each RPC sets `app.current_user_id` in PostgreSQL config within the same transaction so `fn_action_log()` can attribute every mutation to the authenticated user.

**URL-driven listing modal:** Any page can open a listing detail view by setting `?listing=<id>` in the URL. `GlobalListingModal` (mounted in the root layout) watches this param and fetches the listing. This enables shareable deep links and back-button support with no extra routing logic.

**JWT role caching:** User role and `profileComplete` are stored in the NextAuth JWT and refreshed every 60 seconds rather than on every request, keeping session reads at zero DB cost while still propagating admin-side role changes within a minute.

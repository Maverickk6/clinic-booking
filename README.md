# Clinic Booking API & Web Page

A full-stack clinic appointment booking system built with **Next.js 16 (App Router)**, **TypeORM**, and **Supabase PostgreSQL** — designed for deployment on Vercel or Render.

Implements all 5 levels of the [Koya Academy Assessment Spec](https://koyaacademy.com/assessment-api).

---

## 🔗 Live Application

| Resource | URL |
|---|---|
| **Web Page** | `https://<your-deployed-url>.vercel.app` |
| **API Base URL** | `https://<your-deployed-url>.vercel.app` |
| **GitHub Repo** | `https://github.com/Maverickk6/clinic-booking` |
| **API Key** | `clinic-demo-2026` |

---

## 📋 Endpoints Overview

All endpoints require the `X-API-Key` header (Level 2). Missing or invalid keys return `401`.

| Method | Path | Level | Description |
|---|---|---|---|
| `POST` | `/reset` | 1 | Clear all bookings and replace slots |
| `GET` | `/slots` | 1 | List slots (ordered by start time). Optional `?provider=...` filter |
| `POST` | `/bookings` | 1–5 | Book a slot (supports idempotency, rate limiting, collision protection) |
| `GET` | `/bookings` | 4 | List patient bookings by email (cursor-paginated) |
| `GET` | `/bookings/:id` | 1 | Retrieve booking by ID |
| `DELETE` | `/bookings/:id` | 3 | Cancel booking and release slot |

---

## 🎯 Level-by-Level Implementation

### Level 1: Slots, Booking & Lookup
- `POST /reset`: Resets database state and populates seed slots (supports custom slot arrays or auto-generates 12 slots).
- `GET /slots`: Lists all slots ordered ascending by start time, returning each slot's availability status (`available: boolean`).
- `POST /bookings`: Creates confirmed booking and returns full booking record with `201 Created`.
- `GET /bookings/:id`: Looks up booking by UUID; returns `404` if not found.

### Level 2: API Key Auth & Validation
- **Auth Guard**: Every route enforces `X-API-Key: clinic-demo-2026` (configurable via `CLINIC_API_KEY`). Wrong/missing key returns `401 Unauthorized`.
- **Validation**:
  - `slot_id`, `name`, `email` required → returns `400` if missing or whitespace-only.
  - Email format checked via regex → returns `400` if invalid.
  - Email normalized to lowercase and whitespace-trimmed.
  - Name whitespace-trimmed.
  - Slot existence verified → returns `404` if slot does not exist.
  - Slot start time checked against current time → returns `400` if slot has already started.

### Level 3: Concurrency Protection & Cancellation
- **Zero Double-Booking Guarantee**:
  - Bookings are executed inside atomic PostgreSQL transactions (`dataSource.transaction`).
  - Enforced at database level via a **partial unique index**:
    ```sql
    CREATE UNIQUE INDEX one_confirmed_per_slot
    ON bookings (slot_id)
    WHERE status = 'confirmed';
    ```
  - Simultaneous booking attempts for the same slot return `409 Conflict`.
- **Cancellation**:
  - `DELETE /bookings/:id` transitions status to `cancelled`.
  - Cancelling an already-cancelled booking returns `409 Conflict`.
  - Releasing a booking immediately frees the slot (`available: true`).

### Level 4: Idempotency & Pagination
- **Idempotency-Key Header**:
  - Retried requests with the same key and payload return the original booking with `201 Created` without duplicating records.
  - Reusing a key with a different body returns `422 Unprocessable Entity`.
  - Check executes before conflict evaluation to ensure reliable retries even if slot state changed.
- **Cursor-based Pagination**:
  - `GET /bookings?email=...&limit=...&cursor=...`
  - Limit validated between 1 and 50 (returns `400` on invalid values).
  - Returns `{ bookings: [...], next_cursor: "..." | null }`.
  - Case-insensitive email matching.

### Level 5: Spam Prevention / Rate Limiting
- Rolling 60-second window tracking booking attempts per email in `booking_attempts` table.
- Maximum 5 attempts per email per minute (failed attempts count toward limit).
- 6th attempt returns `429 Too Many Requests`.
- Includes `Retry-After` header specifying remaining seconds in the window.
- Independent limits per email address.

---

## 💻 Tech Stack

- **Framework**: Next.js 16 (App Router, Server-rendered routes + React client components)
- **Database**: PostgreSQL (hosted on Supabase via transaction pooler)
- **ORM**: TypeORM with EntitySchema
- **Styling**: Tailwind CSS

---

## 🚀 Environment Variables

| Variable | Description |
|---|---|
| `CLINIC_API_KEY` | Server-side API key for request authentication |
| `NEXT_PUBLIC_CLINIC_API_KEY` | Public key used by client-side web UI |
| `POSTGRES_URL` | Supabase PostgreSQL connection string (pooler) |
| `DATABASE_URL` | Fallback connection string (same as POSTGRES_URL) |
| `POSTGRES_SSL` | Set to `true` when using SSL for the Postgres connection |
| `POSTGRES_CA` | Optional CA certificate bundle for custom/self-signed certificate chains. When unset, TLS verification is relaxed unless you explicitly set `POSTGRES_SSL_REJECT_UNAUTHORIZED` |
| `POSTGRES_SSL_REJECT_UNAUTHORIZED` | Defaults to `true` only when `POSTGRES_CA` is set; otherwise it defaults to `false`. Setting this explicitly to `true` or `false` overrides the default behavior and controls Node's `rejectUnauthorized` setting for the database TLS connection |

---

## 🛠 Local Setup

```bash
# Clone and install
git clone https://github.com/Maverickk6/clinic-booking.git
cd clinic-booking
npm install

# Environment setup
cp .env.example .env
# Fill in POSTGRES_URL and CLINIC_API_KEY

# Run development server
npm run dev
```

Visit `http://localhost:3000` to interact with the booking UI.

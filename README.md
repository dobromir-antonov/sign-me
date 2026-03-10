# signMe — Group Hiking Registration

A serverless, no-build group registration system for Bulgarian mountain trekking events. An organizer fills out one form for the whole group, gets an email confirmation with a secure edit link, and can update or confirm the registration any time before the event.

---

## Features

- **Group registration** — organizer + up to 14 additional participants
- **Bulgarian EGN support** — auto-calculates age from personal ID numbers at event date
- **Edit mode** — token-based URL lets organizers update or confirm their registration
- **Email confirmation** — styled HTML email sent automatically on new submission (via Supabase trigger → Edge Function → Resend)
- **Declarations** — two mandatory checkboxes validated on submit; not persisted in the database
- **No build step** — single HTML file, no npm required

---

## Tech Stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | HTML5 · Vanilla JS · CSS3                    |
| Database | PostgreSQL via Supabase                      |
| Backend  | Deno · Supabase Edge Functions               |
| Email    | Resend API                                   |
| Hosting  | Any static host (Netlify, GitHub Pages, etc.) |

---

## Project Structure

```
signMe/
├── registration.html     # Single-page registration form (frontend)
├── index.ts              # Supabase Edge Function — sends confirmation emails
└── supabase_setup.sql    # Database schema, RLS policies, and export view
```

---

## Database Schema

### `registrations`

| Column       | Type        | Notes                                   |
|--------------|-------------|-----------------------------------------|
| `id`         | uuid (PK)   | Auto-generated                          |
| `created_at` | timestamptz | Auto-set on insert                      |
| `event`      | text        | Event name                              |
| `event_date` | date        | Used for edit-link expiry and age calc  |
| `status`     | text        | `pending` (default) · `confirmed` · `cancelled` |
| `edit_token` | uuid        | Unique token for edit links             |
| `notes`      | text        | Optional                                |

### `participants`

| Column            | Type        | Notes                                              |
|-------------------|-------------|----------------------------------------------------|
| `id`              | uuid (PK)   | Auto-generated                                     |
| `registration_id` | uuid (FK)   | → `registrations.id` · CASCADE delete             |
| `is_head`         | boolean     | `true` = organizer                                 |
| `name`            | text        | Full name (three names)                            |
| `egn`             | text        | 10-digit Bulgarian personal ID                     |
| `birth_date`      | date        | Extracted from EGN                                 |
| `age`             | integer     | Calculated: birth_date → event_date                |
| `phone`           | text        | Organizer only                                     |
| `email`           | text        | Organizer only                                     |

### Row-Level Security (anon role)

| Table           | INSERT | SELECT | UPDATE                          | DELETE |
|-----------------|--------|--------|---------------------------------|--------|
| `registrations` | ✓      | ✓      | ✓ (only while `event_date` ≥ today) | —      |
| `participants`  | ✓      | ✓      | —                               | ✓      |

### `export_view`

A read-only view joining `registrations` and `participants` (non-cancelled) — intended for insurance export.

---

## Setup

### 1. Database

Run `supabase_setup.sql` in **Supabase → SQL Editor → New query → Run**.

### 2. Edge Function

The function must be deployed into your Supabase project and wired to a database webhook on `INSERT` into `registrations`.

```bash
supabase functions deploy send-confirmation
```

Set the required secrets:

```bash
supabase secrets set RESEND_API_KEY=re_xxxx
supabase secrets set SITE_URL=https://your-domain.netlify.app
supabase secrets set FROM_EMAIL=noreply@yourdomain.com
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase.

### 3. Frontend

Edit the four constants at the top of the `<script>` block in `registration.html`:

```javascript
const SB_URL  = 'https://your-project.supabase.co';  // Supabase project URL
const SB_KEY  = 'your_anon_public_key';              // Supabase anon/publishable key
const EV_NAME = 'Пролетен поход — Рила';             // Event name (change per event)
const EV_DATE = '2026-04-20';                        // Event date YYYY-MM-DD
```

### 4. Deploy Frontend

Serve `registration.html` from any static host. No build step required.

---

## How It Works

```
1.  Organizer fills out the form (own data + up to 14 participants)
2.  Client-side validation: names, EGNs, email, mandatory declarations
3.  POST /rest/v1/registrations  →  registration row created (status: pending)
4.  POST /rest/v1/participants   →  all participants inserted
5.  Supabase webhook fires index.ts (send-confirmation)
6.  Edge function fetches participants, builds HTML email, sends via Resend
7.  Organizer receives email with participant table + secure edit link
8.  Edit link: registration.html?token=<edit_token>
    - Loads form pre-filled with saved data
    - Organizer can save changes (PATCH reg + DELETE/re-INSERT participants)
    - Organizer can confirm registration (PATCH status → confirmed)
    - Link expires when event_date passes
```

---

## Updating for a New Event

Only two values need changing in `registration.html`:

```javascript
const EV_NAME = 'Нов поход — Витоша';
const EV_DATE = '2026-09-15';
```

No database migration or redeployment needed.

---

## License

MIT

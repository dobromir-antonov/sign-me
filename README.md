# signMe — Group Event Registration System

A lightweight, serverless group registration system for Bulgarian hiking/mountain trekking events. Participants fill out a single-page form, receive an email confirmation, and can edit their registration via a secure link until the event date.

---

## Features

- **Group registration** — one organizer + up to 14 participants per group
- **Bulgarian EGN support** — auto-calculates age from personal ID numbers
- **Edit mode** — secure token-based link lets organizers update their registration
- **Email confirmation** — automated HTML email sent on successful submission
- **No build step** — pure HTML/CSS/JS frontend, no npm required
- **Serverless backend** — Supabase Edge Function handles email delivery

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | HTML5 + Vanilla JavaScript + CSS3   |
| Database | PostgreSQL via Supabase             |
| Backend  | Deno · Supabase Edge Functions      |
| Email    | Resend API                          |
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
| Column          | Type    | Description                              |
|-----------------|---------|------------------------------------------|
| id              | UUID    | Primary key                              |
| event           | text    | Event name                               |
| event_date      | date    | Event date (used for edit link expiry)   |
| status          | text    | `pending` / `confirmed` / `cancelled`   |
| edit_token      | UUID    | Secure token for edit links              |
| notes           | text    | Optional notes                           |

### `participants`
| Column     | Type    | Description                              |
|------------|---------|------------------------------------------|
| id         | UUID    | Primary key                              |
| head_id    | UUID    | FK → registrations (CASCADE delete)      |
| is_head    | boolean | `true` = organizer                       |
| name       | text    | Full name (3 names)                      |
| egn        | text    | Bulgarian EGN (10-digit personal ID)     |
| birth_date | date    | Extracted from EGN                       |
| age        | integer | Calculated (birth_date → event_date)     |
| phone      | text    | Organizer only                           |
| email      | text    | Organizer only                           |

---

## Setup

### 1. Database

Run `supabase_setup.sql` in **Supabase → SQL Editor**. This creates the tables, RLS policies, and the `export_view` view.

### 2. Edge Function

Deploy the email function:

```bash
supabase functions deploy send-confirmation
```

Set the required secrets:

```bash
supabase secrets set RESEND_API_KEY=re_xxxx
supabase secrets set SITE_URL=https://your-domain.netlify.app
supabase secrets set FROM_EMAIL=noreply@yourdomain.com
supabase secrets set SUPABASE_URL=https://xxxx.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. Frontend Configuration

Edit the constants at the top of `registration.html`:

```javascript
const SB_URL  = 'https://your-project.supabase.co';   // Supabase project URL
const SB_KEY  = 'your_anon_public_key';               // Supabase anon key
const EV_NAME = 'Пролетен поход — Рила';              // Event name
const EV_DATE = '2026-04-20';                         // Event date (YYYY-MM-DD)
```

### 4. Deploy Frontend

Host `registration.html` on any static file server — Netlify, GitHub Pages, Vercel, or a plain web server. No build step required.

---

## How It Works

```
1. User fills out the registration form
2. Form validates names, EGNs, email, and required checkboxes
3. Registration + participants are saved to Supabase
4. Supabase trigger fires → Edge Function executes
5. Confirmation email is sent to the organizer with:
   - Participant list (name, EGN, age)
   - Secure edit link (valid until event date)
   - Registration reference ID
6. Organizer can click the link to edit or confirm the registration
```

---

## Customizing for a New Event

Update these four values in `registration.html` before each event:

```javascript
const EV_NAME = 'Your Event Name';
const EV_DATE = 'YYYY-MM-DD';
```

No other changes are needed for a new event.

---

## License

MIT

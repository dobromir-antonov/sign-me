# signMe — Group Hiking Registration

A serverless, no-build group registration system for Bulgarian mountain trekking events. An organizer fills out one form for the whole group, gets an email confirmation with a secure edit link, and can update or confirm the registration any time before the event.

---

## Features

- **Group registration** — organizer + up to 14 additional participants
- **Bulgarian EGN support** — auto-calculates age from personal ID numbers at event date
- **Edit mode** — token-based URL lets organizers update or confirm their registration
- **Email confirmation** — styled HTML email sent client-side via EmailJS on new submission
- **Cancel registration** — organizer can cancel from the edit link; disables further editing
- **Declarations** — two mandatory checkboxes validated on submit; not persisted in the database
- **No backend required** — all logic runs in the browser; only Supabase (DB) and EmailJS (email) are external services

---

## Tech Stack

| Layer    | Technology                                    |
|----------|-----------------------------------------------|
| Frontend | HTML5 · Vanilla JS · CSS3                     |
| Database | PostgreSQL via Supabase                       |
| Email    | EmailJS (client-side, no server needed)       |
| Hosting  | Any static host (Netlify, GitHub Pages, etc.) |

---

## Project Structure

```
signMe/
├── index.html                                    # Registration form
├── app.js                                        # All JavaScript logic
├── app.css                                       # All styles
├── assets/
│   └── logo.jpg
├── database/
│   └── supabase_setup.sql                        # DB schema, RLS policies, export view
└── email/
    ├── emailjs/
    │   └── event-registration.template.html      # EmailJS dashboard template (paste into editor)
    └── brevo/
        ├── send-email.supabase-edge-function.ts  # Legacy Brevo edge function (archived)
        └── preview-email.html                    # Legacy email preview (archived)
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

### Registration statuses

| Status      | Description                              |
|-------------|------------------------------------------|
| `pending`   | Submitted, awaiting confirmation         |
| `confirmed` | Organizer confirmed participation        |
| `cancelled` | Organizer cancelled — editing disabled   |

### Row-Level Security (anon role)

| Table           | INSERT | SELECT | UPDATE                              | DELETE |
|-----------------|--------|--------|-------------------------------------|--------|
| `registrations` | ✓      | ✓      | ✓ (only while `event_date` ≥ today) | —      |
| `participants`  | ✓      | ✓      | —                                   | ✓      |

### `export_view`

A read-only view joining `registrations` and `participants` (non-cancelled) — intended for insurance export.

---

## Setup

### 1. Database

Run `database/supabase_setup.sql` in **Supabase → SQL Editor → New query → Run**.

### 2. EmailJS

1. Create an account at [emailjs.com](https://www.emailjs.com)
2. Add an **Email Service** (Gmail, Outlook, etc.) — note the **Service ID**
3. Create a new **Email Template**:
   - Copy the HTML from `email/emailjs/event-registration.template.html` into the template body
   - Set **To** field: `{{to_email}}`
   - Set **Subject**: `Записване — {{event}} ({{total}} уч.)`
   - Note the **Template ID**
4. Copy your **Public Key** from Account → API Keys

### 3. Frontend

Edit the constants at the top of `app.js`:

```javascript
const SB_URL          = 'https://your-project.supabase.co'; // Supabase project URL
const SB_KEY          = 'your_anon_public_key';             // Supabase anon/publishable key

const EJS_PUBLIC_KEY  = 'your_public_key';                  // EmailJS Account → API Keys
const EJS_SERVICE_ID  = 'your_service_id';                  // EmailJS Email Services → Service ID
const EJS_TEMPLATE_ID = 'your_template_id';                 // EmailJS Email Templates → Template ID

const EV_NAME = 'Пролетен поход — Рила';                    // Event name (change per event)
const EV_DATE = '2026-04-20';                               // Event date YYYY-MM-DD
```

### 4. Build & Deploy

```bash
npm run build   # copies index.html, app.css, app.js, assets/ into build/
```

Then serve the `build/` directory from any static host.

---

## How It Works

```
1.  Organizer fills out the form (own data + up to 14 participants)
2.  Client-side validation: names, EGNs, email, mandatory declarations
3.  POST /rest/v1/registrations  →  registration row created (status: pending)
4.  POST /rest/v1/participants   →  all participants inserted
5.  EmailJS sends a styled HTML confirmation email directly from the browser
6.  Organizer receives email with participant table + secure edit link
7.  Edit link: index.html?token=<edit_token>
    - Loads form pre-filled with saved data
    - Organizer can save changes (PATCH reg + DELETE/re-INSERT participants)
    - Organizer can confirm registration  (PATCH status → confirmed)
    - Organizer can cancel registration   (PATCH status → cancelled, editing disabled)
    - Link expires when event_date passes
```

---

## Updating for a New Event

Only two values need changing in `app.js`:

```javascript
const EV_NAME = 'Нов поход — Витоша';
const EV_DATE = '2026-09-15';
```

No database migration or redeployment needed.

---

## License

MIT

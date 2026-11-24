# Cadence Events — Event Management, Ticketing & Gate Operations Platform

A full-stack event management, ticketing, real-time QR entry verification, and reporting platform built with a **42-table relational database schema**, **40 custom event templates**, **5 role-based access control (RBAC) roles**, and **5 exportable reporting modules**.

## Key Features

- **42 Interconnected Relational Tables**: Covering Identity & RBAC (`roles`, `permissions`, `role_permissions`, `users`, `user_sessions`, `audit_logs`), Venues & Templates (`event_categories`, `event_templates`, `venues`, `venue_zones`, `venue_seats`, `entry_gates`, `scanner_devices`), Events & Programming (`events`, `event_sessions`, `speakers`, `session_speakers`, `sponsors`, `event_sponsors`, `event_tasks`), Ticketing & Commerce (`ticket_tiers`, `promo_codes`, `tax_rates`, `orders`, `order_items`, `payments`, `refunds`, `tickets`), Scanning & Attendance (`ticket_scans`, `attendance_logs`, `session_checkins`, `gate_shifts`, `capacity_snapshots`), Engagement (`waitlist_entries`, `email_campaigns`, `notifications`, `event_reviews`, `saved_events`), and Reporting & Finance (`organizer_payouts`, `saved_reports`, `report_exports`, `webhook_endpoints`).
- **40 Custom Event Templates (`TPL-001` – `TPL-040`)**: Pre-configured blueprints across 8 categories with default ticket tiers, schedule tracks, and production checklists.
- **Role-Based Access Control (RBAC)**:
  - `admin` (Platform Administrator)
  - `organizer` (Event Organizer)
  - `finance` (Finance & Reporting Analyst)
  - `gate_staff` (Gate & Scanner Staff)
  - `attendee` (Ticket Attendee)
- **Cryptographic QR Ticket Scanning & Real-Time Attendance**: HMAC-SHA256 signed QR payloads, anti-passback duplicate entry detection, forged signature rejection, IN/OUT gate tracking, and live Server-Sent Events (SSE) occupancy updates.
- **5 Reporting Modules**: Sales & Revenue, Attendance & Gate Velocity, Template Utilization Matrix, Financial Payouts & Refunds, and Security & Audit Trail with CSV/JSON downloads.

## Running the Live Web Platform

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use **Admin Claim** in the Workspace Access modal to initialize the first Platform Administrator (or configure `ADMIN_PASSCODE` in environment secrets), or create an Organizer, Gate Staff, Finance Analyst, or Attendee account via **Create Account**.

## Environment Variables

See `.env.example`:
- `SESSION_SECRET`: Secret key for signing session tokens and QR ticket HMAC signatures.
- `ADMIN_PASSCODE`: Optional server-side passcode required to bootstrap the first administrator account.

## Companion Flask + SQLAlchemy Blueprint (`flask_app/`)

For academic rubric alignment (CSE601330), the `flask_app/` directory provides the SQLAlchemy ORM mirror (`models.py` with all 42 models), Jinja2 template inheritance (`templates/base.html`, `templates/index.html`, `templates/scanner.html`), server-side validation, flash messages, Post-Redirect-Get (PRG), and `requirements.txt`.

```bash
cd flask_app
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
flask --app app run --debug
```

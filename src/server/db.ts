import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'cadence_events.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export interface ColumnMeta {
  name: string;
  type: 'integer' | 'text' | 'real' | 'boolean' | 'datetime' | 'json';
  required?: boolean;
  readonly?: boolean;
  fk?: string;
}

export interface TableMeta {
  name: string;
  domain: string;
  label: string;
  description: string;
  columns: ColumnMeta[];
}

export function initSchema(): void {
  db.exec(`
    -- Domain A: Identity, RBAC & Sessions (6 tables)
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 10,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      module TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      UNIQUE(role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
      phone TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      organization_name TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      ip_address TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_table TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Domain B: Venues, Gates & 40 Event Templates (7 tables)
    CREATE TABLE IF NOT EXISTS event_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon_name TEXT NOT NULL DEFAULT 'Calendar',
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS event_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
      description TEXT NOT NULL,
      default_duration_hours INTEGER NOT NULL DEFAULT 8 CHECK (default_duration_hours > 0),
      default_capacity INTEGER NOT NULL DEFAULT 250 CHECK (default_capacity > 0),
      suggested_ticket_price_cents INTEGER NOT NULL DEFAULT 4500 CHECK (suggested_ticket_price_cents >= 0),
      layout_style TEXT NOT NULL DEFAULT 'Conference Stage',
      color_accent TEXT NOT NULL DEFAULT '#2563EB',
      checklist_json TEXT NOT NULL DEFAULT '[]',
      default_tiers_json TEXT NOT NULL DEFAULT '[]',
      default_schedule_json TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'United States',
      total_capacity INTEGER NOT NULL CHECK (total_capacity > 0),
      venue_type TEXT NOT NULL DEFAULT 'Convention Center',
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      contact_email TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS venue_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      zone_code TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      floor_level TEXT NOT NULL DEFAULT 'Level 1',
      is_vip INTEGER NOT NULL DEFAULT 0 CHECK (is_vip IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS venue_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone_id INTEGER NOT NULL REFERENCES venue_zones(id) ON DELETE CASCADE,
      row_label TEXT NOT NULL,
      seat_number TEXT NOT NULL,
      seat_type TEXT NOT NULL DEFAULT 'Standard',
      is_accessible INTEGER NOT NULL DEFAULT 0 CHECK (is_accessible IN (0, 1)),
      UNIQUE(zone_id, row_label, seat_number)
    );

    CREATE TABLE IF NOT EXISTS entry_gates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      gate_name TEXT NOT NULL,
      gate_code TEXT NOT NULL UNIQUE,
      gate_type TEXT NOT NULL DEFAULT 'General Entry',
      assigned_staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS scanner_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gate_id INTEGER NOT NULL REFERENCES entry_gates(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      device_serial TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'standby', 'maintenance')),
      last_heartbeat_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Domain C: Events, Schedules & Speakers (7 tables)
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      template_id INTEGER REFERENCES event_templates(id) ON DELETE SET NULL,
      category_id INTEGER NOT NULL REFERENCES event_categories(id) ON DELETE RESTRICT,
      venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE RESTRICT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      description TEXT NOT NULL,
      banner_url TEXT NOT NULL DEFAULT '/src/assets/images/hero_summit_stage_1795541473829.jpg',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'live', 'completed', 'cancelled')),
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      zone_id INTEGER REFERENCES venue_zones(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      track_name TEXT NOT NULL DEFAULT 'Main Stage',
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 100 CHECK (capacity > 0),
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS speakers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      photo_url TEXT NOT NULL DEFAULT '/src/assets/images/avatar_organizer_1795541474034.jpg'
    );

    CREATE TABLE IF NOT EXISTS session_speakers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
      speaker_id INTEGER NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
      role_label TEXT NOT NULL DEFAULT 'Keynote Speaker',
      UNIQUE(session_id, speaker_id)
    );

    CREATE TABLE IF NOT EXISTS sponsors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      website TEXT NOT NULL DEFAULT '',
      tier_default TEXT NOT NULL DEFAULT 'Gold',
      contact_email TEXT NOT NULL DEFAULT '',
      logo_text TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS event_sponsors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      sponsor_id INTEGER NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
      sponsorship_tier TEXT NOT NULL DEFAULT 'Gold',
      contribution_cents INTEGER NOT NULL DEFAULT 500000 CHECK (contribution_cents >= 0),
      UNIQUE(event_id, sponsor_id)
    );

    CREATE TABLE IF NOT EXISTS event_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
      due_date TEXT NOT NULL
    );

    -- Domain D: Ticketing, Pricing & Orders (8 tables)
    CREATE TABLE IF NOT EXISTS ticket_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      zone_id INTEGER REFERENCES venue_zones(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      quantity_total INTEGER NOT NULL CHECK (quantity_total > 0),
      quantity_sold INTEGER NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
      sales_start_at TEXT NOT NULL DEFAULT (datetime('now')),
      sales_end_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days')),
      max_per_order INTEGER NOT NULL DEFAULT 10 CHECK (max_per_order > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
      discount_value INTEGER NOT NULL CHECK (discount_value > 0),
      max_uses INTEGER NOT NULL DEFAULT 100 CHECK (max_uses > 0),
      current_uses INTEGER NOT NULL DEFAULT 0 CHECK (current_uses >= 0),
      valid_until TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS tax_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_code TEXT NOT NULL UNIQUE,
      tax_name TEXT NOT NULL,
      rate_percent REAL NOT NULL CHECK (rate_percent >= 0),
      is_inclusive INTEGER NOT NULL DEFAULT 0 CHECK (is_inclusive IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
      promo_code_id INTEGER REFERENCES promo_codes(id) ON DELETE SET NULL,
      tax_rate_id INTEGER REFERENCES tax_rates(id) ON DELETE SET NULL,
      order_number TEXT NOT NULL UNIQUE,
      subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
      discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
      tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
      total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'refunded', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      ticket_tier_id INTEGER NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
      line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL DEFAULT 'card',
      transaction_ref TEXT NOT NULL UNIQUE,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
      paid_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('requested', 'completed', 'rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      ticket_tier_id INTEGER NOT NULL REFERENCES ticket_tiers(id) ON DELETE RESTRICT,
      attendee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      seat_id INTEGER REFERENCES venue_seats(id) ON DELETE SET NULL,
      ticket_code TEXT NOT NULL UNIQUE,
      qr_signature TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      holder_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'checked_in', 'cancelled', 'refunded')),
      checked_in_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Domain E: Ticket Scanning & Real-Time Attendance (5 tables)
    CREATE TABLE IF NOT EXISTS ticket_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      gate_id INTEGER NOT NULL REFERENCES entry_gates(id) ON DELETE RESTRICT,
      scanner_device_id INTEGER REFERENCES scanner_devices(id) ON DELETE SET NULL,
      scanned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      scan_result TEXT NOT NULL CHECK (scan_result IN ('VALID', 'ALREADY_CHECKED_IN', 'INVALID_SIGNATURE', 'TICKET_CANCELLED', 'WRONG_EVENT', 'NOT_FOUND')),
      rejection_reason TEXT NOT NULL DEFAULT '',
      scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      zone_id INTEGER REFERENCES venue_zones(id) ON DELETE SET NULL,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
      recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES event_sessions(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      checked_in_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      checked_in_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, ticket_id)
    );

    CREATE TABLE IF NOT EXISTS gate_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gate_id INTEGER NOT NULL REFERENCES entry_gates(id) ON DELETE CASCADE,
      staff_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      shift_start TEXT NOT NULL,
      shift_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled', 'active', 'completed'))
    );

    CREATE TABLE IF NOT EXISTS capacity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      current_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
      peak_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (peak_occupancy >= 0),
      total_scans_valid INTEGER NOT NULL DEFAULT 0 CHECK (total_scans_valid >= 0),
      total_scans_rejected INTEGER NOT NULL DEFAULT 0 CHECK (total_scans_rejected >= 0),
      captured_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Domain F: Marketing, Notifications & Engagement (5 tables)
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      ticket_tier_id INTEGER REFERENCES ticket_tiers(id) ON DELETE SET NULL,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'converted')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS email_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      segment TEXT NOT NULL DEFAULT 'All Ticket Holders',
      sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
      open_rate_percent REAL NOT NULL DEFAULT 0 CHECK (open_rate_percent >= 0),
      status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'scheduled', 'sent')),
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'sms')),
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      is_verified_attendee INTEGER NOT NULL DEFAULT 1 CHECK (is_verified_attendee IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS saved_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, event_id)
    );

    -- Domain G: Reporting, Finance & Compliance (4 tables)
    CREATE TABLE IF NOT EXISTS organizer_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      gross_cents INTEGER NOT NULL CHECK (gross_cents >= 0),
      platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
      net_payout_cents INTEGER NOT NULL CHECK (net_payout_cents >= 0),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('pending', 'scheduled', 'paid')),
      scheduled_date TEXT NOT NULL,
      paid_at TEXT
    );

    CREATE TABLE IF NOT EXISTS saved_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      report_type TEXT NOT NULL,
      title TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}',
      last_generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS report_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saved_report_id INTEGER NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
      exported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'json')),
      row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
      file_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      target_url TEXT NOT NULL,
      event_types TEXT NOT NULL DEFAULT 'ticket.purchased,ticket.scanned',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(ticket_code);
    CREATE INDEX IF NOT EXISTS idx_tickets_event ON tickets(event_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_scans_event ON ticket_scans(event_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_logs_event ON attendance_logs(event_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  `);
}

export const SCHEMA_TABLES: TableMeta[] = [
  // Domain A: Identity, RBAC & Sessions
  {
    name: 'roles',
    domain: 'Identity & RBAC',
    label: 'Roles',
    description: 'Platform RBAC role definitions and hierarchy levels.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'description', type: 'text', required: true },
      { name: 'level', type: 'integer', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'permissions',
    domain: 'Identity & RBAC',
    label: 'Permissions',
    description: 'Granular capability permissions mapped to roles.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'code', type: 'text', required: true },
      { name: 'module', type: 'text', required: true },
      { name: 'description', type: 'text', required: true },
    ],
  },
  {
    name: 'role_permissions',
    domain: 'Identity & RBAC',
    label: 'Role Permissions',
    description: 'Many-to-many junction table linking roles and permissions.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'role_id', type: 'integer', required: true, fk: 'roles.id' },
      { name: 'permission_id', type: 'integer', required: true, fk: 'permissions.id' },
    ],
  },
  {
    name: 'users',
    domain: 'Identity & RBAC',
    label: 'Users',
    description: 'Authenticated organizers, gate staff, finance analysts, admins, and attendees.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'full_name', type: 'text', required: true },
      { name: 'email', type: 'text', required: true },
      { name: 'role_id', type: 'integer', required: true, fk: 'roles.id' },
      { name: 'phone', type: 'text' },
      { name: 'organization_name', type: 'text' },
      { name: 'is_active', type: 'boolean', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'user_sessions',
    domain: 'Identity & RBAC',
    label: 'User Sessions',
    description: 'Server-side hashed session tokens with expiry timestamps.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'ip_address', type: 'text' },
      { name: 'user_agent', type: 'text' },
      { name: 'expires_at', type: 'datetime', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'audit_logs',
    domain: 'Identity & RBAC',
    label: 'Audit Logs',
    description: 'Immutable compliance log of mutations, role changes, and gate overrides.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'user_id', type: 'integer', fk: 'users.id' },
      { name: 'action', type: 'text', required: true },
      { name: 'entity_table', type: 'text', required: true },
      { name: 'entity_id', type: 'integer' },
      { name: 'details', type: 'text', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },

  // Domain B: Venues, Gates & 40 Event Templates
  {
    name: 'event_categories',
    domain: 'Venues & Templates',
    label: 'Event Categories',
    description: 'Primary classification taxonomy for events and templates.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'name', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'icon_name', type: 'text', required: true },
      { name: 'description', type: 'text' },
    ],
  },
  {
    name: 'event_templates',
    domain: 'Venues & Templates',
    label: 'Event Templates (40)',
    description: '40 pre-built customizable event blueprints with tiers, schedules, and checklists.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'code', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'category_id', type: 'integer', required: true, fk: 'event_categories.id' },
      { name: 'description', type: 'text', required: true },
      { name: 'default_duration_hours', type: 'integer', required: true },
      { name: 'default_capacity', type: 'integer', required: true },
      { name: 'suggested_ticket_price_cents', type: 'integer', required: true },
      { name: 'layout_style', type: 'text', required: true },
      { name: 'color_accent', type: 'text', required: true },
      { name: 'is_active', type: 'boolean', required: true },
    ],
  },
  {
    name: 'venues',
    domain: 'Venues & Templates',
    label: 'Venues',
    description: 'Physical and hybrid venues hosting scheduled events.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'name', type: 'text', required: true },
      { name: 'address', type: 'text', required: true },
      { name: 'city', type: 'text', required: true },
      { name: 'country', type: 'text', required: true },
      { name: 'total_capacity', type: 'integer', required: true },
      { name: 'venue_type', type: 'text', required: true },
      { name: 'timezone', type: 'text', required: true },
      { name: 'contact_email', type: 'text' },
    ],
  },
  {
    name: 'venue_zones',
    domain: 'Venues & Templates',
    label: 'Venue Zones',
    description: 'Distinct halls, lounges, and sections inside a venue.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'venue_id', type: 'integer', required: true, fk: 'venues.id' },
      { name: 'name', type: 'text', required: true },
      { name: 'zone_code', type: 'text', required: true },
      { name: 'capacity', type: 'integer', required: true },
      { name: 'floor_level', type: 'text', required: true },
      { name: 'is_vip', type: 'boolean', required: true },
    ],
  },
  {
    name: 'venue_seats',
    domain: 'Venues & Templates',
    label: 'Venue Seats',
    description: 'Assigned seating rows and accessible seats inside venue zones.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'zone_id', type: 'integer', required: true, fk: 'venue_zones.id' },
      { name: 'row_label', type: 'text', required: true },
      { name: 'seat_number', type: 'text', required: true },
      { name: 'seat_type', type: 'text', required: true },
      { name: 'is_accessible', type: 'boolean', required: true },
    ],
  },
  {
    name: 'entry_gates',
    domain: 'Venues & Templates',
    label: 'Entry Gates',
    description: 'Check-in gates assigned to venues and gate staff.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'venue_id', type: 'integer', required: true, fk: 'venues.id' },
      { name: 'gate_name', type: 'text', required: true },
      { name: 'gate_code', type: 'text', required: true },
      { name: 'gate_type', type: 'text', required: true },
      { name: 'assigned_staff_id', type: 'integer', fk: 'users.id' },
      { name: 'is_open', type: 'boolean', required: true },
    ],
  },
  {
    name: 'scanner_devices',
    domain: 'Venues & Templates',
    label: 'Scanner Devices',
    description: 'Registered handheld and kiosk QR scanners at entry gates.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'gate_id', type: 'integer', required: true, fk: 'entry_gates.id' },
      { name: 'device_name', type: 'text', required: true },
      { name: 'device_serial', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'last_heartbeat_at', type: 'datetime', readonly: true },
    ],
  },

  // Domain C: Events, Schedules & Speakers
  {
    name: 'events',
    domain: 'Events & Programming',
    label: 'Events',
    description: 'Published and draft events linked to organizers, templates, categories, and venues.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'organizer_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'template_id', type: 'integer', fk: 'event_templates.id' },
      { name: 'category_id', type: 'integer', required: true, fk: 'event_categories.id' },
      { name: 'venue_id', type: 'integer', required: true, fk: 'venues.id' },
      { name: 'title', type: 'text', required: true },
      { name: 'slug', type: 'text', required: true },
      { name: 'summary', type: 'text', required: true },
      { name: 'start_at', type: 'datetime', required: true },
      { name: 'end_at', type: 'datetime', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'capacity', type: 'integer', required: true },
      { name: 'is_featured', type: 'boolean', required: true },
    ],
  },
  {
    name: 'event_sessions',
    domain: 'Events & Programming',
    label: 'Event Sessions',
    description: 'Time-boxed agenda tracks, keynotes, and workshops inside an event.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'zone_id', type: 'integer', fk: 'venue_zones.id' },
      { name: 'title', type: 'text', required: true },
      { name: 'track_name', type: 'text', required: true },
      { name: 'start_at', type: 'datetime', required: true },
      { name: 'end_at', type: 'datetime', required: true },
      { name: 'capacity', type: 'integer', required: true },
    ],
  },
  {
    name: 'speakers',
    domain: 'Events & Programming',
    label: 'Speakers',
    description: 'Speaker directory with titles, companies, and biographies.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'full_name', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'company', type: 'text', required: true },
      { name: 'email', type: 'text', required: true },
      { name: 'bio', type: 'text' },
    ],
  },
  {
    name: 'session_speakers',
    domain: 'Events & Programming',
    label: 'Session Speakers',
    description: 'Junction mapping speakers to specific event sessions.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'session_id', type: 'integer', required: true, fk: 'event_sessions.id' },
      { name: 'speaker_id', type: 'integer', required: true, fk: 'speakers.id' },
      { name: 'role_label', type: 'text', required: true },
    ],
  },
  {
    name: 'sponsors',
    domain: 'Events & Programming',
    label: 'Sponsors',
    description: 'Corporate partners and event sponsors.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'name', type: 'text', required: true },
      { name: 'website', type: 'text' },
      { name: 'tier_default', type: 'text', required: true },
      { name: 'contact_email', type: 'text' },
    ],
  },
  {
    name: 'event_sponsors',
    domain: 'Events & Programming',
    label: 'Event Sponsors',
    description: 'Sponsorship commitments and financial contributions per event.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'sponsor_id', type: 'integer', required: true, fk: 'sponsors.id' },
      { name: 'sponsorship_tier', type: 'text', required: true },
      { name: 'contribution_cents', type: 'integer', required: true },
    ],
  },
  {
    name: 'event_tasks',
    domain: 'Events & Programming',
    label: 'Event Tasks',
    description: 'Operational production checklists generated from templates or added by organizers.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'assigned_to', type: 'integer', fk: 'users.id' },
      { name: 'title', type: 'text', required: true },
      { name: 'priority', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'due_date', type: 'datetime', required: true },
    ],
  },

  // Domain D: Ticketing, Pricing & Orders
  {
    name: 'ticket_tiers',
    domain: 'Ticketing & Commerce',
    label: 'Ticket Tiers',
    description: 'Pricing tiers, allocations, and sold counts per event.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'zone_id', type: 'integer', fk: 'venue_zones.id' },
      { name: 'name', type: 'text', required: true },
      { name: 'price_cents', type: 'integer', required: true },
      { name: 'quantity_total', type: 'integer', required: true },
      { name: 'quantity_sold', type: 'integer', required: true },
      { name: 'max_per_order', type: 'integer', required: true },
      { name: 'is_active', type: 'boolean', required: true },
    ],
  },
  {
    name: 'promo_codes',
    domain: 'Ticketing & Commerce',
    label: 'Promo Codes',
    description: 'Discount codes with usage limits and expiration dates.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', fk: 'events.id' },
      { name: 'code', type: 'text', required: true },
      { name: 'discount_type', type: 'text', required: true },
      { name: 'discount_value', type: 'integer', required: true },
      { name: 'max_uses', type: 'integer', required: true },
      { name: 'current_uses', type: 'integer', required: true },
      { name: 'valid_until', type: 'datetime', required: true },
      { name: 'is_active', type: 'boolean', required: true },
    ],
  },
  {
    name: 'tax_rates',
    domain: 'Ticketing & Commerce',
    label: 'Tax Rates',
    description: 'Regional tax rates applied during ticket checkout.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'region_code', type: 'text', required: true },
      { name: 'tax_name', type: 'text', required: true },
      { name: 'rate_percent', type: 'real', required: true },
      { name: 'is_inclusive', type: 'boolean', required: true },
    ],
  },
  {
    name: 'orders',
    domain: 'Ticketing & Commerce',
    label: 'Orders',
    description: 'Completed and refunded customer ticket orders.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'order_number', type: 'text', required: true },
      { name: 'subtotal_cents', type: 'integer', required: true },
      { name: 'discount_cents', type: 'integer', required: true },
      { name: 'tax_cents', type: 'integer', required: true },
      { name: 'total_cents', type: 'integer', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'order_items',
    domain: 'Ticketing & Commerce',
    label: 'Order Items',
    description: 'Line items linking orders to specific ticket tiers and quantities.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'order_id', type: 'integer', required: true, fk: 'orders.id' },
      { name: 'ticket_tier_id', type: 'integer', required: true, fk: 'ticket_tiers.id' },
      { name: 'quantity', type: 'integer', required: true },
      { name: 'unit_price_cents', type: 'integer', required: true },
      { name: 'line_total_cents', type: 'integer', required: true },
    ],
  },
  {
    name: 'payments',
    domain: 'Ticketing & Commerce',
    label: 'Payments',
    description: 'Payment settlement transactions tied to orders.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'order_id', type: 'integer', required: true, fk: 'orders.id' },
      { name: 'payment_method', type: 'text', required: true },
      { name: 'transaction_ref', type: 'text', required: true },
      { name: 'amount_cents', type: 'integer', required: true },
      { name: 'currency', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'paid_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'refunds',
    domain: 'Ticketing & Commerce',
    label: 'Refunds',
    description: 'Refund ledger linked to payments and processing finance staff.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'payment_id', type: 'integer', required: true, fk: 'payments.id' },
      { name: 'processed_by', type: 'integer', fk: 'users.id' },
      { name: 'amount_cents', type: 'integer', required: true },
      { name: 'reason', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'tickets',
    domain: 'Ticketing & Commerce',
    label: 'Tickets',
    description: 'Issued attendee passes with unique codes and HMAC-SHA256 QR signatures.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'order_item_id', type: 'integer', required: true, fk: 'order_items.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'ticket_tier_id', type: 'integer', required: true, fk: 'ticket_tiers.id' },
      { name: 'attendee_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'seat_id', type: 'integer', fk: 'venue_seats.id' },
      { name: 'ticket_code', type: 'text', required: true },
      { name: 'holder_name', type: 'text', required: true },
      { name: 'holder_email', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'checked_in_at', type: 'datetime' },
    ],
  },

  // Domain E: Ticket Scanning & Real-Time Attendance
  {
    name: 'ticket_scans',
    domain: 'Scanning & Attendance',
    label: 'Ticket Scans',
    description: 'Every QR verification attempt (valid and rejected) logged at entry gates.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'ticket_id', type: 'integer', fk: 'tickets.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'gate_id', type: 'integer', required: true, fk: 'entry_gates.id' },
      { name: 'scanner_device_id', type: 'integer', fk: 'scanner_devices.id' },
      { name: 'scanned_by', type: 'integer', fk: 'users.id' },
      { name: 'scan_result', type: 'text', required: true },
      { name: 'rejection_reason', type: 'text' },
      { name: 'scanned_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'attendance_logs',
    domain: 'Scanning & Attendance',
    label: 'Attendance Logs',
    description: 'Real-time IN/OUT movement ledger for live venue occupancy tracking.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'zone_id', type: 'integer', fk: 'venue_zones.id' },
      { name: 'ticket_id', type: 'integer', required: true, fk: 'tickets.id' },
      { name: 'direction', type: 'text', required: true },
      { name: 'recorded_by', type: 'integer', fk: 'users.id' },
      { name: 'recorded_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'session_checkins',
    domain: 'Scanning & Attendance',
    label: 'Session Check-ins',
    description: 'Breakout room and track-level attendance check-ins.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'session_id', type: 'integer', required: true, fk: 'event_sessions.id' },
      { name: 'ticket_id', type: 'integer', required: true, fk: 'tickets.id' },
      { name: 'checked_in_by', type: 'integer', fk: 'users.id' },
      { name: 'checked_in_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'gate_shifts',
    domain: 'Scanning & Attendance',
    label: 'Gate Shifts',
    description: 'Gate staff shift assignments per event and entry gate.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'gate_id', type: 'integer', required: true, fk: 'entry_gates.id' },
      { name: 'staff_user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'shift_start', type: 'datetime', required: true },
      { name: 'shift_end', type: 'datetime', required: true },
      { name: 'status', type: 'text', required: true },
    ],
  },
  {
    name: 'capacity_snapshots',
    domain: 'Scanning & Attendance',
    label: 'Capacity Snapshots',
    description: 'Time-series venue occupancy and throughput snapshots.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'current_occupancy', type: 'integer', required: true },
      { name: 'peak_occupancy', type: 'integer', required: true },
      { name: 'total_scans_valid', type: 'integer', required: true },
      { name: 'total_scans_rejected', type: 'integer', required: true },
      { name: 'captured_at', type: 'datetime', readonly: true },
    ],
  },

  // Domain F: Marketing, Notifications & Engagement
  {
    name: 'waitlist_entries',
    domain: 'Marketing & Engagement',
    label: 'Waitlist Entries',
    description: 'Sold-out tier waitlists with invitation conversion statuses.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'ticket_tier_id', type: 'integer', fk: 'ticket_tiers.id' },
      { name: 'email', type: 'text', required: true },
      { name: 'full_name', type: 'text', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'email_campaigns',
    domain: 'Marketing & Engagement',
    label: 'Email Campaigns',
    description: 'Attendee announcements, reminders, and open-rate metrics.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'created_by', type: 'integer', fk: 'users.id' },
      { name: 'subject', type: 'text', required: true },
      { name: 'segment', type: 'text', required: true },
      { name: 'sent_count', type: 'integer', required: true },
      { name: 'open_rate_percent', type: 'real', required: true },
      { name: 'status', type: 'text', required: true },
    ],
  },
  {
    name: 'notifications',
    domain: 'Marketing & Engagement',
    label: 'Notifications',
    description: 'In-app and email notifications for organizers and ticket holders.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', fk: 'events.id' },
      { name: 'title', type: 'text', required: true },
      { name: 'message', type: 'text', required: true },
      { name: 'channel', type: 'text', required: true },
      { name: 'is_read', type: 'boolean', required: true },
    ],
  },
  {
    name: 'event_reviews',
    domain: 'Marketing & Engagement',
    label: 'Event Reviews',
    description: 'Post-event attendee ratings and feedback.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'rating', type: 'integer', required: true },
      { name: 'comment', type: 'text', required: true },
      { name: 'is_verified_attendee', type: 'boolean', required: true },
    ],
  },
  {
    name: 'saved_events',
    domain: 'Marketing & Engagement',
    label: 'Saved Events',
    description: 'Bookmarked events saved by prospective attendees.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'user_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },

  // Domain G: Reporting, Finance & Compliance
  {
    name: 'organizer_payouts',
    domain: 'Reporting & Finance',
    label: 'Organizer Payouts',
    description: 'Scheduled and completed organizer disbursements after platform fees.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'organizer_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', required: true, fk: 'events.id' },
      { name: 'gross_cents', type: 'integer', required: true },
      { name: 'platform_fee_cents', type: 'integer', required: true },
      { name: 'net_payout_cents', type: 'integer', required: true },
      { name: 'status', type: 'text', required: true },
      { name: 'scheduled_date', type: 'datetime', required: true },
    ],
  },
  {
    name: 'saved_reports',
    domain: 'Reporting & Finance',
    label: 'Saved Reports',
    description: 'Configured reporting definitions across sales, attendance, templates, and audit.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'created_by', type: 'integer', fk: 'users.id' },
      { name: 'event_id', type: 'integer', fk: 'events.id' },
      { name: 'report_type', type: 'text', required: true },
      { name: 'title', type: 'text', required: true },
      { name: 'last_generated_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'report_exports',
    domain: 'Reporting & Finance',
    label: 'Report Exports',
    description: 'Download history of generated CSV and JSON reports.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'saved_report_id', type: 'integer', required: true, fk: 'saved_reports.id' },
      { name: 'exported_by', type: 'integer', fk: 'users.id' },
      { name: 'format', type: 'text', required: true },
      { name: 'row_count', type: 'integer', required: true },
      { name: 'file_name', type: 'text', required: true },
      { name: 'created_at', type: 'datetime', readonly: true },
    ],
  },
  {
    name: 'webhook_endpoints',
    domain: 'Reporting & Finance',
    label: 'Webhook Endpoints',
    description: 'Real-time event integration webhooks for ticket purchase and check-in events.',
    columns: [
      { name: 'id', type: 'integer', readonly: true },
      { name: 'organizer_id', type: 'integer', required: true, fk: 'users.id' },
      { name: 'event_id', type: 'integer', fk: 'events.id' },
      { name: 'target_url', type: 'text', required: true },
      { name: 'event_types', type: 'text', required: true },
      { name: 'is_active', type: 'boolean', required: true },
    ],
  },
];

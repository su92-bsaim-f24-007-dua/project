import crypto from 'node:crypto';
import express, { type Response } from 'express';
import QRCode from 'qrcode';
import { db, SCHEMA_TABLES } from './db.ts';
import {
  attachAuth,
  clearSessionCookie,
  createSession,
  hashPassword,
  hashToken,
  logAudit,
  requireAuth,
  requireRoles,
  setSessionCookie,
  signTicketQr,
  verifyMutationOrigin,
  verifyPassword,
  verifyTicketQr,
  type AuthenticatedRequest,
} from './auth.ts';

export const apiRouter = express.Router();

apiRouter.use(express.json({ limit: '1mb' }));
apiRouter.use(attachAuth);
apiRouter.use(verifyMutationOrigin);

// Real-time SSE subscriber registry keyed by eventId (0 = global monitor)
const sseClients = new Map<number, Set<Response>>();

function broadcastAttendanceUpdate(eventId: number, payload: Record<string, unknown>): void {
  const targets = [sseClients.get(eventId), sseClients.get(0)];
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const set of targets) {
    if (!set) continue;
    for (const res of set) {
      try {
        res.write(msg);
      } catch {
        set.delete(res);
      }
    }
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function getAdminExists(): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.slug = 'admin' AND u.password_hash NOT LIKE '!%' AND u.is_active = 1`
    )
    .get() as { cnt: number };
  return row.cnt > 0;
}

// ============================================================================
// AUTHENTICATION, SESSIONS, FIRST-RUN ADMIN CLAIM & RBAC
// ============================================================================

apiRouter.get('/auth/admin-status', (_req, res) => {
  const hasEnvPasscode = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  const adminClaimed = getAdminExists();
  res.json({
    adminClaimed,
    hasEnvPasscode,
    canClaimFirstAdmin: !adminClaimed && !hasEnvPasscode,
  });
});

apiRouter.get('/auth/me', (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser ?? null });
});

apiRouter.post('/auth/claim-admin', (req: AuthenticatedRequest, res) => {
  const { fullName, email, password, passcode } = req.body ?? {};
  const envPasscode = process.env.ADMIN_PASSCODE?.trim();

  if (envPasscode) {
    if (typeof passcode !== 'string' || passcode.length === 0) {
      res.status(400).json({ error: 'Server ADMIN_PASSCODE is configured; please enter it to claim admin.' });
      return;
    }
    const a = Buffer.from(passcode, 'utf8');
    const b = Buffer.from(envPasscode, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(403).json({ error: 'Invalid admin bootstrap passcode.' });
      return;
    }
  } else if (getAdminExists()) {
    res.status(409).json({ error: 'An Administrator account has already been claimed. Please sign in instead.' });
    return;
  }

  if (typeof fullName !== 'string' || fullName.trim().length < 2) {
    res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    return;
  }
  if (typeof email !== 'string' || !isValidEmail(email.trim())) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Admin password must be at least 8 characters.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail) as { id: number } | undefined;
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const adminRole = db.prepare(`SELECT id FROM roles WHERE slug = 'admin'`).get() as { id: number };
  const pwHash = hashPassword(password);
  const result = db
    .prepare(
      `INSERT INTO users (full_name, email, password_hash, role_id, organization_name, is_active)
       VALUES (?, ?, ?, ?, 'Cadence Platform Admin', 1)`
    )
    .run(fullName.trim(), normalizedEmail, pwHash, adminRole.id);

  const userId = Number(result.lastInsertRowid);
  const session = createSession(userId, req.ip ?? '', String(req.headers['user-agent'] ?? ''));
  setSessionCookie(res, session.token);
  logAudit(userId, 'ADMIN_CLAIMED', 'users', userId, `First-run Admin claimed by ${normalizedEmail}`);

  const user = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.role_id, u.organization_name, u.avatar_url,
              r.slug AS role_slug, r.name AS role_name, r.level AS role_level
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(userId) as Record<string, unknown>;

  res.status(201).json({
    token: session.token,
    user: { ...user, permissions: [] },
    message: 'Administrator workspace initialized and signed in.',
  });
});

apiRouter.post('/auth/register', (req: AuthenticatedRequest, res) => {
  const { fullName, email, password, roleSlug, organizationName } = req.body ?? {};

  if (typeof fullName !== 'string' || fullName.trim().length < 2) {
    res.status(400).json({ error: 'Full name must be at least 2 characters.' });
    return;
  }
  if (typeof email !== 'string' || !isValidEmail(email.trim())) {
    res.status(400).json({ error: 'Please provide a valid email address.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    return;
  }

  // Admin cannot be self-assigned via standard public registration
  const allowedSelfRoles = ['attendee', 'organizer', 'gate_staff', 'finance'];
  const requestedRole = typeof roleSlug === 'string' && allowedSelfRoles.includes(roleSlug) ? roleSlug : 'attendee';

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail) as { id: number } | undefined;
  if (existing) {
    res.status(409).json({ error: 'An account with this email address already exists.' });
    return;
  }

  const roleRow = db.prepare('SELECT id, slug, name, level FROM roles WHERE slug = ?').get(requestedRole) as {
    id: number;
    slug: string;
    name: string;
    level: number;
  };
  const pwHash = hashPassword(password);
  const org = typeof organizationName === 'string' ? organizationName.trim().slice(0, 100) : '';

  const result = db
    .prepare(
      `INSERT INTO users (full_name, email, password_hash, role_id, organization_name, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(fullName.trim(), normalizedEmail, pwHash, roleRow.id, org);

  const userId = Number(result.lastInsertRowid);
  const session = createSession(userId, req.ip ?? '', String(req.headers['user-agent'] ?? ''));
  setSessionCookie(res, session.token);
  logAudit(userId, 'REGISTER', 'users', userId, `Registered account (${roleRow.slug}) for ${normalizedEmail}`);

  const perms = db
    .prepare(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
    .all(roleRow.id) as Array<{ code: string }>;

  res.status(201).json({
    token: session.token,
    user: {
      id: userId,
      full_name: fullName.trim(),
      email: normalizedEmail,
      role_id: roleRow.id,
      role_slug: roleRow.slug,
      role_name: roleRow.name,
      role_level: roleRow.level,
      organization_name: org,
      avatar_url: '',
      permissions: perms.map((p) => p.code),
    },
    message: `Account created as ${roleRow.name}.`,
  });
});

apiRouter.post('/auth/login', (req: AuthenticatedRequest, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || !isValidEmail(email.trim())) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }
  if (typeof password !== 'string' || password.length === 0) {
    res.status(400).json({ error: 'Password is required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.password_hash, u.role_id, u.organization_name, u.avatar_url, u.is_active,
              r.slug AS role_slug, r.name AS role_name, r.level AS role_level
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE lower(u.email) = ?`
    )
    .get(normalizedEmail) as Record<string, unknown> | undefined;

  if (!row || !verifyPassword(password, String(row.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (Number(row.is_active) !== 1) {
    res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
    return;
  }

  const userId = Number(row.id);
  const session = createSession(userId, req.ip ?? '', String(req.headers['user-agent'] ?? ''));
  setSessionCookie(res, session.token);

  const perms = db
    .prepare(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`)
    .all(Number(row.role_id)) as Array<{ code: string }>;

  res.json({
    token: session.token,
    user: {
      id: userId,
      full_name: String(row.full_name),
      email: String(row.email),
      role_id: Number(row.role_id),
      role_slug: String(row.role_slug),
      role_name: String(row.role_name),
      role_level: Number(row.role_level),
      organization_name: String(row.organization_name || ''),
      avatar_url: String(row.avatar_url || ''),
      permissions: perms.map((p) => p.code),
    },
    message: `Signed in as ${String(row.full_name)} (${String(row.role_name)}).`,
  });
});

apiRouter.post('/auth/logout', (req: AuthenticatedRequest, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(token));
    }
  }
  clearSessionCookie(res);
  res.json({ message: 'Signed out securely.' });
});

apiRouter.get('/roles', (_req, res) => {
  const roles = db
    .prepare(
      `SELECT r.id, r.name, r.slug, r.description, r.level,
              COUNT(DISTINCT u.id) AS user_count,
              COUNT(DISTINCT rp.permission_id) AS permission_count
       FROM roles r
       LEFT JOIN users u ON u.role_id = r.id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.level DESC`
    )
    .all();
  res.json({ roles });
});

apiRouter.get('/auth/users', requireAuth, requireRoles('admin', 'organizer'), (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.role_id, u.organization_name, u.phone, u.is_active, u.created_at,
              r.name AS role_name, r.slug AS role_slug
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id DESC`
    )
    .all();
  res.json({ users });
});

apiRouter.put('/auth/users/:id/role', requireAuth, requireRoles('admin'), (req: AuthenticatedRequest, res) => {
  const targetUserId = Number(req.params.id);
  const { roleSlug, isActive } = req.body ?? {};
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    res.status(400).json({ error: 'Invalid user ID.' });
    return;
  }
  const roleRow = db.prepare('SELECT id, slug, name FROM roles WHERE slug = ?').get(String(roleSlug || '')) as
    | { id: number; slug: string; name: string }
    | undefined;
  if (!roleRow) {
    res.status(400).json({ error: 'Invalid role slug.' });
    return;
  }

  const activeVal = isActive === false || isActive === 0 ? 0 : 1;
  db.prepare('UPDATE users SET role_id = ?, is_active = ? WHERE id = ?').run(roleRow.id, activeVal, targetUserId);
  logAudit(req.authUser!.id, 'UPDATE_ROLE', 'users', targetUserId, `Assigned role ${roleRow.slug}, active=${activeVal}`);
  res.json({ message: `Updated user role to ${roleRow.name}.` });
});

// ============================================================================
// 40 CUSTOM EVENT TEMPLATES + CATEGORIES + VENUES
// ============================================================================

apiRouter.get('/categories', (_req, res) => {
  const categories = db.prepare('SELECT * FROM event_categories ORDER BY id').all();
  res.json({ categories });
});

apiRouter.get('/venues', (_req, res) => {
  const venues = db
    .prepare(
      `SELECT v.*,
              (SELECT COUNT(*) FROM venue_zones vz WHERE vz.venue_id = v.id) AS zone_count,
              (SELECT COUNT(*) FROM entry_gates eg WHERE eg.venue_id = v.id) AS gate_count
       FROM venues v ORDER BY v.id`
    )
    .all();
  res.json({ venues });
});

apiRouter.get('/templates', (req, res) => {
  const category = String(req.query.category || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT t.*, c.name AS category_name, c.slug AS category_slug,
              (SELECT COUNT(*) FROM events e WHERE e.template_id = t.id) AS events_created
       FROM event_templates t
       JOIN event_categories c ON c.id = t.category_id
       ORDER BY t.code ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const filtered = rows.filter((r) => {
    if (category && category !== 'all' && String(r.category_slug) !== category) return false;
    if (search) {
      const hay = `${r.code} ${r.name} ${r.description} ${r.layout_style} ${r.category_name}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  res.json({ templates: filtered, total: rows.length });
});

apiRouter.post('/templates', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const {
    name,
    categoryId,
    description,
    defaultDurationHours,
    defaultCapacity,
    suggestedTicketPriceCents,
    layoutStyle,
    colorAccent,
    checklist,
    defaultTiers,
  } = req.body ?? {};

  if (typeof name !== 'string' || name.trim().length < 3) {
    res.status(400).json({ error: 'Template name must be at least 3 characters.' });
    return;
  }
  if (typeof description !== 'string' || description.trim().length < 10) {
    res.status(400).json({ error: 'Template description must be at least 10 characters.' });
    return;
  }
  const catId = Number(categoryId);
  const catExists = db.prepare('SELECT id FROM event_categories WHERE id = ?').get(catId);
  if (!catExists) {
    res.status(400).json({ error: 'Valid event category is required.' });
    return;
  }

  const duration = Math.max(1, Math.min(168, Number(defaultDurationHours) || 6));
  const capacity = Math.max(10, Math.min(50000, Number(defaultCapacity) || 250));
  const price = Math.max(0, Number(suggestedTicketPriceCents) || 0);

  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM event_templates').get() as { cnt: number };
  const code = `TPL-${String(countRow.cnt + 1).padStart(3, '0')}`;

  const checklistArr = Array.isArray(checklist) && checklist.length > 0
    ? checklist.map((c) => String(c).trim()).filter(Boolean)
    : ['Confirm venue load-in schedule', 'Test QR entry gate scanners', 'Publish attendee schedule'];

  const tiersArr = Array.isArray(defaultTiers) && defaultTiers.length > 0
    ? defaultTiers
    : [{ name: 'General Admission', description: 'Standard event pass', priceCents: price, sharePct: 1.0 }];

  const result = db
    .prepare(
      `INSERT INTO event_templates
       (code, name, category_id, description, default_duration_hours, default_capacity, suggested_ticket_price_cents, layout_style, color_accent, checklist_json, default_tiers_json, default_schedule_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1)`
    )
    .run(
      code,
      name.trim(),
      catId,
      description.trim(),
      duration,
      capacity,
      price,
      typeof layoutStyle === 'string' && layoutStyle.trim() ? layoutStyle.trim() : 'Custom Layout',
      typeof colorAccent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(colorAccent) ? colorAccent : '#2563EB',
      JSON.stringify(checklistArr),
      JSON.stringify(tiersArr)
    );

  const id = Number(result.lastInsertRowid);
  logAudit(req.authUser!.id, 'CREATE', 'event_templates', id, `Created custom template ${code}: ${name.trim()}`);
  res.status(201).json({ id, code, message: `Template ${code} created.` });
});

// ============================================================================
// EVENTS CRUD & TEMPLATE INSTANTIATION
// ============================================================================

apiRouter.get('/events', (req, res) => {
  const category = String(req.query.category || '').trim();
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim().toLowerCase();

  const rows = db
    .prepare(
      `SELECT e.*,
              c.name AS category_name, c.slug AS category_slug,
              v.name AS venue_name, v.city AS venue_city,
              u.full_name AS organizer_name, u.organization_name,
              t.code AS template_code, t.name AS template_name,
              COALESCE((SELECT MIN(tt.price_cents) FROM ticket_tiers tt WHERE tt.event_id = e.id AND tt.is_active = 1), 0) AS min_price_cents,
              COALESCE((SELECT SUM(tt.quantity_sold) FROM ticket_tiers tt WHERE tt.event_id = e.id), 0) AS tickets_sold,
              COALESCE((SELECT SUM(tt.quantity_total) FROM ticket_tiers tt WHERE tt.event_id = e.id), e.capacity) AS total_allocation,
              COALESCE((SELECT COUNT(*) FROM tickets tk WHERE tk.event_id = e.id AND tk.status = 'checked_in'), 0) AS checked_in_count
       FROM events e
       JOIN event_categories c ON c.id = e.category_id
       JOIN venues v ON v.id = e.venue_id
       JOIN users u ON u.id = e.organizer_id
       LEFT JOIN event_templates t ON t.id = e.template_id
       ORDER BY e.is_featured DESC, e.start_at ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const filtered = rows.filter((ev) => {
    if (category && category !== 'all' && String(ev.category_slug) !== category) return false;
    if (status && status !== 'all' && String(ev.status) !== status) return false;
    if (search) {
      const hay = `${ev.title} ${ev.summary} ${ev.venue_name} ${ev.venue_city} ${ev.category_name}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  res.json({ events: filtered });
});

apiRouter.get('/events/:id', (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    res.status(400).json({ error: 'Invalid event ID.' });
    return;
  }

  const event = db
    .prepare(
      `SELECT e.*,
              c.name AS category_name, c.slug AS category_slug,
              v.name AS venue_name, v.address AS venue_address, v.city AS venue_city, v.country AS venue_country, v.total_capacity AS venue_capacity,
              u.full_name AS organizer_name, u.organization_name, u.avatar_url AS organizer_avatar,
              t.code AS template_code, t.name AS template_name, t.layout_style
       FROM events e
       JOIN event_categories c ON c.id = e.category_id
       JOIN venues v ON v.id = e.venue_id
       JOIN users u ON u.id = e.organizer_id
       LEFT JOIN event_templates t ON t.id = e.template_id
       WHERE e.id = ?`
    )
    .get(eventId) as Record<string, unknown> | undefined;

  if (!event) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const tiers = db
    .prepare(
      `SELECT tt.*, vz.name AS zone_name
       FROM ticket_tiers tt
       LEFT JOIN venue_zones vz ON vz.id = tt.zone_id
       WHERE tt.event_id = ?
       ORDER BY tt.price_cents ASC`
    )
    .all(eventId);

  const sessions = db
    .prepare(
      `SELECT es.*, vz.name AS zone_name,
              GROUP_CONCAT(sp.full_name || ' (' || sp.company || ')', ', ') AS speakers_label
       FROM event_sessions es
       LEFT JOIN venue_zones vz ON vz.id = es.zone_id
       LEFT JOIN session_speakers ss ON ss.session_id = es.id
       LEFT JOIN speakers sp ON sp.id = ss.speaker_id
       WHERE es.event_id = ?
       GROUP BY es.id
       ORDER BY es.start_at ASC`
    )
    .all(eventId);

  const sponsors = db
    .prepare(
      `SELECT es.*, s.name, s.website, s.logo_text
       FROM event_sponsors es
       JOIN sponsors s ON s.id = es.sponsor_id
       WHERE es.event_id = ?`
    )
    .all(eventId);

  const tasks = db
    .prepare(
      `SELECT et.*, u.full_name AS assignee_name
       FROM event_tasks et
       LEFT JOIN users u ON u.id = et.assigned_to
       WHERE et.event_id = ?
       ORDER BY et.due_date ASC`
    )
    .all(eventId);

  const reviews = db
    .prepare(
      `SELECT er.*, u.full_name AS reviewer_name
       FROM event_reviews er
       JOIN users u ON u.id = er.user_id
       WHERE er.event_id = ?
       ORDER BY er.created_at DESC`
    )
    .all(eventId);

  const gates = db
    .prepare(`SELECT * FROM entry_gates WHERE venue_id = ? ORDER BY id`)
    .all(Number(event.venue_id));

  const promoCodes = db
    .prepare(
      `SELECT code, discount_type, discount_value, valid_until
       FROM promo_codes
       WHERE (event_id = ? OR event_id IS NULL) AND is_active = 1`
    )
    .all(eventId);

  res.json({ event, tiers, sessions, sponsors, tasks, reviews, gates, promoCodes });
});

apiRouter.post('/events', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const {
    title,
    summary,
    description,
    templateId,
    categoryId,
    venueId,
    startAt,
    endAt,
    capacity,
    status,
    bannerUrl,
    isFeatured,
  } = req.body ?? {};

  if (typeof title !== 'string' || title.trim().length < 4) {
    res.status(400).json({ error: 'Event title must be at least 4 characters.' });
    return;
  }
  if (typeof summary !== 'string' || summary.trim().length < 10) {
    res.status(400).json({ error: 'Event summary must be at least 10 characters.' });
    return;
  }
  const startDate = new Date(String(startAt || ''));
  const endDate = new Date(String(endAt || ''));
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    res.status(400).json({ error: 'Valid start and end timestamps are required, with end time after start time.' });
    return;
  }

  const venue = db.prepare('SELECT id, total_capacity FROM venues WHERE id = ?').get(Number(venueId)) as
    | { id: number; total_capacity: number }
    | undefined;
  if (!venue) {
    res.status(400).json({ error: 'Valid venue selection is required.' });
    return;
  }

  let tpl: Record<string, unknown> | undefined;
  if (templateId) {
    tpl = db.prepare('SELECT * FROM event_templates WHERE id = ?').get(Number(templateId)) as Record<string, unknown> | undefined;
    if (!tpl) {
      res.status(400).json({ error: 'Selected event template does not exist.' });
      return;
    }
  }

  const resolvedCatId = Number(categoryId || tpl?.category_id || 1);
  const cat = db.prepare('SELECT id FROM event_categories WHERE id = ?').get(resolvedCatId);
  if (!cat) {
    res.status(400).json({ error: 'Valid event category is required.' });
    return;
  }

  const resolvedCapacity = Math.max(10, Math.min(50000, Number(capacity || tpl?.default_capacity || 250)));
  const validStatuses = ['draft', 'published', 'live'];
  const resolvedStatus = typeof status === 'string' && validStatuses.includes(status) ? status : 'published';

  const safeBanner =
    typeof bannerUrl === 'string' && bannerUrl.startsWith('/src/assets/images/')
      ? bannerUrl
      : '/src/assets/images/hero_summit_stage_1795541473829.jpg';

  const baseSlug = slugify(title) || 'event';
  const uniqueSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;

  db.exec('BEGIN TRANSACTION;');
  try {
    const insertEv = db.prepare(
      `INSERT INTO events (organizer_id, template_id, category_id, venue_id, title, slug, summary, description, banner_url, start_at, end_at, status, capacity, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const evRes = insertEv.run(
      req.authUser!.id,
      tpl ? Number(tpl.id) : null,
      resolvedCatId,
      venue.id,
      title.trim(),
      uniqueSlug,
      summary.trim(),
      typeof description === 'string' && description.trim() ? description.trim() : summary.trim(),
      safeBanner,
      startDate.toISOString(),
      endDate.toISOString(),
      resolvedStatus,
      resolvedCapacity,
      isFeatured ? 1 : 0
    );
    const eventId = Number(evRes.lastInsertRowid);

    // Get default zone for venue
    const zone = db.prepare('SELECT id FROM venue_zones WHERE venue_id = ? ORDER BY id LIMIT 1').get(venue.id) as
      | { id: number }
      | undefined;

    // Seed Ticket Tiers from Template (or default tier)
    const defaultTiers = tpl
      ? (JSON.parse(String(tpl.default_tiers_json || '[]')) as Array<{
          name: string;
          description: string;
          priceCents: number;
          sharePct: number;
        }>)
      : [{ name: 'General Admission', description: 'Standard event ticket', priceCents: 4900, sharePct: 1.0 }];

    const insertTier = db.prepare(
      `INSERT INTO ticket_tiers (event_id, zone_id, name, description, price_cents, quantity_total, quantity_sold, max_per_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 0, 8, 1)`
    );
    for (const tier of defaultTiers) {
      const qty = Math.max(10, Math.round(resolvedCapacity * (tier.sharePct || 0.5)));
      insertTier.run(eventId, zone?.id ?? null, tier.name, tier.description || '', Math.max(0, tier.priceCents || 0), qty);
    }

    // Seed Schedule Sessions from Template
    if (tpl) {
      const schedule = JSON.parse(String(tpl.default_schedule_json || '[]')) as Array<{
        title: string;
        trackName: string;
        offsetHours: number;
        durationHours: number;
      }>;
      const insertSess = db.prepare(
        `INSERT INTO event_sessions (event_id, zone_id, title, track_name, start_at, end_at, capacity, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of schedule) {
        const sStart = new Date(startDate.getTime() + (s.offsetHours || 0) * 3600000);
        const sEnd = new Date(sStart.getTime() + (s.durationHours || 1) * 3600000);
        insertSess.run(eventId, zone?.id ?? null, s.title, s.trackName || 'Main Stage', sStart.toISOString(), sEnd.toISOString(), resolvedCapacity, 'Auto-generated from event template.');
      }

      // Seed Tasks from Template Checklist
      const checklist = JSON.parse(String(tpl.checklist_json || '[]')) as string[];
      const insertTask = db.prepare(
        `INSERT INTO event_tasks (event_id, assigned_to, title, priority, status, due_date) VALUES (?, ?, ?, 'high', 'pending', ?)`
      );
      for (const item of checklist) {
        insertTask.run(eventId, req.authUser!.id, item, startDate.toISOString());
      }
    }

    db.prepare(
      `INSERT INTO capacity_snapshots (event_id, current_occupancy, peak_occupancy, total_scans_valid, total_scans_rejected)
       VALUES (?, 0, 0, 0, 0)`
    ).run(eventId);

    logAudit(
      req.authUser!.id,
      'CREATE_EVENT',
      'events',
      eventId,
      tpl ? `Created event "${title.trim()}" from template ${tpl.code}` : `Created custom event "${title.trim()}"`
    );

    db.exec('COMMIT;');
    res.status(201).json({
      id: eventId,
      slug: uniqueSlug,
      message: tpl
        ? `Event created from template ${tpl.code} with tiers, schedule, and operational checklist.`
        : 'Event created successfully.',
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
});

apiRouter.put('/events/:id', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const { title, summary, status, capacity } = req.body ?? {};
  const nextTitle = typeof title === 'string' && title.trim().length >= 3 ? title.trim() : String(existing.title);
  const nextSummary = typeof summary === 'string' && summary.trim().length >= 5 ? summary.trim() : String(existing.summary);
  const validStatuses = ['draft', 'published', 'live', 'completed', 'cancelled'];
  const nextStatus = typeof status === 'string' && validStatuses.includes(status) ? status : String(existing.status);
  const nextCap = Number(capacity) > 0 ? Number(capacity) : Number(existing.capacity);

  db.prepare(`UPDATE events SET title = ?, summary = ?, status = ?, capacity = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(nextTitle, nextSummary, nextStatus, nextCap, eventId);

  logAudit(req.authUser!.id, 'UPDATE', 'events', eventId, `Updated event "${nextTitle}" (status=${nextStatus})`);
  res.json({ message: 'Event updated.' });
});

apiRouter.delete('/events/:id', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const eventId = Number(req.params.id);
  const orderCount = db.prepare('SELECT COUNT(*) AS cnt FROM orders WHERE event_id = ?').get(eventId) as { cnt: number };
  if (orderCount.cnt > 0) {
    db.prepare(`UPDATE events SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(eventId);
    logAudit(req.authUser!.id, 'CANCEL', 'events', eventId, 'Cancelled event with existing ticket orders');
    res.json({ message: 'Event has existing orders and was marked as cancelled to preserve financial records.' });
    return;
  }
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  logAudit(req.authUser!.id, 'DELETE', 'events', eventId, 'Deleted draft event');
  res.json({ message: 'Event deleted.' });
});

// Task status toggle for organizers
apiRouter.put('/tasks/:id', requireAuth, requireRoles('admin', 'organizer', 'gate_staff'), (req: AuthenticatedRequest, res) => {
  const taskId = Number(req.params.id);
  const { status } = req.body ?? {};
  if (!['pending', 'in_progress', 'completed'].includes(String(status))) {
    res.status(400).json({ error: 'Invalid task status.' });
    return;
  }
  db.prepare('UPDATE event_tasks SET status = ? WHERE id = ?').run(String(status), taskId);
  res.json({ message: 'Task updated.' });
});

// ============================================================================
// TICKETING CHECKOUT, MY PASSES, QR GENERATION & REFUNDS
// ============================================================================

apiRouter.post('/orders/checkout', requireAuth, (req: AuthenticatedRequest, res) => {
  const { eventId, items, promoCode, holderName, holderEmail, paymentMethod } = req.body ?? {};
  const evId = Number(eventId);
  const ev = db.prepare('SELECT id, title, status FROM events WHERE id = ?').get(evId) as
    | { id: number; title: string; status: string }
    | undefined;
  if (!ev || ev.status === 'cancelled') {
    res.status(400).json({ error: 'Event is not available for ticket purchases.' });
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Select at least one ticket tier quantity.' });
    return;
  }

  const resolvedName = typeof holderName === 'string' && holderName.trim().length >= 2 ? holderName.trim() : req.authUser!.full_name;
  const resolvedEmail = typeof holderEmail === 'string' && isValidEmail(holderEmail.trim()) ? holderEmail.trim().toLowerCase() : req.authUser!.email;

  db.exec('BEGIN TRANSACTION;');
  try {
    let subtotalCents = 0;
    const validatedItems: Array<{ tierId: number; tierName: string; qty: number; unitPrice: number }> = [];

    for (const item of items) {
      const tierId = Number(item.tierId);
      const qty = Number(item.quantity);
      if (!Number.isInteger(tierId) || !Number.isInteger(qty) || qty <= 0) {
        db.exec('ROLLBACK;');
        res.status(400).json({ error: 'Invalid ticket tier or quantity.' });
        return;
      }
      const tier = db
        .prepare('SELECT * FROM ticket_tiers WHERE id = ? AND event_id = ? AND is_active = 1')
        .get(tierId, evId) as Record<string, unknown> | undefined;
      if (!tier) {
        db.exec('ROLLBACK;');
        res.status(400).json({ error: 'One of the selected ticket tiers is unavailable.' });
        return;
      }
      const remaining = Number(tier.quantity_total) - Number(tier.quantity_sold);
      if (qty > remaining) {
        db.exec('ROLLBACK;');
        res.status(409).json({ error: `Only ${remaining} tickets left for ${String(tier.name)}.` });
        return;
      }
      if (qty > Number(tier.max_per_order)) {
        db.exec('ROLLBACK;');
        res.status(400).json({ error: `Maximum ${Number(tier.max_per_order)} tickets allowed per order for ${String(tier.name)}.` });
        return;
      }

      const unitPrice = Number(tier.price_cents);
      subtotalCents += unitPrice * qty;
      validatedItems.push({ tierId, tierName: String(tier.name), qty, unitPrice });
    }

    let promoId: number | null = null;
    let discountCents = 0;
    if (typeof promoCode === 'string' && promoCode.trim().length > 0) {
      const promo = db
        .prepare(
          `SELECT * FROM promo_codes
           WHERE upper(code) = ? AND is_active = 1 AND (event_id = ? OR event_id IS NULL)`
        )
        .get(promoCode.trim().toUpperCase(), evId) as Record<string, unknown> | undefined;

      if (!promo) {
        db.exec('ROLLBACK;');
        res.status(400).json({ error: `Promo code "${promoCode.trim()}" is not valid for this event.` });
        return;
      }
      if (Number(promo.current_uses) >= Number(promo.max_uses)) {
        db.exec('ROLLBACK;');
        res.status(400).json({ error: 'Promo code usage limit reached.' });
        return;
      }
      promoId = Number(promo.id);
      if (promo.discount_type === 'percent') {
        discountCents = Math.round((subtotalCents * Number(promo.discount_value)) / 100);
      } else {
        discountCents = Math.min(subtotalCents, Number(promo.discount_value));
      }
      db.prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?').run(promoId);
    }

    const taxRate = db.prepare(`SELECT id, rate_percent FROM tax_rates ORDER BY id LIMIT 1`).get() as
      | { id: number; rate_percent: number }
      | undefined;
    const taxable = Math.max(0, subtotalCents - discountCents);
    const taxCents = taxRate ? Math.round((taxable * taxRate.rate_percent) / 100) : 0;
    const totalCents = taxable + taxCents;

    const orderNumber = `ORD-${new Date().getFullYear()}-${crypto.randomInt(10000, 99999)}`;
    const orderRes = db
      .prepare(
        `INSERT INTO orders (user_id, event_id, promo_code_id, tax_rate_id, order_number, subtotal_cents, discount_cents, tax_cents, total_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid')`
      )
      .run(req.authUser!.id, evId, promoId, taxRate?.id ?? null, orderNumber, subtotalCents, discountCents, taxCents, totalCents);

    const orderId = Number(orderRes.lastInsertRowid);
    const txnRef = `TXN-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare(
      `INSERT INTO payments (order_id, payment_method, transaction_ref, amount_cents, currency, status)
       VALUES (?, ?, ?, ?, 'USD', 'succeeded')`
    ).run(orderId, typeof paymentMethod === 'string' ? paymentMethod : 'card', txnRef, totalCents);

    const issuedTickets: Array<{ ticketCode: string; tierName: string; qrSignature: string }> = [];
    const insertOrderItem = db.prepare(
      `INSERT INTO order_items (order_id, ticket_tier_id, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?)`
    );
    const insertTicket = db.prepare(
      `INSERT INTO tickets (order_item_id, event_id, ticket_tier_id, attendee_id, ticket_code, qr_signature, holder_name, holder_email, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'valid')`
    );
    const updateTierSold = db.prepare(`UPDATE ticket_tiers SET quantity_sold = quantity_sold + ? WHERE id = ?`);

    for (const item of validatedItems) {
      const oiRes = insertOrderItem.run(orderId, item.tierId, item.qty, item.unitPrice, item.unitPrice * item.qty);
      const orderItemId = Number(oiRes.lastInsertRowid);
      updateTierSold.run(item.qty, item.tierId);

      for (let i = 0; i < item.qty; i++) {
        const ticketCode = `CAD-${evId}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const qrSignature = signTicketQr(ticketCode, evId);
        insertTicket.run(orderItemId, evId, item.tierId, req.authUser!.id, ticketCode, qrSignature, resolvedName, resolvedEmail);
        issuedTickets.push({ ticketCode, tierName: item.tierName, qrSignature });
      }
    }

    db.prepare(
      `INSERT INTO notifications (user_id, event_id, title, message, channel, is_read)
       VALUES (?, ?, ?, ?, 'in_app', 0)`
    ).run(req.authUser!.id, evId, `Tickets Issued (${orderNumber})`, `${issuedTickets.length} QR pass(es) generated for ${ev.title}.`);

    logAudit(req.authUser!.id, 'ORDER_COMPLETED', 'orders', orderId, `Purchased ${issuedTickets.length} ticket(s) for ${ev.title} (${orderNumber})`);

    db.exec('COMMIT;');
    res.status(201).json({
      orderId,
      orderNumber,
      totalCents,
      tickets: issuedTickets,
      message: `Order ${orderNumber} confirmed with ${issuedTickets.length} verifiable QR ticket(s).`,
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
});

apiRouter.get('/my-tickets', requireAuth, (req: AuthenticatedRequest, res) => {
  const tickets = db
    .prepare(
      `SELECT tk.*, e.title AS event_title, e.start_at, e.end_at, e.banner_url,
              v.name AS venue_name, v.city AS venue_city,
              tt.name AS tier_name, tt.price_cents,
              o.order_number
       FROM tickets tk
       JOIN events e ON e.id = tk.event_id
       JOIN venues v ON v.id = e.venue_id
       JOIN ticket_tiers tt ON tt.id = tk.ticket_tier_id
       JOIN order_items oi ON oi.id = tk.order_item_id
       JOIN orders o ON o.id = oi.order_id
       WHERE tk.attendee_id = ?
       ORDER BY tk.created_at DESC`
    )
    .all(req.authUser!.id);

  res.json({ tickets });
});

apiRouter.get('/tickets/:code/qr', async (req, res) => {
  const code = String(req.params.code || '').trim();
  const ticket = db
    .prepare('SELECT id, event_id, ticket_code, qr_signature, holder_name FROM tickets WHERE ticket_code = ?')
    .get(code) as { id: number; event_id: number; ticket_code: string; qr_signature: string; holder_name: string } | undefined;

  if (!ticket) {
    res.status(404).json({ error: 'Ticket code not found.' });
    return;
  }

  const qrPayload = JSON.stringify({
    code: ticket.ticket_code,
    eventId: ticket.event_id,
    sig: ticket.qr_signature,
  });

  const svg = await QRCode.toString(qrPayload, {
    type: 'svg',
    margin: 1,
    width: 200,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  res.json({ qrPayload, svg });
});

apiRouter.post('/orders/:id/refund', requireAuth, requireRoles('admin', 'finance', 'organizer'), (req: AuthenticatedRequest, res) => {
  const orderId = Number(req.params.id);
  const { reason } = req.body ?? {};
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
  if (!order) {
    res.status(404).json({ error: 'Order not found.' });
    return;
  }
  if (order.status === 'refunded') {
    res.status(409).json({ error: 'Order has already been refunded.' });
    return;
  }

  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(orderId) as Record<string, unknown> | undefined;
  if (!payment) {
    res.status(400).json({ error: 'No payment record found for this order.' });
    return;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?`).run(orderId);
    db.prepare(`UPDATE payments SET status = 'refunded' WHERE id = ?`).run(Number(payment.id));
    db.prepare(
      `UPDATE tickets SET status = 'refunded'
       WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = ?)`
    ).run(orderId);

    db.prepare(
      `INSERT INTO refunds (payment_id, processed_by, amount_cents, reason, status)
       VALUES (?, ?, ?, ?, 'completed')`
    ).run(
      Number(payment.id),
      req.authUser!.id,
      Number(payment.amount_cents),
      typeof reason === 'string' && reason.trim() ? reason.trim() : 'Organizer/Finance approved refund'
    );

    logAudit(req.authUser!.id, 'REFUND_ORDER', 'orders', orderId, `Refunded order ${String(order.order_number)}`);
    db.exec('COMMIT;');
    res.json({ message: `Order ${String(order.order_number)} refunded and associated QR tickets revoked.` });
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
});

// ============================================================================
// TICKET SCANNING & REAL-TIME ATTENDANCE TRACKING
// ============================================================================

apiRouter.get('/scanner/context', requireAuth, requireRoles('admin', 'organizer', 'gate_staff'), (_req, res) => {
  const events = db
    .prepare(
      `SELECT e.id, e.title, e.venue_id, e.capacity, e.status, v.name AS venue_name
       FROM events e JOIN venues v ON v.id = e.venue_id
       WHERE e.status IN ('published', 'live')
       ORDER BY e.is_featured DESC, e.start_at ASC`
    )
    .all();

  const gates = db
    .prepare(
      `SELECT g.*, v.name AS venue_name
       FROM entry_gates g JOIN venues v ON v.id = g.venue_id
       ORDER BY g.id`
    )
    .all();

  const devices = db.prepare('SELECT * FROM scanner_devices ORDER BY id').all();

  const recentScans = db
    .prepare(
      `SELECT ts.*, tk.ticket_code, tk.holder_name, tt.name AS tier_name,
              g.gate_name, e.title AS event_title, u.full_name AS scanned_by_name
       FROM ticket_scans ts
       LEFT JOIN tickets tk ON tk.id = ts.ticket_id
       LEFT JOIN ticket_tiers tt ON tt.id = tk.ticket_tier_id
       JOIN entry_gates g ON g.id = ts.gate_id
       JOIN events e ON e.id = ts.event_id
       LEFT JOIN users u ON u.id = ts.scanned_by
       ORDER BY ts.id DESC
       LIMIT 25`
    )
    .all();

  // Provide real verifiable sample ticket payloads from DB so gate staff can test valid, duplicate, and cancelled scans immediately
  const sampleTickets = db
    .prepare(
      `SELECT tk.ticket_code, tk.event_id, tk.qr_signature, tk.holder_name, tk.status, tt.name AS tier_name, e.title AS event_title
       FROM tickets tk
       JOIN ticket_tiers tt ON tt.id = tk.ticket_tier_id
       JOIN events e ON e.id = tk.event_id
       ORDER BY tk.id ASC
       LIMIT 12`
    )
    .all();

  res.json({ events, gates, devices, recentScans, sampleTickets });
});

apiRouter.post('/scanner/verify', requireAuth, requireRoles('admin', 'organizer', 'gate_staff'), (req: AuthenticatedRequest, res) => {
  const { rawInput, eventId, gateId, scannerDeviceId, zoneId } = req.body ?? {};
  const targetEventId = Number(eventId);
  const targetGateId = Number(gateId);

  if (!Number.isInteger(targetEventId) || targetEventId <= 0 || !Number.isInteger(targetGateId) || targetGateId <= 0) {
    res.status(400).json({ error: 'Select an active event and entry gate before scanning.' });
    return;
  }
  if (typeof rawInput !== 'string' || rawInput.trim().length === 0) {
    res.status(400).json({ error: 'Enter or scan a QR payload or ticket code.' });
    return;
  }

  let ticketCode = rawInput.trim();
  let suppliedSignature = '';
  let payloadEventId: number | null = null;

  if (ticketCode.startsWith('{')) {
    try {
      const parsed = JSON.parse(ticketCode) as { code?: string; sig?: string; eventId?: number };
      ticketCode = String(parsed.code || '').trim();
      suppliedSignature = String(parsed.sig || '').trim();
      payloadEventId = parsed.eventId ? Number(parsed.eventId) : null;
    } catch {
      res.status(400).json({ error: 'Malformed QR JSON payload.' });
      return;
    }
  }

  const ticket = db
    .prepare(
      `SELECT tk.*, tt.name AS tier_name, tt.zone_id AS tier_zone_id, e.title AS event_title, e.capacity AS event_capacity
       FROM tickets tk
       JOIN ticket_tiers tt ON tt.id = tk.ticket_tier_id
       JOIN events e ON e.id = tk.event_id
       WHERE upper(tk.ticket_code) = ?`
    )
    .get(ticketCode.toUpperCase()) as Record<string, unknown> | undefined;

  let scanResult: 'VALID' | 'ALREADY_CHECKED_IN' | 'INVALID_SIGNATURE' | 'TICKET_CANCELLED' | 'WRONG_EVENT' | 'NOT_FOUND' = 'VALID';
  let rejectionReason = '';

  if (!ticket) {
    scanResult = 'NOT_FOUND';
    rejectionReason = `Ticket code "${ticketCode}" does not exist in registry.`;
  } else if (Number(ticket.event_id) !== targetEventId || (payloadEventId !== null && payloadEventId !== targetEventId)) {
    scanResult = 'WRONG_EVENT';
    rejectionReason = `Ticket belongs to "${String(ticket.event_title)}", not the selected gate event.`;
  } else if (suppliedSignature && !verifyTicketQr(String(ticket.ticket_code), Number(ticket.event_id), suppliedSignature)) {
    scanResult = 'INVALID_SIGNATURE';
    rejectionReason = 'Cryptographic HMAC-SHA256 QR signature mismatch — potential forged pass.';
  } else if (ticket.status === 'cancelled' || ticket.status === 'refunded') {
    scanResult = 'TICKET_CANCELLED';
    rejectionReason = `Ticket status is ${String(ticket.status).toUpperCase()} and is void for entry.`;
  } else if (ticket.status === 'checked_in') {
    scanResult = 'ALREADY_CHECKED_IN';
    rejectionReason = `Duplicate entry attempt. Already checked in at ${String(ticket.checked_in_at || 'earlier')}.`;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    const scanInsert = db
      .prepare(
        `INSERT INTO ticket_scans (ticket_id, event_id, gate_id, scanner_device_id, scanned_by, scan_result, rejection_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ticket ? Number(ticket.id) : null,
        targetEventId,
        targetGateId,
        scannerDeviceId ? Number(scannerDeviceId) : null,
        req.authUser!.id,
        scanResult,
        rejectionReason
      );

    if (scanResult === 'VALID' && ticket) {
      const nowIso = new Date().toISOString();
      db.prepare(`UPDATE tickets SET status = 'checked_in', checked_in_at = ? WHERE id = ?`).run(nowIso, Number(ticket.id));
      const resolvedZone = zoneId ? Number(zoneId) : ticket.tier_zone_id ? Number(ticket.tier_zone_id) : null;
      db.prepare(
        `INSERT INTO attendance_logs (event_id, zone_id, ticket_id, direction, recorded_by)
         VALUES (?, ?, ?, 'IN', ?)`
      ).run(targetEventId, resolvedZone, Number(ticket.id), req.authUser!.id);
    }

    // Recompute live occupancy from attendance_logs (IN - OUT)
    const occRow = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END), 0) AS net_occ
         FROM attendance_logs WHERE event_id = ?`
      )
      .get(targetEventId) as { net_occ: number };
    const currentOcc = Math.max(0, occRow.net_occ);

    const scanCounts = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN scan_result = 'VALID' THEN 1 ELSE 0 END), 0) AS valid_cnt,
           COALESCE(SUM(CASE WHEN scan_result != 'VALID' THEN 1 ELSE 0 END), 0) AS rejected_cnt
         FROM ticket_scans WHERE event_id = ?`
      )
      .get(targetEventId) as { valid_cnt: number; rejected_cnt: number };

    const peakRow = db
      .prepare(`SELECT COALESCE(MAX(peak_occupancy), 0) AS max_peak FROM capacity_snapshots WHERE event_id = ?`)
      .get(targetEventId) as { max_peak: number };
    const peakOcc = Math.max(peakRow.max_peak, currentOcc);

    db.prepare(
      `INSERT INTO capacity_snapshots (event_id, current_occupancy, peak_occupancy, total_scans_valid, total_scans_rejected)
       VALUES (?, ?, ?, ?, ?)`
    ).run(targetEventId, currentOcc, peakOcc, scanCounts.valid_cnt, scanCounts.rejected_cnt);

    db.exec('COMMIT;');

    const gateRow = db.prepare('SELECT gate_name FROM entry_gates WHERE id = ?').get(targetGateId) as { gate_name: string } | undefined;

    const eventPayload = {
      type: 'scan',
      scanId: Number(scanInsert.lastInsertRowid),
      eventId: targetEventId,
      scanResult,
      rejectionReason,
      ticketCode: ticket ? String(ticket.ticket_code) : ticketCode,
      holderName: ticket ? String(ticket.holder_name) : 'Unknown',
      tierName: ticket ? String(ticket.tier_name) : '-',
      gateName: gateRow?.gate_name ?? 'Gate',
      currentOccupancy: currentOcc,
      peakOccupancy: peakOcc,
      totalValid: scanCounts.valid_cnt,
      totalRejected: scanCounts.rejected_cnt,
      scannedAt: new Date().toISOString(),
    };

    broadcastAttendanceUpdate(targetEventId, eventPayload);

    res.json({
      verified: scanResult === 'VALID',
      ...eventPayload,
    });
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
});

apiRouter.post('/scanner/checkout-gate', requireAuth, requireRoles('admin', 'organizer', 'gate_staff'), (req: AuthenticatedRequest, res) => {
  const { ticketCode, eventId } = req.body ?? {};
  const targetEventId = Number(eventId);
  const ticket = db
    .prepare('SELECT id, ticket_code, holder_name FROM tickets WHERE upper(ticket_code) = ? AND event_id = ?')
    .get(String(ticketCode || '').trim().toUpperCase(), targetEventId) as
    | { id: number; ticket_code: string; holder_name: string }
    | undefined;

  if (!ticket) {
    res.status(404).json({ error: 'Ticket not found for selected event.' });
    return;
  }

  db.prepare(
    `INSERT INTO attendance_logs (event_id, ticket_id, direction, recorded_by) VALUES (?, ?, 'OUT', ?)`
  ).run(targetEventId, ticket.id, req.authUser!.id);

  const occRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END), 0) -
         COALESCE(SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END), 0) AS net_occ
       FROM attendance_logs WHERE event_id = ?`
    )
    .get(targetEventId) as { net_occ: number };
  const currentOcc = Math.max(0, occRow.net_occ);

  broadcastAttendanceUpdate(targetEventId, {
    type: 'checkout',
    eventId: targetEventId,
    ticketCode: ticket.ticket_code,
    holderName: ticket.holder_name,
    currentOccupancy: currentOcc,
    scannedAt: new Date().toISOString(),
  });

  res.json({ message: `Recorded exit scan for ${ticket.holder_name} (${ticket.ticket_code}).`, currentOccupancy: currentOcc });
});

apiRouter.get('/events/:id/attendance-live', (req, res) => {
  const eventId = Number(req.params.id);
  const ev = db.prepare('SELECT id, title, capacity, venue_id FROM events WHERE id = ?').get(eventId) as
    | { id: number; title: string; capacity: number; venue_id: number }
    | undefined;
  if (!ev) {
    res.status(404).json({ error: 'Event not found.' });
    return;
  }

  const ticketStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_issued,
         COALESCE(SUM(CASE WHEN status = 'checked_in' THEN 1 ELSE 0 END), 0) AS checked_in_total,
         COALESCE(SUM(CASE WHEN status = 'valid' THEN 1 ELSE 0 END), 0) AS pending_arrival,
         COALESCE(SUM(CASE WHEN status IN ('cancelled', 'refunded') THEN 1 ELSE 0 END), 0) AS voided_total
       FROM tickets WHERE event_id = ?`
    )
    .get(eventId) as Record<string, number>;

  const occRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END), 0) AS total_in,
         COALESCE(SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END), 0) AS total_out
       FROM attendance_logs WHERE event_id = ?`
    )
    .get(eventId) as { total_in: number; total_out: number };

  const currentOccupancy = Math.max(0, occRow.total_in - occRow.total_out);

  const gateBreakdown = db
    .prepare(
      `SELECT g.id, g.gate_name, g.gate_code, g.gate_type,
              COALESCE(SUM(CASE WHEN ts.scan_result = 'VALID' THEN 1 ELSE 0 END), 0) AS valid_scans,
              COALESCE(SUM(CASE WHEN ts.scan_result != 'VALID' THEN 1 ELSE 0 END), 0) AS rejected_scans
       FROM entry_gates g
       LEFT JOIN ticket_scans ts ON ts.gate_id = g.id AND ts.event_id = ?
       WHERE g.venue_id = ?
       GROUP BY g.id`
    )
    .all(eventId, ev.venue_id);

  const zoneBreakdown = db
    .prepare(
      `SELECT vz.id, vz.name, vz.zone_code, vz.capacity, vz.is_vip,
              COALESCE(SUM(CASE WHEN al.direction = 'IN' THEN 1 WHEN al.direction = 'OUT' THEN -1 ELSE 0 END), 0) AS occupancy
       FROM venue_zones vz
       LEFT JOIN attendance_logs al ON al.zone_id = vz.id AND al.event_id = ?
       WHERE vz.venue_id = ?
       GROUP BY vz.id`
    )
    .all(eventId, ev.venue_id);

  res.json({
    event: ev,
    currentOccupancy,
    ticketStats,
    gateBreakdown,
    zoneBreakdown,
  });
});

apiRouter.get('/events/:id/attendance-stream', (req, res) => {
  const eventId = Number(req.params.id) || 0;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(eventId)) {
    sseClients.set(eventId, new Set());
  }
  sseClients.get(eventId)!.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', eventId })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.get(eventId)?.delete(res);
  });
});

// ============================================================================
// REPORTING MODULES & EXPORTS (5 COMPREHENSIVE MODULES)
// ============================================================================

apiRouter.get('/reports/overview', requireAuth, requireRoles('admin', 'organizer', 'finance', 'gate_staff'), (_req, res) => {
  // 1. Sales & Revenue by Event
  const salesByEvent = db
    .prepare(
      `SELECT e.id, e.title, e.status, e.capacity,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.subtotal_cents ELSE 0 END), 0) AS gross_cents,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.discount_cents ELSE 0 END), 0) AS discount_cents,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.tax_cents ELSE 0 END), 0) AS tax_cents,
              COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total_cents ELSE 0 END), 0) AS net_collected_cents,
              COALESCE((SELECT SUM(tt.quantity_sold) FROM ticket_tiers tt WHERE tt.event_id = e.id), 0) AS tickets_sold,
              COUNT(DISTINCT o.id) AS order_count
       FROM events e
       LEFT JOIN orders o ON o.event_id = e.id
       GROUP BY e.id
       ORDER BY net_collected_cents DESC`
    )
    .all();

  // 2. Attendance & Gate Throughput
  const attendanceByEvent = db
    .prepare(
      `SELECT e.id, e.title, e.capacity,
              COALESCE((SELECT COUNT(*) FROM tickets tk WHERE tk.event_id = e.id AND tk.status IN ('valid', 'checked_in')), 0) AS active_tickets,
              COALESCE((SELECT COUNT(*) FROM tickets tk WHERE tk.event_id = e.id AND tk.status = 'checked_in'), 0) AS checked_in,
              COALESCE((SELECT COUNT(*) FROM ticket_scans ts WHERE ts.event_id = e.id AND ts.scan_result = 'VALID'), 0) AS valid_scans,
              COALESCE((SELECT COUNT(*) FROM ticket_scans ts WHERE ts.event_id = e.id AND ts.scan_result != 'VALID'), 0) AS rejected_scans
       FROM events e
       ORDER BY checked_in DESC`
    )
    .all();

  // 3. Template Utilization Matrix (40 templates summary + category rollups)
  const templatePerformance = db
    .prepare(
      `SELECT c.name AS category_name,
              COUNT(DISTINCT t.id) AS template_count,
              COUNT(DISTINCT e.id) AS events_launched,
              ROUND(AVG(t.default_capacity)) AS avg_capacity,
              ROUND(AVG(t.suggested_ticket_price_cents)) AS avg_price_cents
       FROM event_categories c
       LEFT JOIN event_templates t ON t.category_id = c.id
       LEFT JOIN events e ON e.template_id = t.id
       GROUP BY c.id
       ORDER BY template_count DESC`
    )
    .all();

  // 4. Financial Reconciliation: Payouts, Refunds & Orders
  const payouts = db
    .prepare(
      `SELECT op.*, e.title AS event_title, u.full_name AS organizer_name
       FROM organizer_payouts op
       JOIN events e ON e.id = op.event_id
       JOIN users u ON u.id = op.organizer_id
       ORDER BY op.scheduled_date ASC`
    )
    .all();

  const recentOrders = db
    .prepare(
      `SELECT o.*, e.title AS event_title, u.full_name AS buyer_name, u.email AS buyer_email
       FROM orders o
       JOIN events e ON e.id = o.event_id
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT 25`
    )
    .all();

  const refunds = db
    .prepare(
      `SELECT r.*, p.transaction_ref, o.order_number, u.full_name AS processed_by_name
       FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       JOIN orders o ON o.id = p.order_id
       LEFT JOIN users u ON u.id = r.processed_by
       ORDER BY r.created_at DESC`
    )
    .all();

  // 5. Security & Audit Log
  const auditLogs = db
    .prepare(
      `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.id DESC
       LIMIT 40`
    )
    .all();

  const exportHistory = db
    .prepare(
      `SELECT re.*, sr.title AS report_title, sr.report_type, u.full_name AS exported_by_name
       FROM report_exports re
       JOIN saved_reports sr ON sr.id = re.saved_report_id
       LEFT JOIN users u ON u.id = re.exported_by
       ORDER BY re.id DESC
       LIMIT 15`
    )
    .all();

  res.json({
    salesByEvent,
    attendanceByEvent,
    templatePerformance,
    payouts,
    recentOrders,
    refunds,
    auditLogs,
    exportHistory,
  });
});

apiRouter.post('/reports/export', requireAuth, requireRoles('admin', 'organizer', 'finance', 'gate_staff'), (req: AuthenticatedRequest, res) => {
  const { reportType, format } = req.body ?? {};
  const validTypes = ['sales_revenue', 'attendance_velocity', 'template_performance', 'financial_payouts', 'security_audit'];
  if (!validTypes.includes(String(reportType))) {
    res.status(400).json({ error: 'Invalid report type.' });
    return;
  }
  const fmt = format === 'json' ? 'json' : 'csv';

  let rows: Array<Record<string, unknown>> = [];
  let title = '';

  if (reportType === 'sales_revenue') {
    title = 'Ticket Sales & Revenue Report';
    rows = db
      .prepare(
        `SELECT e.id AS event_id, e.title AS event_title, e.status,
                COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total_cents ELSE 0 END), 0) / 100.0 AS net_revenue_usd,
                COALESCE((SELECT SUM(tt.quantity_sold) FROM ticket_tiers tt WHERE tt.event_id = e.id), 0) AS tickets_sold
         FROM events e LEFT JOIN orders o ON o.event_id = e.id GROUP BY e.id`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (reportType === 'attendance_velocity') {
    title = 'Attendance & Gate Verification Report';
    rows = db
      .prepare(
        `SELECT ts.id AS scan_id, e.title AS event_title, g.gate_name, tk.ticket_code, ts.scan_result, ts.rejection_reason, ts.scanned_at
         FROM ticket_scans ts
         JOIN events e ON e.id = ts.event_id
         JOIN entry_gates g ON g.id = ts.gate_id
         LEFT JOIN tickets tk ON tk.id = ts.ticket_id
         ORDER BY ts.id DESC`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (reportType === 'template_performance') {
    title = '40 Custom Event Templates Catalog Report';
    rows = db
      .prepare(
        `SELECT t.code, t.name, c.name AS category, t.default_duration_hours, t.default_capacity,
                t.suggested_ticket_price_cents / 100.0 AS suggested_price_usd, t.layout_style
         FROM event_templates t JOIN event_categories c ON c.id = t.category_id ORDER BY t.code`
      )
      .all() as Array<Record<string, unknown>>;
  } else if (reportType === 'financial_payouts') {
    title = 'Financial Payouts & Reconciliation Report';
    rows = db
      .prepare(
        `SELECT op.id, e.title AS event_title, op.gross_cents / 100.0 AS gross_usd,
                op.platform_fee_cents / 100.0 AS fee_usd, op.net_payout_cents / 100.0 AS net_payout_usd, op.status, op.scheduled_date
         FROM organizer_payouts op JOIN events e ON e.id = op.event_id`
      )
      .all() as Array<Record<string, unknown>>;
  } else {
    title = 'Security & Audit Trail Report';
    rows = db
      .prepare(
        `SELECT al.id, COALESCE(u.email, 'system') AS actor, al.action, al.entity_table, al.entity_id, al.details, al.created_at
         FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id ORDER BY al.id DESC`
      )
      .all() as Array<Record<string, unknown>>;
  }

  const fileName = `${reportType}_${new Date().toISOString().slice(0, 10)}.${fmt}`;
  const sr = db
    .prepare(`INSERT INTO saved_reports (created_by, report_type, title) VALUES (?, ?, ?)`)
    .run(req.authUser!.id, String(reportType), title);
  db.prepare(`INSERT INTO report_exports (saved_report_id, exported_by, format, row_count, file_name) VALUES (?, ?, ?, ?, ?)`)
    .run(Number(sr.lastInsertRowid), req.authUser!.id, fmt, rows.length, fileName);

  let content = '';
  if (fmt === 'json') {
    content = JSON.stringify({ title, generatedAt: new Date().toISOString(), rows }, null, 2);
  } else {
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ['message'];
    const escapeCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push(headers.map((h) => escapeCsv(r[h])).join(','));
    }
    content = lines.join('\n');
  }

  res.json({ fileName, format: fmt, rowCount: rows.length, content });
});

// ============================================================================
// 42-TABLE RELATIONAL SCHEMA & FULL CRUD EXPLORER
// ============================================================================

const TABLE_MAP = new Map(SCHEMA_TABLES.map((t) => [t.name, t]));

apiRouter.get('/schema/tables', (_req, res) => {
  const tables = SCHEMA_TABLES.map((t) => {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM "${t.name}"`).get() as { cnt: number };
    return {
      ...t,
      rowCount: row.cnt,
    };
  });
  res.json({ totalTables: tables.length, tables });
});

apiRouter.get('/schema/tables/:tableName', requireAuth, requireRoles('admin', 'organizer', 'finance'), (req, res) => {
  const meta = TABLE_MAP.get(String(req.params.tableName));
  if (!meta) {
    res.status(404).json({ error: 'Unknown schema table.' });
    return;
  }

  const limit = Math.min(100, Math.max(5, Number(req.query.limit) || 50));
  const search = String(req.query.search || '').trim().toLowerCase();

  // Never project password_hash or token_hash in API responses
  const safeCols = meta.columns.map((c) => `"${c.name}"`).join(', ');
  const rows = db.prepare(`SELECT ${safeCols} FROM "${meta.name}" ORDER BY id DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;

  const filtered = search
    ? rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(search)))
    : rows;

  res.json({ table: meta, rows: filtered });
});

apiRouter.post('/schema/tables/:tableName', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const meta = TABLE_MAP.get(String(req.params.tableName));
  if (!meta) {
    res.status(404).json({ error: 'Unknown schema table.' });
    return;
  }
  if (['user_sessions', 'audit_logs'].includes(meta.name)) {
    res.status(403).json({ error: `Direct inserts into ${meta.name} are restricted for security integrity.` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const editableCols = meta.columns.filter((c) => !c.readonly);

  const insertCols: string[] = [];
  const placeholders: string[] = [];
  const values: Array<string | number | null> = [];

  for (const col of editableCols) {
    const rawVal = body[col.name];
    if (col.required && (rawVal === undefined || rawVal === null || String(rawVal).trim() === '')) {
      res.status(400).json({ error: `Field "${col.name}" is required for ${meta.label}.` });
      return;
    }
    if (rawVal === undefined || rawVal === '') continue;

    insertCols.push(`"${col.name}"`);
    placeholders.push('?');
    if (col.type === 'integer' || col.type === 'boolean') {
      values.push(Number(rawVal));
    } else if (col.type === 'real') {
      values.push(Number(rawVal));
    } else {
      values.push(String(rawVal));
    }
  }

  if (insertCols.length === 0) {
    res.status(400).json({ error: 'No valid fields provided.' });
    return;
  }

  try {
    const sql = `INSERT INTO "${meta.name}" (${insertCols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const result = db.prepare(sql).run(...values);
    const id = Number(result.lastInsertRowid);
    logAudit(req.authUser!.id, 'SCHEMA_CREATE', meta.name, id, `Created row #${id} in ${meta.name}`);
    res.status(201).json({ id, message: `Created record #${id} in ${meta.label}.` });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Database constraint error.' });
  }
});

apiRouter.put('/schema/tables/:tableName/:id', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const meta = TABLE_MAP.get(String(req.params.tableName));
  if (!meta) {
    res.status(404).json({ error: 'Unknown schema table.' });
    return;
  }
  const rowId = Number(req.params.id);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    res.status(400).json({ error: 'Invalid record ID.' });
    return;
  }
  if (['user_sessions', 'audit_logs', 'users'].includes(meta.name) && req.authUser!.role_slug !== 'admin') {
    res.status(403).json({ error: `Only Platform Administrators may directly modify ${meta.name}.` });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const editableCols = meta.columns.filter((c) => !c.readonly);
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  for (const col of editableCols) {
    if (!(col.name in body)) continue;
    const rawVal = body[col.name];
    sets.push(`"${col.name}" = ?`);
    if (rawVal === null || rawVal === '') {
      values.push(null);
    } else if (col.type === 'integer' || col.type === 'boolean' || col.type === 'real') {
      values.push(Number(rawVal));
    } else {
      values.push(String(rawVal));
    }
  }

  if (sets.length === 0) {
    res.status(400).json({ error: 'No updatable fields provided.' });
    return;
  }

  values.push(rowId);
  try {
    const sql = `UPDATE "${meta.name}" SET ${sets.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...values);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    logAudit(req.authUser!.id, 'SCHEMA_UPDATE', meta.name, rowId, `Updated row #${rowId} in ${meta.name}`);
    res.json({ message: `Updated record #${rowId} in ${meta.label}.` });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Database constraint error.' });
  }
});

apiRouter.delete('/schema/tables/:tableName/:id', requireAuth, requireRoles('admin', 'organizer'), (req: AuthenticatedRequest, res) => {
  const meta = TABLE_MAP.get(String(req.params.tableName));
  if (!meta) {
    res.status(404).json({ error: 'Unknown schema table.' });
    return;
  }
  const rowId = Number(req.params.id);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    res.status(400).json({ error: 'Invalid record ID.' });
    return;
  }
  if (['roles', 'permissions', 'audit_logs'].includes(meta.name)) {
    res.status(403).json({ error: `Deleting rows from ${meta.name} is locked for system integrity.` });
    return;
  }

  try {
    const result = db.prepare(`DELETE FROM "${meta.name}" WHERE id = ?`).run(rowId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Record not found.' });
      return;
    }
    logAudit(req.authUser!.id, 'SCHEMA_DELETE', meta.name, rowId, `Deleted row #${rowId} from ${meta.name}`);
    res.json({ message: `Deleted record #${rowId} from ${meta.label}.` });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? `Cannot delete due to relational constraint: ${err.message}` : 'Relational constraint blocked delete.',
    });
  }
});

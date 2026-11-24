import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

export function getSigningSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || storedHash.startsWith('!') || !storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derived, storedBuf);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signTicketQr(ticketCode: string, eventId: number): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(`CADENCE_TICKET:${eventId}:${ticketCode}`)
    .digest('hex')
    .slice(0, 24)
    .toUpperCase();
}

export function verifyTicketQr(ticketCode: string, eventId: number, signature: string): boolean {
  const expected = signTicketQr(ticketCode, eventId);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature.trim().toUpperCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role_id: number;
  role_slug: string;
  role_name: string;
  role_level: number;
  organization_name: string;
  avatar_url: string;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser | null;
  authSource?: 'bearer' | 'cookie' | null;
}

export function createSession(userId: number, ip: string, userAgent: string): { token: string; expiresAt: string } {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  db.prepare(
    `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, tokenHash, ip.slice(0, 64), userAgent.slice(0, 255), expiresAt);

  return { token: rawToken, expiresAt };
}

export function setSessionCookie(res: Response, token: string): void {
  const maxAgeSeconds = 7 * 24 * 60 * 60;
  const cookieParts = [
    `cadence_session=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const cookieParts = [
    'cadence_session=',
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Partitioned',
  ];
  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

export function loadUserByToken(rawToken: string): AuthUser | null {
  const tokenHash = hashToken(rawToken);
  const row = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.role_id, u.organization_name, u.avatar_url, u.is_active,
              r.slug AS role_slug, r.name AS role_name, r.level AS role_level, s.expires_at
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as Record<string, unknown> | undefined;

  if (!row) return null;
  if (Number(row.is_active) !== 1) return null;
  if (new Date(String(row.expires_at)).getTime() < Date.now()) {
    db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  const perms = db
    .prepare(
      `SELECT p.code
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = ?`
    )
    .all(Number(row.role_id)) as Array<{ code: string }>;

  return {
    id: Number(row.id),
    full_name: String(row.full_name),
    email: String(row.email),
    role_id: Number(row.role_id),
    role_slug: String(row.role_slug),
    role_name: String(row.role_name),
    role_level: Number(row.role_level),
    organization_name: String(row.organization_name || ''),
    avatar_url: String(row.avatar_url || ''),
    permissions: perms.map((p) => p.code),
  };
}

export function attachAuth(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const user = loadUserByToken(token);
      if (user) {
        req.authUser = user;
        req.authSource = 'bearer';
        next();
        return;
      }
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  if (cookies.cadence_session) {
    const user = loadUserByToken(cookies.cadence_session);
    if (user) {
      req.authUser = user;
      req.authSource = 'cookie';
      next();
      return;
    }
  }

  req.authUser = null;
  req.authSource = null;
  next();
}

export function verifyMutationOrigin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }
  if (req.authSource !== 'cookie') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  const customHeader = req.headers['x-requested-with'];

  if (customHeader === 'CadenceSPA') {
    next();
    return;
  }

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // fall through to reject
    }
  }

  res.status(403).json({ error: 'Cross-origin cookie mutation blocked. Include X-Requested-With or Bearer token.' });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
    return;
  }
  next();
}

export function requireRoles(...allowedSlugs: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (req.authUser.role_slug === 'admin' || allowedSlugs.includes(req.authUser.role_slug)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Access restricted. Requires one of roles: ${allowedSlugs.join(', ')}. Your role is ${req.authUser.role_name}.`,
    });
  };
}

export function logAudit(userId: number | null, action: string, entityTable: string, entityId: number | null, details: string): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, entity_table, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, action, entityTable, entityId, details);
}

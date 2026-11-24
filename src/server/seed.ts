import { db } from './db.ts';
import { signTicketQr } from './auth.ts';
import { FORTY_EVENT_TEMPLATES } from './templatesData.ts';

export function seedDatabase(): void {
  const existingRoles = db.prepare('SELECT COUNT(*) AS cnt FROM roles').get() as { cnt: number };
  if (existingRoles.cnt > 0) {
    // Ensure all 40 templates are present even if DB already existed
    const tplCount = db.prepare('SELECT COUNT(*) AS cnt FROM event_templates').get() as { cnt: number };
    if (tplCount.cnt >= 40) return;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Roles (5 roles)
    const insertRole = db.prepare(
      `INSERT OR IGNORE INTO roles (name, slug, description, level) VALUES (?, ?, ?, ?)`
    );
    insertRole.run('Platform Administrator', 'admin', 'Full system governance, RBAC user management, 42-table CRUD, and security audit.', 100);
    insertRole.run('Event Organizer', 'organizer', 'Create and manage events from 40 templates, ticket tiers, promo codes, and organizer analytics.', 80);
    insertRole.run('Finance & Reporting Analyst', 'finance', 'Access financial reconciliation, tax, refunds, payouts, and exportable reporting modules.', 60);
    insertRole.run('Gate & Scanner Staff', 'gate_staff', 'Operate QR ticket verification scanners, manage entry gates, and monitor real-time capacity.', 50);
    insertRole.run('Ticket Attendee', 'attendee', 'Browse events, purchase tickets, access QR passes, and post verified reviews.', 10);

    const roleMap = new Map<string, number>();
    for (const r of db.prepare('SELECT id, slug FROM roles').all() as Array<{ id: number; slug: string }>) {
      roleMap.set(r.slug, r.id);
    }

    // 2. Permissions & 3. Role Permissions
    const permDefs = [
      ['events.read', 'events', 'View published events and schedules'],
      ['events.write', 'events', 'Create, update, and publish events'],
      ['events.delete', 'events', 'Archive or delete events'],
      ['templates.read', 'templates', 'Browse all 40 custom event templates'],
      ['templates.write', 'templates', 'Create and customize event templates'],
      ['tickets.purchase', 'ticketing', 'Checkout and receive HMAC-signed QR passes'],
      ['tickets.manage', 'ticketing', 'Configure ticket tiers and promo codes'],
      ['scanner.verify', 'scanner', 'Scan and verify QR tickets at entry gates'],
      ['attendance.live', 'attendance', 'View and update real-time gate occupancy'],
      ['reports.sales', 'reports', 'View and export ticket sales & revenue reports'],
      ['reports.attendance', 'reports', 'View and export attendance & gate velocity reports'],
      ['reports.finance', 'reports', 'Process refunds and manage organizer payouts'],
      ['reports.audit', 'reports', 'Inspect security & audit logs'],
      ['users.manage', 'admin', 'Manage user accounts and RBAC role assignments'],
      ['schema.read', 'database', 'Inspect all 42 relational database tables'],
      ['schema.write', 'database', 'Execute direct CRUD mutations across schema tables'],
    ];
    const insertPerm = db.prepare(
      `INSERT OR IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)`
    );
    for (const [code, mod, desc] of permDefs) {
      insertPerm.run(code, mod, desc);
    }

    const permMap = new Map<string, number>();
    for (const p of db.prepare('SELECT id, code FROM permissions').all() as Array<{ id: number; code: string }>) {
      permMap.set(p.code, p.id);
    }

    const insertRP = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`);
    const rolePermGrants: Record<string, string[]> = {
      admin: permDefs.map((p) => p[0]),
      organizer: [
        'events.read', 'events.write', 'events.delete', 'templates.read', 'templates.write',
        'tickets.purchase', 'tickets.manage', 'scanner.verify', 'attendance.live',
        'reports.sales', 'reports.attendance', 'schema.read',
      ],
      finance: [
        'events.read', 'templates.read', 'reports.sales', 'reports.attendance',
        'reports.finance', 'reports.audit', 'schema.read',
      ],
      gate_staff: [
        'events.read', 'scanner.verify', 'attendance.live', 'reports.attendance',
      ],
      attendee: ['events.read', 'templates.read', 'tickets.purchase'],
    };

    for (const [slug, codes] of Object.entries(rolePermGrants)) {
      const roleId = roleMap.get(slug);
      if (!roleId) continue;
      for (const code of codes) {
        const permId = permMap.get(code);
        if (permId) insertRP.run(roleId, permId);
      }
    }

    // 4. Sample Users (non-login relational profiles; interactive logins use Sign Up or Admin Claim)
    const insertUser = db.prepare(
      `INSERT OR IGNORE INTO users (full_name, email, password_hash, role_id, phone, avatar_url, organization_name, is_active)
       VALUES (?, ?, '!SAMPLE_PROFILE', ?, ?, ?, ?, 1)`
    );
    insertUser.run('Elena Vance', 'elena.vance@cadence-events.example', roleMap.get('organizer')!, '+1-415-555-0102', '/src/assets/images/avatar_organizer_1795541474034.jpg', 'Meridian Live Productions');
    insertUser.run('Marcus Chen', 'marcus.chen@cadence-events.example', roleMap.get('gate_staff')!, '+1-415-555-0118', '', 'Meridian Gate Operations');
    insertUser.run('Priya Nair', 'priya.nair@cadence-events.example', roleMap.get('finance')!, '+1-415-555-0134', '', 'Meridian Finance Group');
    insertUser.run('Daniel Brooks', 'daniel.brooks@attendee.example', roleMap.get('attendee')!, '+1-415-555-0149', '', 'Northstar Labs');
    insertUser.run('Sofia Alvarez', 'sofia.alvarez@attendee.example', roleMap.get('attendee')!, '+1-415-555-0177', '', 'Studio Forma');
    insertUser.run('Hannah Park', 'hannah.park@attendee.example', roleMap.get('attendee')!, '+1-415-555-0188', '', 'Civic Design Co');

    const users = db.prepare('SELECT id, email FROM users ORDER BY id').all() as Array<{ id: number; email: string }>;
    const organizerId = users[0]?.id ?? 1;
    const gateStaffId = users[1]?.id ?? 1;
    const financeId = users[2]?.id ?? 1;
    const attendee1Id = users[3]?.id ?? 1;
    const attendee2Id = users[4]?.id ?? 1;
    const attendee3Id = users[5]?.id ?? 1;

    // 7. Event Categories (8 categories)
    const categories = [
      ['Technology & AI', 'technology-ai', 'Cpu', 'Conferences, hackathons, developer workshops, and pitch forums.'],
      ['Music & Live Arts', 'music-live-arts', 'Music', 'Concerts, multi-stage festivals, symphonies, and theater premieres.'],
      ['Design & Architecture', 'design-architecture', 'Compass', 'Design sprints, systems conferences, and museum exhibitions.'],
      ['Executive & Gala', 'executive-gala', 'Award', 'Benefit galas, shareholder assemblies, and private launch keynotes.'],
      ['Education & Academic', 'education-academic', 'GraduationCap', 'Research symposia, CME grand rounds, and certification bootcamps.'],
      ['Sports & Wellness', 'sports-wellness', 'Activity', 'City marathons, esports championships, and mindfulness retreats.'],
      ['Community & Non-Profit', 'community-nonprofit', 'Users', 'Impact summits, makers markets, and volunteer mobilizations.'],
      ['Trade & Exhibitions', 'trade-exhibitions', 'Building2', 'Enterprise trade expos, culinary showcases, and mobility shows.'],
    ];
    const insertCat = db.prepare(
      `INSERT OR IGNORE INTO event_categories (name, slug, icon_name, description) VALUES (?, ?, ?, ?)`
    );
    for (const [name, slug, icon, desc] of categories) {
      insertCat.run(name, slug, icon, desc);
    }

    const catMap = new Map<string, number>();
    for (const c of db.prepare('SELECT id, slug FROM event_categories').all() as Array<{ id: number; slug: string }>) {
      catMap.set(c.slug, c.id);
    }

    // 8. 40 Custom Event Templates
    const insertTpl = db.prepare(
      `INSERT OR IGNORE INTO event_templates
       (code, name, category_id, description, default_duration_hours, default_capacity, suggested_ticket_price_cents, layout_style, color_accent, checklist_json, default_tiers_json, default_schedule_json, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    for (const t of FORTY_EVENT_TEMPLATES) {
      const catId = catMap.get(t.categorySlug) ?? 1;
      insertTpl.run(
        t.code,
        t.name,
        catId,
        t.description,
        t.defaultDurationHours,
        t.defaultCapacity,
        t.suggestedTicketPriceCents,
        t.layoutStyle,
        t.colorAccent,
        JSON.stringify(t.checklist),
        JSON.stringify(t.defaultTiers),
        JSON.stringify(t.defaultSchedule)
      );
    }

    // 9. Venues (4 venues)
    const insertVenue = db.prepare(
      `INSERT INTO venues (name, address, city, country, total_capacity, venue_type, timezone, contact_email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const v1 = Number(insertVenue.run('Metropolis Convention Center', '740 Howard St', 'San Francisco', 'United States', 2400, 'Convention Auditorium', 'America/Los_Angeles', 'ops@metropolissf.example').lastInsertRowid);
    const v2 = Number(insertVenue.run('Redwood Ridge Amphitheater', '1900 Canyon Rd', 'Oakland', 'United States', 3200, 'Open-Air Amphitheater', 'America/Los_Angeles', 'gates@redwoodamphitheater.example').lastInsertRowid);
    const v3 = Number(insertVenue.run('Foundry Design Pavilion', '412 Mercer St', 'Seattle', 'United States', 600, 'Industrial Studio Loft', 'America/Los_Angeles', 'studio@foundrypavilion.example').lastInsertRowid);
    const v4 = Number(insertVenue.run('Atrium Museum of Modern Art', '220 Museum Way', 'Chicago', 'United States', 900, 'Museum Atrium', 'America/Chicago', 'events@atriummoma.example').lastInsertRowid);

    // 10. Venue Zones (12 zones)
    const insertZone = db.prepare(
      `INSERT INTO venue_zones (venue_id, name, zone_code, capacity, floor_level, is_vip) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const z1 = Number(insertZone.run(v1, 'Main Keynote Auditorium', 'MCC-AUD', 1200, 'Level 1', 0).lastInsertRowid);
    const z2 = Number(insertZone.run(v1, 'Executive Sky Lounge', 'MCC-VIP', 200, 'Level 3', 1).lastInsertRowid);
    const z3 = Number(insertZone.run(v1, 'Engineering Breakout Wing', 'MCC-BRK', 600, 'Level 2', 0).lastInsertRowid);
    const z4 = Number(insertZone.run(v2, 'Main Hillside Lawn', 'RRA-LAWN', 2000, 'Ground', 0).lastInsertRowid);
    const z5 = Number(insertZone.run(v2, 'Reserved Acoustic Bowl', 'RRA-BOWL', 900, 'Terrace 1', 0).lastInsertRowid);
    const z6 = Number(insertZone.run(v2, 'Front Pit & Artist Terrace', 'RRA-VIP', 300, 'Stage Level', 1).lastInsertRowid);
    const z7 = Number(insertZone.run(v3, 'North Oak Studio Floor', 'FDP-NORTH', 320, 'Floor 2', 0).lastInsertRowid);
    const z8 = Number(insertZone.run(v3, 'Gallery Pin-Up Mezzanine', 'FDP-MEZZ', 180, 'Mezzanine', 1).lastInsertRowid);
    const z9 = Number(insertZone.run(v4, 'Grand Stone Atrium', 'AMM-ATR', 600, 'Ground', 0).lastInsertRowid);
    const z10 = Number(insertZone.run(v4, 'Patron Balcony Overlook', 'AMM-PAT', 180, 'Level 2', 1).lastInsertRowid);
    insertZone.run(v1, 'Sponsor Exhibition Concourse', 'MCC-EXP', 400, 'Level 1', 0);
    insertZone.run(v4, 'West Wing Sculpture Hall', 'AMM-WEST', 120, 'Level 1', 0);

    // 11. Venue Seats (48 seats)
    const insertSeat = db.prepare(
      `INSERT INTO venue_seats (zone_id, row_label, seat_number, seat_type, is_accessible) VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of ['A', 'B', 'C', 'D']) {
      for (let num = 1; num <= 6; num++) {
        insertSeat.run(z1, row, String(num), row === 'A' ? 'VIP Front' : 'Standard', num === 1 ? 1 : 0);
        insertSeat.run(z5, row, String(num), row === 'A' ? 'Prime Bowl' : 'Reserved', num === 6 ? 1 : 0);
      }
    }

    // 12. Entry Gates (6 gates)
    const insertGate = db.prepare(
      `INSERT INTO entry_gates (venue_id, gate_name, gate_code, gate_type, assigned_staff_id, is_open) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const g1 = Number(insertGate.run(v1, 'Main Concourse Gate A', 'GATE-MCC-A', 'General Entry', gateStaffId, 1).lastInsertRowid);
    const g2 = Number(insertGate.run(v1, 'VIP Express Gate B', 'GATE-MCC-B', 'VIP Fast-Track', gateStaffId, 1).lastInsertRowid);
    const g3 = Number(insertGate.run(v2, 'Canyon North Gate', 'GATE-RRA-N', 'General Entry', gateStaffId, 1).lastInsertRowid);
    const g4 = Number(insertGate.run(v2, 'Terrace VIP Gate', 'GATE-RRA-V', 'VIP Fast-Track', gateStaffId, 1).lastInsertRowid);
    const g5 = Number(insertGate.run(v3, 'Mercer Freight & Studio Door', 'GATE-FDP-1', 'Workshop Check-In', gateStaffId, 1).lastInsertRowid);
    const g6 = Number(insertGate.run(v4, 'Atrium West Portico', 'GATE-AMM-W', 'Gala Valet Entry', gateStaffId, 1).lastInsertRowid);

    // 13. Scanner Devices (6 devices)
    const insertDevice = db.prepare(
      `INSERT INTO scanner_devices (gate_id, device_name, device_serial, status) VALUES (?, ?, ?, ?)`
    );
    const dev1 = Number(insertDevice.run(g1, 'Zebra Handheld #01', 'ZBR-9921-A1', 'online').lastInsertRowid);
    const dev2 = Number(insertDevice.run(g2, 'iPad Pro Kiosk #02', 'IPD-4410-B2', 'online').lastInsertRowid);
    const dev3 = Number(insertDevice.run(g3, 'Zebra Handheld #03', 'ZBR-9922-C3', 'online').lastInsertRowid);
    insertDevice.run(g4, 'iPad Pro Kiosk #04', 'IPD-4411-D4', 'online');
    insertDevice.run(g5, 'Desktop QR Reader #05', 'DSK-2019-E5', 'online');
    insertDevice.run(g6, 'Concierge Scanner #06', 'ZBR-9930-F6', 'standby');

    // Lookup template IDs
    const tplByCode = new Map<string, number>();
    for (const row of db.prepare('SELECT id, code FROM event_templates').all() as Array<{ id: number; code: string }>) {
      tplByCode.set(row.code, row.id);
    }

    // 14. Events (6 rich featured/live events)
    const insertEvent = db.prepare(
      `INSERT INTO events (organizer_id, template_id, category_id, venue_id, title, slug, summary, description, banner_url, start_at, end_at, status, capacity, is_featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const ev1 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-001') ?? 1, catMap.get('technology-ai') ?? 1, v1,
        'Meridian AI & Systems Summit 2026', 'meridian-ai-systems-summit-2026',
        'Three-track production AI engineering summit with live benchmarks, system architecture talks, and executive labs.',
        'Join 800 principal engineers, ML researchers, and platform architects for a full-day exploration of deterministic inference, distributed data pipelines, and resilient observability.',
        '/src/assets/images/hero_summit_stage_1795541473829.jpg',
        '2026-12-08T09:00:00Z', '2026-12-08T19:00:00Z', 'live', 800, 1
      ).lastInsertRowid
    );
    const ev2 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-006') ?? 6, catMap.get('music-live-arts') ?? 2, v2,
        'Redwood Twilight Acoustic Sessions', 'redwood-twilight-acoustic-sessions',
        'An open-air sunset amphitheater concert featuring indie ensembles, spatial sound engineering, and hillside dining.',
        'Experience live acoustic and electronic sets framed by brutalist concrete acoustics and twilight canyon vistas at Redwood Ridge Amphitheater.',
        '/src/assets/images/event_music_festival_1795541473367.jpg',
        '2026-12-12T17:00:00Z', '2026-12-12T23:00:00Z', 'published', 1800, 1
      ).lastInsertRowid
    );
    const ev3 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-011') ?? 11, catMap.get('design-architecture') ?? 3, v3,
        'Foundry Architectural Design Sprint', 'foundry-architectural-design-sprint',
        'Intensive studio workshop pairing industrial designers and civic architects on rapid physical prototyping.',
        'Worktable teams collaborate across structural modeling, material studies, and jury pin-up critiques in our sunlit Mercer Street loft.',
        '/src/assets/images/event_design_workshop_1795541473705.jpg',
        '2026-12-15T09:30:00Z', '2026-12-15T17:30:00Z', 'published', 120, 1
      ).lastInsertRowid
    );
    const ev4 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-016') ?? 16, catMap.get('executive-gala') ?? 4, v4,
        'Atrium Contemporary Arts Benefit Gala', 'atrium-contemporary-arts-benefit-gala',
        'Black-tie museum atrium reception and seated dinner supporting public architectural preservation fellowships.',
        'An evening of curated gallery previews, acoustic chamber music, and philanthropic honors inside the limestone Atrium Museum.',
        '/src/assets/images/event_gala_dinner_1795541474151.jpg',
        '2026-12-19T18:30:00Z', '2026-12-19T23:30:00Z', 'published', 320, 1
      ).lastInsertRowid
    );
    const ev5 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-036') ?? 36, catMap.get('trade-exhibitions') ?? 8, v1,
        'Pacific Enterprise Hardware & Cloud Expo', 'pacific-enterprise-hardware-cloud-expo',
        'Commercial exhibition uniting 60 infrastructure vendors, live rack demonstrations, and buyer roundtables.',
        'Full concourse exhibition hall featuring live server-grade cooling demos, enterprise procurement briefings, and partner keynotes.',
        '/src/assets/images/hero_summit_stage_1795541473829.jpg',
        '2027-01-14T08:30:00Z', '2027-01-14T18:30:00Z', 'published', 1500, 0
      ).lastInsertRowid
    );
    const ev6 = Number(
      insertEvent.run(
        organizerId, tplByCode.get('TPL-021') ?? 21, catMap.get('education-academic') ?? 5, v3,
        'Applied Data & Robotics Research Symposium', 'applied-data-robotics-research-symposium',
        'Peer-reviewed academic research talks, poster exhibitions, and faculty lightning panels.',
        'Bringing together university laboratories and industry applied research teams to share reproducible benchmarks.',
        '/src/assets/images/event_design_workshop_1795541473705.jpg',
        '2027-01-22T09:00:00Z', '2027-01-22T17:00:00Z', 'draft', 280, 0
      ).lastInsertRowid
    );

    // 15. Event Sessions
    const insertSession = db.prepare(
      `INSERT INTO event_sessions (event_id, zone_id, title, track_name, start_at, end_at, capacity, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const s1 = Number(insertSession.run(ev1, z1, 'Opening Keynote: Deterministic AI Infrastructure', 'Main Auditorium', '2026-12-08T09:30:00Z', '2026-12-08T11:00:00Z', 800, 'Architectural blueprint for low-latency model serving.').lastInsertRowid);
    const s2 = Number(insertSession.run(ev1, z3, 'Zero-Copy Telemetry & Real-Time Pipelines', 'Engineering Track', '2026-12-08T11:30:00Z', '2026-12-08T13:00:00Z', 300, 'Deep dive into streaming ingestion and partitioned SQLite/Postgres stores.').lastInsertRowid);
    const s3 = Number(insertSession.run(ev1, z2, 'Executive Governance & Safety Roundtable', 'Executive Track', '2026-12-08T14:30:00Z', '2026-12-08T16:00:00Z', 180, 'Evaluating production guardrails and audit compliance.').lastInsertRowid);
    const s4 = Number(insertSession.run(ev2, z4, 'Opening Acoustic Trio Set', 'Main Bowl', '2026-12-12T17:30:00Z', '2026-12-12T19:00:00Z', 1800, 'Twilight ambient and folk opener.').lastInsertRowid);
    const s5 = Number(insertSession.run(ev2, z5, 'Headliner Amphitheater Performance', 'Main Bowl', '2026-12-12T19:45:00Z', '2026-12-12T22:30:00Z', 1800, 'Full band spatial audio headline set.').lastInsertRowid);
    const s6 = Number(insertSession.run(ev3, z7, 'Material Framing & Timber Joinery Lab', 'North Studio', '2026-12-15T10:00:00Z', '2026-12-15T13:00:00Z', 120, 'Hands-on scale model fabrication.').lastInsertRowid);
    const s7 = Number(insertSession.run(ev4, z9, 'Atrium Chamber Reception & Honors Dinner', 'Grand Atrium', '2026-12-19T18:30:00Z', '2026-12-19T22:00:00Z', 320, 'Seated three-course gala and fellowship awards.').lastInsertRowid);

    // 16. Speakers & 17. Session Speakers
    const insertSpeaker = db.prepare(
      `INSERT OR IGNORE INTO speakers (full_name, title, company, bio, email) VALUES (?, ?, ?, ?, ?)`
    );
    const sp1 = Number(insertSpeaker.run('Dr. Aris Thorne', 'VP of Systems Architecture', 'Lattice Compute', 'Leads distributed inference teams across 14 global regions.', 'aris.thorne@lattice.example').lastInsertRowid) || 1;
    const sp2 = Number(insertSpeaker.run('Nadia Okafor', 'Principal Data Engineer', 'StreamCore', 'Author of high-throughput event ingestion engines.', 'nadia.okafor@streamcore.example').lastInsertRowid) || 2;
    const sp3 = Number(insertSpeaker.run('Julian Mercer', 'Founding Architect', 'Mercer & Partners', 'Award-winning civic and timber pavilion architect.', 'julian@mercerarchitects.example').lastInsertRowid) || 3;
    const sp4 = Number(insertSpeaker.run('Claire Lindqvist', 'Chief Curator', 'Atrium Museum', 'Curator of contemporary spatial installations.', 'claire@atriummoma.example').lastInsertRowid) || 4;

    const insertSS = db.prepare(`INSERT OR IGNORE INTO session_speakers (session_id, speaker_id, role_label) VALUES (?, ?, ?)`);
    insertSS.run(s1, sp1, 'Keynote Speaker');
    insertSS.run(s2, sp2, 'Technical Lead');
    insertSS.run(s3, sp1, 'Moderator');
    insertSS.run(s6, sp3, 'Studio Director');
    insertSS.run(s7, sp4, 'Gala Host');

    // 18. Sponsors & 19. Event Sponsors
    const insertSponsor = db.prepare(`INSERT OR IGNORE INTO sponsors (name, website, tier_default, contact_email, logo_text) VALUES (?, ?, ?, ?, ?)`);
    const spo1 = Number(insertSponsor.run('Vertex Cloud Systems', 'https://vertexcloud.example', 'Platinum', 'partners@vertexcloud.example', 'VERTEX').lastInsertRowid) || 1;
    const spo2 = Number(insertSponsor.run('Northstar Ventures', 'https://northstarvc.example', 'Gold', 'hello@northstarvc.example', 'NORTHSTAR').lastInsertRowid) || 2;
    const spo3 = Number(insertSponsor.run('Kinetix Audio Labs', 'https://kinetixaudio.example', 'Silver', 'events@kinetixaudio.example', 'KINETIX').lastInsertRowid) || 3;

    const insertES = db.prepare(`INSERT OR IGNORE INTO event_sponsors (event_id, sponsor_id, sponsorship_tier, contribution_cents) VALUES (?, ?, ?, ?)`);
    insertES.run(ev1, spo1, 'Platinum', 2500000);
    insertES.run(ev1, spo2, 'Gold', 1200000);
    insertES.run(ev2, spo3, 'Sound Partner', 800000);
    insertES.run(ev4, spo2, 'Patron Sponsor', 1500000);

    // 20. Event Tasks
    const insertTask = db.prepare(
      `INSERT INTO event_tasks (event_id, assigned_to, title, priority, status, due_date) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertTask.run(ev1, gateStaffId, 'Verify dual-lane QR scanner battery banks at Gate A & B', 'critical', 'completed', '2026-12-07T18:00:00Z');
    insertTask.run(ev1, organizerId, 'Confirm keynote wireless lapel mic frequency test', 'high', 'in_progress', '2026-12-08T07:30:00Z');
    insertTask.run(ev2, gateStaffId, 'Deploy hillside lighting & perimeter QR scanner kiosks', 'high', 'pending', '2026-12-12T14:00:00Z');
    insertTask.run(ev3, organizerId, 'Prepare scale model kits on oak studio tables', 'medium', 'completed', '2026-12-14T16:00:00Z');
    insertTask.run(ev4, financeId, 'Reconcile patron table pledge receipts', 'high', 'in_progress', '2026-12-18T17:00:00Z');

    // 21. Ticket Tiers
    const insertTier = db.prepare(
      `INSERT INTO ticket_tiers (event_id, zone_id, name, description, price_cents, quantity_total, quantity_sold, max_per_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    const t1 = Number(insertTier.run(ev1, z1, 'General Conference Pass', 'Full access to all mainstage & engineering sessions', 24900, 550, 4, 6).lastInsertRowid);
    const t2 = Number(insertTier.run(ev1, z2, 'VIP Executive Pass', 'Reserved front rows, Sky Lounge & speaker dinner', 54900, 150, 2, 4).lastInsertRowid);
    const t3 = Number(insertTier.run(ev1, z3, 'Academic / Student Pass', 'Discounted pass for students and researchers', 9900, 100, 1, 2).lastInsertRowid);

    const t4 = Number(insertTier.run(ev2, z4, 'General Lawn Admission', 'Hillside lawn entry & food village', 5500, 1200, 2, 8).lastInsertRowid);
    const t5 = Number(insertTier.run(ev2, z5, 'Reserved Acoustic Bowl', 'Numbered terrace bowl seating', 9500, 450, 1, 6).lastInsertRowid);
    const t6 = Number(insertTier.run(ev2, z6, 'Front Pit & Lounge VIP', 'Stage-front pit + private artist terrace', 16500, 150, 1, 4).lastInsertRowid);

    const t7 = Number(insertTier.run(ev3, z7, 'Studio Participant Seat', 'Full-day sprint materials, studio lunch & critique', 18500, 90, 2, 4).lastInsertRowid);
    const t8 = Number(insertTier.run(ev3, z8, 'Pin-Up Critique Observer', 'Afternoon jury presentation pass', 6500, 30, 0, 4).lastInsertRowid);

    const t9 = Number(insertTier.run(ev4, z9, 'Individual Gala Seat', 'Atrium champagne reception & three-course dinner', 35000, 240, 2, 6).lastInsertRowid);
    const t10 = Number(insertTier.run(ev4, z10, 'Patron Balcony Table', 'Overlook balcony VIP seating & curator tour', 65000, 80, 0, 4).lastInsertRowid);

    insertTier.run(ev5, z1, 'Expo Floor Pass', 'Exhibition concourse & partner keynotes', 15000, 1200, 0, 10);
    insertTier.run(ev5, z2, 'Hosted Buyer VIP', 'Private procurement lounge access', 35000, 300, 0, 5);
    insertTier.run(ev6, z7, 'Symposium Delegate', 'Paper tracks & poster floor', 4500, 280, 0, 5);

    // 22. Promo Codes
    const insertPromo = db.prepare(
      `INSERT OR IGNORE INTO promo_codes (event_id, code, discount_type, discount_value, max_uses, current_uses, valid_until, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    );
    const pr1 = Number(insertPromo.run(ev1, 'SUMMIT20', 'percent', 20, 200, 2, '2026-12-08T23:59:59Z').lastInsertRowid) || 1;
    insertPromo.run(ev2, 'TWILIGHT15', 'percent', 15, 300, 0, '2026-12-12T23:59:59Z');
    insertPromo.run(null, 'CADENCE25', 'fixed', 2500, 500, 1, '2027-06-01T23:59:59Z');

    // 23. Tax Rates
    const insertTax = db.prepare(
      `INSERT OR IGNORE INTO tax_rates (region_code, tax_name, rate_percent, is_inclusive) VALUES (?, ?, ?, ?)`
    );
    const taxCA = Number(insertTax.run('US-CA', 'California Event Tax', 8.5, 0).lastInsertRowid) || 1;
    insertTax.run('US-WA', 'Washington State Sales Tax', 9.2, 0);
    insertTax.run('US-IL', 'Chicago Amusement Tax', 9.0, 0);

    // 24. Orders, 25. Order Items, 26. Payments, 27. Refunds, 28. Tickets
    const insertOrder = db.prepare(
      `INSERT INTO orders (user_id, event_id, promo_code_id, tax_rate_id, order_number, subtotal_cents, discount_cents, tax_cents, total_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertOrderItem = db.prepare(
      `INSERT INTO order_items (order_id, ticket_tier_id, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?)`
    );
    const insertPayment = db.prepare(
      `INSERT INTO payments (order_id, payment_method, transaction_ref, amount_cents, currency, status, paid_at) VALUES (?, ?, ?, ?, 'USD', ?, ?)`
    );
    const insertTicket = db.prepare(
      `INSERT INTO tickets (order_item_id, event_id, ticket_tier_id, attendee_id, seat_id, ticket_code, qr_signature, holder_name, holder_email, status, checked_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Order 1: Summit General x2 (checked in + valid)
    const o1 = Number(insertOrder.run(attendee1Id, ev1, pr1, taxCA, 'ORD-2026-1001', 49800, 9960, 3386, 43226, 'paid', '2026-11-18T10:15:00Z').lastInsertRowid);
    const oi1 = Number(insertOrderItem.run(o1, t1, 2, 24900, 49800).lastInsertRowid);
    insertPayment.run(o1, 'card', 'TXN-9001-CAD', 43226, 'succeeded', '2026-11-18T10:15:05Z');
    const tk1 = Number(insertTicket.run(oi1, ev1, t1, attendee1Id, 1, 'CAD-1001-ALPHA', signTicketQr('CAD-1001-ALPHA', ev1), 'Daniel Brooks', 'daniel.brooks@attendee.example', 'checked_in', '2026-11-24T09:05:00Z').lastInsertRowid);
    const tk2 = Number(insertTicket.run(oi1, ev1, t1, attendee1Id, 2, 'CAD-1001-BRAVO', signTicketQr('CAD-1001-BRAVO', ev1), 'Elena Rostova', 'elena.r@northstar.example', 'valid', null).lastInsertRowid);

    // Order 2: Summit VIP x2
    const o2 = Number(insertOrder.run(attendee2Id, ev1, null, taxCA, 'ORD-2026-1002', 109800, 0, 9333, 119133, 'paid', '2026-11-19T14:22:00Z').lastInsertRowid);
    const oi2 = Number(insertOrderItem.run(o2, t2, 2, 54900, 109800).lastInsertRowid);
    insertPayment.run(o2, 'card', 'TXN-9002-CAD', 119133, 'succeeded', '2026-11-19T14:22:08Z');
    const tk3 = Number(insertTicket.run(oi2, ev1, t2, attendee2Id, 3, 'CAD-1002-VIP01', signTicketQr('CAD-1002-VIP01', ev1), 'Sofia Alvarez', 'sofia.alvarez@attendee.example', 'checked_in', '2026-11-24T09:12:00Z').lastInsertRowid);
    const tk4 = Number(insertTicket.run(oi2, ev1, t2, attendee2Id, 4, 'CAD-1002-VIP02', signTicketQr('CAD-1002-VIP02', ev1), 'Mateo Silva', 'mateo@studioforma.example', 'valid', null).lastInsertRowid);

    // Order 3: Summit General x2 + Student x1 (1 refunded)
    const o3 = Number(insertOrder.run(attendee3Id, ev1, null, taxCA, 'ORD-2026-1003', 59700, 0, 5075, 64775, 'paid', '2026-11-20T09:10:00Z').lastInsertRowid);
    const oi3 = Number(insertOrderItem.run(o3, t1, 2, 24900, 49800).lastInsertRowid);
    const oi4 = Number(insertOrderItem.run(o3, t3, 1, 9900, 9900).lastInsertRowid);
    const pay3 = Number(insertPayment.run(o3, 'ach', 'TXN-9003-CAD', 64775, 'succeeded', '2026-11-20T09:10:12Z').lastInsertRowid);
    insertTicket.run(oi3, ev1, t1, attendee3Id, 5, 'CAD-1003-GEN01', signTicketQr('CAD-1003-GEN01', ev1), 'Hannah Park', 'hannah.park@attendee.example', 'valid', null);
    insertTicket.run(oi3, ev1, t1, attendee3Id, 6, 'CAD-1003-GEN02', signTicketQr('CAD-1003-GEN02', ev1), 'Liam Vance', 'liam.vance@civic.example', 'cancelled', null);
    insertTicket.run(oi4, ev1, t3, attendee3Id, null, 'CAD-1003-EDU01', signTicketQr('CAD-1003-EDU01', ev1), 'Maya Patel', 'maya.patel@uni.example', 'valid', null);

    db.prepare(`INSERT INTO refunds (payment_id, processed_by, amount_cents, reason, status) VALUES (?, ?, ?, ?, 'completed')`)
      .run(pay3, financeId, 24900, 'Attendee schedule conflict on General Pass #2');

    // Order 4: Redwood Concert
    const o4 = Number(insertOrder.run(attendee1Id, ev2, null, taxCA, 'ORD-2026-1004', 27000, 0, 2295, 29295, 'paid', '2026-11-21T16:45:00Z').lastInsertRowid);
    const oi5 = Number(insertOrderItem.run(o4, t4, 2, 5500, 11000).lastInsertRowid);
    const oi6 = Number(insertOrderItem.run(o4, t6, 1, 16500, 16500).lastInsertRowid);
    insertPayment.run(o4, 'card', 'TXN-9004-CAD', 29295, 'succeeded', '2026-11-21T16:45:04Z');
    insertTicket.run(oi5, ev2, t4, attendee1Id, null, 'CAD-2004-LAWN1', signTicketQr('CAD-2004-LAWN1', ev2), 'Daniel Brooks', 'daniel.brooks@attendee.example', 'valid', null);
    insertTicket.run(oi5, ev2, t4, attendee1Id, null, 'CAD-2004-LAWN2', signTicketQr('CAD-2004-LAWN2', ev2), 'Claire Brooks', 'claire.brooks@attendee.example', 'valid', null);
    insertTicket.run(oi6, ev2, t6, attendee1Id, null, 'CAD-2004-PIT01', signTicketQr('CAD-2004-PIT01', ev2), 'Daniel Brooks', 'daniel.brooks@attendee.example', 'valid', null);

    // Order 5: Design Sprint & Gala
    const o5 = Number(insertOrder.run(attendee2Id, ev3, null, taxCA, 'ORD-2026-1005', 37000, 0, 3145, 40145, 'paid', '2026-11-22T11:30:00Z').lastInsertRowid);
    const oi7 = Number(insertOrderItem.run(o5, t7, 2, 18500, 37000).lastInsertRowid);
    insertPayment.run(o5, 'card', 'TXN-9005-CAD', 40145, 'succeeded', '2026-11-22T11:30:06Z');
    insertTicket.run(oi7, ev3, t7, attendee2Id, null, 'CAD-3005-STU01', signTicketQr('CAD-3005-STU01', ev3), 'Sofia Alvarez', 'sofia.alvarez@attendee.example', 'valid', null);
    insertTicket.run(oi7, ev3, t7, attendee2Id, null, 'CAD-3005-STU02', signTicketQr('CAD-3005-STU02', ev3), 'Lucas Meyer', 'lucas@studioforma.example', 'valid', null);

    const o6 = Number(insertOrder.run(attendee3Id, ev4, null, taxCA, 'ORD-2026-1006', 70000, 0, 5950, 75950, 'paid', '2026-11-23T15:00:00Z').lastInsertRowid);
    const oi8 = Number(insertOrderItem.run(o6, t9, 2, 35000, 70000).lastInsertRowid);
    insertPayment.run(o6, 'card', 'TXN-9006-CAD', 75950, 'succeeded', '2026-11-23T15:00:05Z');
    insertTicket.run(oi8, ev4, t9, attendee3Id, null, 'CAD-4006-GAL01', signTicketQr('CAD-4006-GAL01', ev4), 'Hannah Park', 'hannah.park@attendee.example', 'valid', null);
    insertTicket.run(oi8, ev4, t9, attendee3Id, null, 'CAD-4006-GAL02', signTicketQr('CAD-4006-GAL02', ev4), 'Noah Kim', 'noah.kim@civic.example', 'valid', null);

    // Also add 1 ticket on t5 for ev2
    const o7 = Number(insertOrder.run(attendee2Id, ev2, null, taxCA, 'ORD-2026-1007', 9500, 0, 808, 10308, 'paid', '2026-11-23T18:20:00Z').lastInsertRowid);
    const oi9 = Number(insertOrderItem.run(o7, t5, 1, 9500, 9500).lastInsertRowid);
    insertPayment.run(o7, 'card', 'TXN-9007-CAD', 10308, 'succeeded', '2026-11-23T18:20:04Z');
    insertTicket.run(oi9, ev2, t5, attendee2Id, 25, 'CAD-2007-BWL01', signTicketQr('CAD-2007-BWL01', ev2), 'Sofia Alvarez', 'sofia.alvarez@attendee.example', 'valid', null);

    // 29. Ticket Scans & 30. Attendance Logs & 31. Session Checkins & 32. Gate Shifts & 33. Capacity Snapshots
    const insertScan = db.prepare(
      `INSERT INTO ticket_scans (ticket_id, event_id, gate_id, scanner_device_id, scanned_by, scan_result, rejection_reason, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertScan.run(tk1, ev1, g1, dev1, gateStaffId, 'VALID', '', '2026-11-24T09:05:00Z');
    insertScan.run(tk1, ev1, g1, dev1, gateStaffId, 'ALREADY_CHECKED_IN', 'Duplicate pass scan detected at Gate A', '2026-11-24T09:07:15Z');
    insertScan.run(tk3, ev1, g2, dev2, gateStaffId, 'VALID', '', '2026-11-24T09:12:00Z');
    insertScan.run(null, ev1, g1, dev1, gateStaffId, 'INVALID_SIGNATURE', 'QR cryptographic signature mismatch', '2026-11-24T09:18:40Z');

    const insertAtt = db.prepare(
      `INSERT INTO attendance_logs (event_id, zone_id, ticket_id, direction, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertAtt.run(ev1, z1, tk1, 'IN', gateStaffId, '2026-11-24T09:05:00Z');
    insertAtt.run(ev1, z2, tk3, 'IN', gateStaffId, '2026-11-24T09:12:00Z');

    db.prepare(`INSERT INTO session_checkins (session_id, ticket_id, checked_in_by) VALUES (?, ?, ?)`).run(s1, tk1, gateStaffId);
    db.prepare(`INSERT INTO session_checkins (session_id, ticket_id, checked_in_by) VALUES (?, ?, ?)`).run(s1, tk3, gateStaffId);

    const insertShift = db.prepare(
      `INSERT INTO gate_shifts (gate_id, staff_user_id, event_id, shift_start, shift_end, status) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertShift.run(g1, gateStaffId, ev1, '2026-12-08T07:30:00Z', '2026-12-08T15:30:00Z', 'active');
    insertShift.run(g2, gateStaffId, ev1, '2026-12-08T07:30:00Z', '2026-12-08T15:30:00Z', 'active');
    insertShift.run(g3, gateStaffId, ev2, '2026-12-12T15:30:00Z', '2026-12-12T22:30:00Z', 'scheduled');

    const insertCap = db.prepare(
      `INSERT INTO capacity_snapshots (event_id, current_occupancy, peak_occupancy, total_scans_valid, total_scans_rejected)
       VALUES (?, ?, ?, ?, ?)`
    );
    insertCap.run(ev1, 2, 2, 2, 2);
    insertCap.run(ev2, 0, 0, 0, 0);

    // 34. Waitlist Entries
    db.prepare(`INSERT INTO waitlist_entries (event_id, ticket_tier_id, email, full_name, status) VALUES (?, ?, ?, ?, ?)`)
      .run(ev1, t2, 'alex.morgan@enterprise.example', 'Alex Morgan', 'waiting');
    db.prepare(`INSERT INTO waitlist_entries (event_id, ticket_tier_id, email, full_name, status) VALUES (?, ?, ?, ?, ?)`)
      .run(ev4, t10, 'victoria.lee@arts.example', 'Victoria Lee', 'invited');

    // 35. Email Campaigns
    db.prepare(`INSERT INTO email_campaigns (event_id, created_by, subject, segment, sent_count, open_rate_percent, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(ev1, organizerId, 'Meridian Summit: Gate Check-In & QR Pass Ready', 'All Ticket Holders', 385, 74.2, 'sent');
    db.prepare(`INSERT INTO email_campaigns (event_id, created_by, subject, segment, sent_count, open_rate_percent, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(ev2, organizerId, 'Redwood Twilight: Shuttle & Gate Opening Schedule', 'General Lawn + Bowl', 620, 68.5, 'sent');

    // 36. Notifications
    db.prepare(`INSERT INTO notifications (user_id, event_id, title, message, channel, is_read) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(organizerId, ev1, 'Gate A & VIP Gate B Online', 'All 2 primary QR scanner kiosks passed pre-event heartbeat checks.', 'in_app', 0);
    db.prepare(`INSERT INTO notifications (user_id, event_id, title, message, channel, is_read) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(attendee1Id, ev1, 'Digital QR Pass Issued', 'Your pass CAD-1001-ALPHA is ready for express scan entry.', 'email', 1);

    // 37. Event Reviews
    db.prepare(`INSERT INTO event_reviews (event_id, user_id, rating, comment, is_verified_attendee) VALUES (?, ?, ?, ?, 1)`)
      .run(ev1, attendee1Id, 5, 'Sub-second QR gate check-in and remarkably crisp audio across every keynote session.');
    db.prepare(`INSERT INTO event_reviews (event_id, user_id, rating, comment, is_verified_attendee) VALUES (?, ?, ?, ?, 1)`)
      .run(ev1, attendee2Id, 5, 'VIP Sky Lounge access and structured networking made the summit effortless.');

    // 38. Saved Events
    db.prepare(`INSERT OR IGNORE INTO saved_events (user_id, event_id) VALUES (?, ?)`).run(attendee1Id, ev3);
    db.prepare(`INSERT OR IGNORE INTO saved_events (user_id, event_id) VALUES (?, ?)`).run(attendee2Id, ev4);

    // 39. Organizer Payouts
    const insertPayout = db.prepare(
      `INSERT INTO organizer_payouts (organizer_id, event_id, gross_cents, platform_fee_cents, net_payout_cents, status, scheduled_date, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertPayout.run(organizerId, ev1, 227134, 11357, 215777, 'scheduled', '2026-12-12T00:00:00Z', null);
    insertPayout.run(organizerId, ev2, 39603, 1980, 37623, 'scheduled', '2026-12-16T00:00:00Z', null);
    insertPayout.run(organizerId, ev3, 40145, 2007, 38138, 'pending', '2026-12-20T00:00:00Z', null);
    insertPayout.run(organizerId, ev4, 75950, 3798, 72152, 'paid', '2026-11-24T08:00:00Z', '2026-11-24T08:05:00Z');

    // 40. Saved Reports & 41. Report Exports
    const insertRep = db.prepare(
      `INSERT INTO saved_reports (created_by, event_id, report_type, title, filters_json) VALUES (?, ?, ?, ?, ?)`
    );
    const rep1 = Number(insertRep.run(financeId, ev1, 'sales_revenue', 'Q4 Summit Ticket Sales & Net Revenue', '{"status":"paid"}').lastInsertRowid);
    const rep2 = Number(insertRep.run(gateStaffId, ev1, 'attendance_velocity', 'Gate A & VIP B Throughput Audit', '{"gate":"all"}').lastInsertRowid);
    const rep3 = Number(insertRep.run(organizerId, null, 'template_performance', '40-Template Capacity Utilization Matrix', '{}').lastInsertRowid);

    const insertExp = db.prepare(
      `INSERT INTO report_exports (saved_report_id, exported_by, format, row_count, file_name) VALUES (?, ?, ?, ?, ?)`
    );
    insertExp.run(rep1, financeId, 'csv', 18, 'q4_summit_sales_2026.csv');
    insertExp.run(rep2, gateStaffId, 'csv', 4, 'gate_throughput_audit.csv');
    insertExp.run(rep3, organizerId, 'json', 40, 'event_templates_matrix.json');

    // 42. Webhook Endpoints
    db.prepare(`INSERT INTO webhook_endpoints (organizer_id, event_id, target_url, event_types, is_active) VALUES (?, ?, ?, ?, 1)`)
      .run(organizerId, ev1, 'https://hooks.meridian.example/cadence-checkin', 'ticket.purchased,ticket.scanned,capacity.threshold');

    // 6. Audit Logs
    const insertAudit = db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_table, entity_id, details) VALUES (?, ?, ?, ?, ?)`
    );
    insertAudit.run(organizerId, 'CREATE_FROM_TEMPLATE', 'events', ev1, 'Provisioned Meridian AI & Systems Summit 2026 from template TPL-001');
    insertAudit.run(gateStaffId, 'SCAN_REJECTED', 'ticket_scans', 2, 'Blocked duplicate scan on CAD-1001-ALPHA at Gate A');
    insertAudit.run(gateStaffId, 'SCAN_REJECTED', 'ticket_scans', 4, 'Blocked forged QR signature attempt at Gate A');
    insertAudit.run(financeId, 'REFUND_ISSUED', 'refunds', 1, 'Issued $249.00 partial refund on ORD-2026-1003');

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# ============================================================================
# DOMAIN A: IDENTITY, RBAC & SESSIONS (6 MODELS)
# ============================================================================

class Role(db.Model):
    __tablename__ = "roles"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    slug = db.Column(db.String(40), unique=True, nullable=False)
    description = db.Column(db.Text, nullable=False)
    level = db.Column(db.Integer, nullable=False, default=10)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    users = db.relationship("User", back_populates="role", lazy=True)
    role_permissions = db.relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")


class Permission(db.Model):
    __tablename__ = "permissions"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(64), unique=True, nullable=False)
    module = db.Column(db.String(40), nullable=False)
    description = db.Column(db.Text, nullable=False)
    role_permissions = db.relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")


class RolePermission(db.Model):
    __tablename__ = "role_permissions"
    id = db.Column(db.Integer, primary_key=True)
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    permission_id = db.Column(db.Integer, db.ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False)
    role = db.relationship("Role", back_populates="role_permissions")
    permission = db.relationship("Permission", back_populates="role_permissions")


class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    phone = db.Column(db.String(40), default="")
    avatar_url = db.Column(db.String(255), default="")
    organization_name = db.Column(db.String(120), default="")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    role = db.relationship("Role", back_populates="users")
    sessions = db.relationship("UserSession", back_populates="user", cascade="all, delete-orphan")
    organized_events = db.relationship("Event", back_populates="organizer", foreign_keys="Event.organizer_id")


class UserSession(db.Model):
    __tablename__ = "user_sessions"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = db.Column(db.String(128), unique=True, nullable=False)
    ip_address = db.Column(db.String(64), default="")
    user_agent = db.Column(db.String(255), default="")
    expires_at = db.Column(db.DateTime, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    user = db.relationship("User", back_populates="sessions")


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    action = db.Column(db.String(64), nullable=False)
    entity_table = db.Column(db.String(64), nullable=False)
    entity_id = db.Column(db.Integer)
    details = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ============================================================================
# DOMAIN B: VENUES, GATES & 40 EVENT TEMPLATES (7 MODELS)
# ============================================================================

class EventCategory(db.Model):
    __tablename__ = "event_categories"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    slug = db.Column(db.String(60), unique=True, nullable=False)
    icon_name = db.Column(db.String(40), nullable=False, default="Calendar")
    description = db.Column(db.Text, default="")
    templates = db.relationship("EventTemplate", back_populates="category")


class EventTemplate(db.Model):
    __tablename__ = "event_templates"
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(140), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey("event_categories.id", ondelete="RESTRICT"), nullable=False)
    description = db.Column(db.Text, nullable=False)
    default_duration_hours = db.Column(db.Integer, nullable=False, default=8)
    default_capacity = db.Column(db.Integer, nullable=False, default=250)
    suggested_ticket_price_cents = db.Column(db.Integer, nullable=False, default=4500)
    layout_style = db.Column(db.String(80), nullable=False, default="Conference Stage")
    color_accent = db.Column(db.String(16), nullable=False, default="#2563EB")
    checklist_json = db.Column(db.Text, nullable=False, default="[]")
    default_tiers_json = db.Column(db.Text, nullable=False, default="[]")
    default_schedule_json = db.Column(db.Text, nullable=False, default="[]")
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    category = db.relationship("EventCategory", back_populates="templates")


class Venue(db.Model):
    __tablename__ = "venues"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    address = db.Column(db.String(200), nullable=False)
    city = db.Column(db.String(80), nullable=False)
    country = db.Column(db.String(80), nullable=False, default="United States")
    total_capacity = db.Column(db.Integer, nullable=False)
    venue_type = db.Column(db.String(60), nullable=False, default="Convention Center")
    timezone = db.Column(db.String(60), nullable=False, default="America/Los_Angeles")
    contact_email = db.Column(db.String(120), default="")
    zones = db.relationship("VenueZone", back_populates="venue", cascade="all, delete-orphan")
    gates = db.relationship("EntryGate", back_populates="venue", cascade="all, delete-orphan")


class VenueZone(db.Model):
    __tablename__ = "venue_zones"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    zone_code = db.Column(db.String(30), nullable=False)
    capacity = db.Column(db.Integer, nullable=False)
    floor_level = db.Column(db.String(40), nullable=False, default="Level 1")
    is_vip = db.Column(db.Boolean, default=False, nullable=False)
    venue = db.relationship("Venue", back_populates="zones")
    seats = db.relationship("VenueSeat", back_populates="zone", cascade="all, delete-orphan")


class VenueSeat(db.Model):
    __tablename__ = "venue_seats"
    id = db.Column(db.Integer, primary_key=True)
    zone_id = db.Column(db.Integer, db.ForeignKey("venue_zones.id", ondelete="CASCADE"), nullable=False)
    row_label = db.Column(db.String(10), nullable=False)
    seat_number = db.Column(db.String(10), nullable=False)
    seat_type = db.Column(db.String(30), nullable=False, default="Standard")
    is_accessible = db.Column(db.Boolean, default=False, nullable=False)
    zone = db.relationship("VenueZone", back_populates="seats")


class EntryGate(db.Model):
    __tablename__ = "entry_gates"
    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id", ondelete="CASCADE"), nullable=False)
    gate_name = db.Column(db.String(100), nullable=False)
    gate_code = db.Column(db.String(40), unique=True, nullable=False)
    gate_type = db.Column(db.String(40), nullable=False, default="General Entry")
    assigned_staff_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    is_open = db.Column(db.Boolean, default=True, nullable=False)
    venue = db.relationship("Venue", back_populates="gates")
    scanners = db.relationship("ScannerDevice", back_populates="gate", cascade="all, delete-orphan")


class ScannerDevice(db.Model):
    __tablename__ = "scanner_devices"
    id = db.Column(db.Integer, primary_key=True)
    gate_id = db.Column(db.Integer, db.ForeignKey("entry_gates.id", ondelete="CASCADE"), nullable=False)
    device_name = db.Column(db.String(100), nullable=False)
    device_serial = db.Column(db.String(60), unique=True, nullable=False)
    status = db.Column(db.String(30), nullable=False, default="online")
    last_heartbeat_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    gate = db.relationship("EntryGate", back_populates="scanners")


# ============================================================================
# DOMAIN C: EVENTS, SCHEDULES & SPEAKERS (7 MODELS)
# ============================================================================

class Event(db.Model):
    __tablename__ = "events"
    id = db.Column(db.Integer, primary_key=True)
    organizer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey("event_templates.id", ondelete="SET NULL"))
    category_id = db.Column(db.Integer, db.ForeignKey("event_categories.id", ondelete="RESTRICT"), nullable=False)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id", ondelete="RESTRICT"), nullable=False)
    title = db.Column(db.String(160), nullable=False)
    slug = db.Column(db.String(160), unique=True, nullable=False)
    summary = db.Column(db.Text, nullable=False)
    description = db.Column(db.Text, nullable=False)
    banner_url = db.Column(db.String(255), nullable=False)
    start_at = db.Column(db.DateTime, nullable=False)
    end_at = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="published")
    capacity = db.Column(db.Integer, nullable=False)
    is_featured = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    organizer = db.relationship("User", back_populates="organized_events", foreign_keys=[organizer_id])
    sessions = db.relationship("EventSession", back_populates="event", cascade="all, delete-orphan")
    ticket_tiers = db.relationship("TicketTier", back_populates="event", cascade="all, delete-orphan")


class EventSession(db.Model):
    __tablename__ = "event_sessions"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    zone_id = db.Column(db.Integer, db.ForeignKey("venue_zones.id", ondelete="SET NULL"))
    title = db.Column(db.String(160), nullable=False)
    track_name = db.Column(db.String(80), nullable=False, default="Main Stage")
    start_at = db.Column(db.DateTime, nullable=False)
    end_at = db.Column(db.DateTime, nullable=False)
    capacity = db.Column(db.Integer, nullable=False, default=100)
    description = db.Column(db.Text, default="")
    event = db.relationship("Event", back_populates="sessions")


class Speaker(db.Model):
    __tablename__ = "speakers"
    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(120), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    company = db.Column(db.String(120), nullable=False)
    bio = db.Column(db.Text, default="")
    email = db.Column(db.String(160), unique=True, nullable=False)
    photo_url = db.Column(db.String(255), default="")


class SessionSpeaker(db.Model):
    __tablename__ = "session_speakers"
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("event_sessions.id", ondelete="CASCADE"), nullable=False)
    speaker_id = db.Column(db.Integer, db.ForeignKey("speakers.id", ondelete="CASCADE"), nullable=False)
    role_label = db.Column(db.String(60), nullable=False, default="Keynote Speaker")


class Sponsor(db.Model):
    __tablename__ = "sponsors"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), unique=True, nullable=False)
    website = db.Column(db.String(200), default="")
    tier_default = db.Column(db.String(40), nullable=False, default="Gold")
    contact_email = db.Column(db.String(160), default="")
    logo_text = db.Column(db.String(40), default="")


class EventSponsor(db.Model):
    __tablename__ = "event_sponsors"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    sponsor_id = db.Column(db.Integer, db.ForeignKey("sponsors.id", ondelete="CASCADE"), nullable=False)
    sponsorship_tier = db.Column(db.String(40), nullable=False, default="Gold")
    contribution_cents = db.Column(db.Integer, nullable=False, default=500000)


class EventTask(db.Model):
    __tablename__ = "event_tasks"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    assigned_to = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    title = db.Column(db.String(200), nullable=False)
    priority = db.Column(db.String(20), nullable=False, default="medium")
    status = db.Column(db.String(20), nullable=False, default="pending")
    due_date = db.Column(db.DateTime, nullable=False)


# ============================================================================
# DOMAIN D: TICKETING, PRICING & ORDERS (8 MODELS)
# ============================================================================

class TicketTier(db.Model):
    __tablename__ = "ticket_tiers"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    zone_id = db.Column(db.Integer, db.ForeignKey("venue_zones.id", ondelete="SET NULL"))
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text, default="")
    price_cents = db.Column(db.Integer, nullable=False)
    quantity_total = db.Column(db.Integer, nullable=False)
    quantity_sold = db.Column(db.Integer, nullable=False, default=0)
    max_per_order = db.Column(db.Integer, nullable=False, default=10)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    event = db.relationship("Event", back_populates="ticket_tiers")


class PromoCode(db.Model):
    __tablename__ = "promo_codes"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"))
    code = db.Column(db.String(40), unique=True, nullable=False)
    discount_type = db.Column(db.String(20), nullable=False)
    discount_value = db.Column(db.Integer, nullable=False)
    max_uses = db.Column(db.Integer, nullable=False, default=100)
    current_uses = db.Column(db.Integer, nullable=False, default=0)
    valid_until = db.Column(db.DateTime, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)


class TaxRate(db.Model):
    __tablename__ = "tax_rates"
    id = db.Column(db.Integer, primary_key=True)
    region_code = db.Column(db.String(20), unique=True, nullable=False)
    tax_name = db.Column(db.String(80), nullable=False)
    rate_percent = db.Column(db.Float, nullable=False)
    is_inclusive = db.Column(db.Boolean, default=False, nullable=False)


class Order(db.Model):
    __tablename__ = "orders"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="RESTRICT"), nullable=False)
    promo_code_id = db.Column(db.Integer, db.ForeignKey("promo_codes.id", ondelete="SET NULL"))
    tax_rate_id = db.Column(db.Integer, db.ForeignKey("tax_rates.id", ondelete="SET NULL"))
    order_number = db.Column(db.String(40), unique=True, nullable=False)
    subtotal_cents = db.Column(db.Integer, nullable=False)
    discount_cents = db.Column(db.Integer, nullable=False, default=0)
    tax_cents = db.Column(db.Integer, nullable=False, default=0)
    total_cents = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="paid")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class OrderItem(db.Model):
    __tablename__ = "order_items"
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    ticket_tier_id = db.Column(db.Integer, db.ForeignKey("ticket_tiers.id", ondelete="RESTRICT"), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    unit_price_cents = db.Column(db.Integer, nullable=False)
    line_total_cents = db.Column(db.Integer, nullable=False)


class Payment(db.Model):
    __tablename__ = "payments"
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    payment_method = db.Column(db.String(30), nullable=False, default="card")
    transaction_ref = db.Column(db.String(60), unique=True, nullable=False)
    amount_cents = db.Column(db.Integer, nullable=False)
    currency = db.Column(db.String(10), nullable=False, default="USD")
    status = db.Column(db.String(20), nullable=False, default="succeeded")
    paid_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Refund(db.Model):
    __tablename__ = "refunds"
    id = db.Column(db.Integer, primary_key=True)
    payment_id = db.Column(db.Integer, db.ForeignKey("payments.id", ondelete="CASCADE"), nullable=False)
    processed_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    amount_cents = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="completed")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class Ticket(db.Model):
    __tablename__ = "tickets"
    id = db.Column(db.Integer, primary_key=True)
    order_item_id = db.Column(db.Integer, db.ForeignKey("order_items.id", ondelete="CASCADE"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    ticket_tier_id = db.Column(db.Integer, db.ForeignKey("ticket_tiers.id", ondelete="RESTRICT"), nullable=False)
    attendee_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    seat_id = db.Column(db.Integer, db.ForeignKey("venue_seats.id", ondelete="SET NULL"))
    ticket_code = db.Column(db.String(40), unique=True, nullable=False)
    qr_signature = db.Column(db.String(128), nullable=False)
    holder_name = db.Column(db.String(120), nullable=False)
    holder_email = db.Column(db.String(160), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="valid")
    checked_in_at = db.Column(db.DateTime)


# ============================================================================
# DOMAIN E: TICKET SCANNING & REAL-TIME ATTENDANCE (5 MODELS)
# ============================================================================

class TicketScan(db.Model):
    __tablename__ = "ticket_scans"
    id = db.Column(db.Integer, primary_key=True)
    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id", ondelete="SET NULL"))
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    gate_id = db.Column(db.Integer, db.ForeignKey("entry_gates.id", ondelete="RESTRICT"), nullable=False)
    scanner_device_id = db.Column(db.Integer, db.ForeignKey("scanner_devices.id", ondelete="SET NULL"))
    scanned_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    scan_result = db.Column(db.String(30), nullable=False)
    rejection_reason = db.Column(db.Text, default="")
    scanned_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class AttendanceLog(db.Model):
    __tablename__ = "attendance_logs"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    zone_id = db.Column(db.Integer, db.ForeignKey("venue_zones.id", ondelete="SET NULL"))
    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    direction = db.Column(db.String(10), nullable=False)
    recorded_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    recorded_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class SessionCheckin(db.Model):
    __tablename__ = "session_checkins"
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey("event_sessions.id", ondelete="CASCADE"), nullable=False)
    ticket_id = db.Column(db.Integer, db.ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    checked_in_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    checked_in_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class GateShift(db.Model):
    __tablename__ = "gate_shifts"
    id = db.Column(db.Integer, primary_key=True)
    gate_id = db.Column(db.Integer, db.ForeignKey("entry_gates.id", ondelete="CASCADE"), nullable=False)
    staff_user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    shift_start = db.Column(db.DateTime, nullable=False)
    shift_end = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="active")


class CapacitySnapshot(db.Model):
    __tablename__ = "capacity_snapshots"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    current_occupancy = db.Column(db.Integer, nullable=False, default=0)
    peak_occupancy = db.Column(db.Integer, nullable=False, default=0)
    total_scans_valid = db.Column(db.Integer, nullable=False, default=0)
    total_scans_rejected = db.Column(db.Integer, nullable=False, default=0)
    captured_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ============================================================================
# DOMAIN F: MARKETING, NOTIFICATIONS & ENGAGEMENT (5 MODELS)
# ============================================================================

class WaitlistEntry(db.Model):
    __tablename__ = "waitlist_entries"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    ticket_tier_id = db.Column(db.Integer, db.ForeignKey("ticket_tiers.id", ondelete="SET NULL"))
    email = db.Column(db.String(160), nullable=False)
    full_name = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="waiting")
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class EmailCampaign(db.Model):
    __tablename__ = "email_campaigns"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    subject = db.Column(db.String(200), nullable=False)
    segment = db.Column(db.String(80), nullable=False, default="All Ticket Holders")
    sent_count = db.Column(db.Integer, nullable=False, default=0)
    open_rate_percent = db.Column(db.Float, nullable=False, default=0.0)
    status = db.Column(db.String(20), nullable=False, default="sent")


class Notification(db.Model):
    __tablename__ = "notifications"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"))
    title = db.Column(db.String(140), nullable=False)
    message = db.Column(db.Text, nullable=False)
    channel = db.Column(db.String(20), nullable=False, default="in_app")
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class EventReview(db.Model):
    __tablename__ = "event_reviews"
    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating = db.Column(db.Integer, nullable=False)
    comment = db.Column(db.Text, nullable=False)
    is_verified_attendee = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class SavedEvent(db.Model):
    __tablename__ = "saved_events"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


# ============================================================================
# DOMAIN G: REPORTING, FINANCE & COMPLIANCE (4 MODELS)
# ============================================================================

class OrganizerPayout(db.Model):
    __tablename__ = "organizer_payouts"
    id = db.Column(db.Integer, primary_key=True)
    organizer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    gross_cents = db.Column(db.Integer, nullable=False)
    platform_fee_cents = db.Column(db.Integer, nullable=False)
    net_payout_cents = db.Column(db.Integer, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="scheduled")
    scheduled_date = db.Column(db.DateTime, nullable=False)
    paid_at = db.Column(db.DateTime)


class SavedReport(db.Model):
    __tablename__ = "saved_reports"
    id = db.Column(db.Integer, primary_key=True)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="SET NULL"))
    report_type = db.Column(db.String(50), nullable=False)
    title = db.Column(db.String(160), nullable=False)
    filters_json = db.Column(db.Text, nullable=False, default="{}")
    last_generated_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class ReportExport(db.Model):
    __tablename__ = "report_exports"
    id = db.Column(db.Integer, primary_key=True)
    saved_report_id = db.Column(db.Integer, db.ForeignKey("saved_reports.id", ondelete="CASCADE"), nullable=False)
    exported_by = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    format = db.Column(db.String(10), nullable=False, default="csv")
    row_count = db.Column(db.Integer, nullable=False, default=0)
    file_name = db.Column(db.String(160), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)


class WebhookEndpoint(db.Model):
    __tablename__ = "webhook_endpoints"
    id = db.Column(db.Integer, primary_key=True)
    organizer_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_id = db.Column(db.Integer, db.ForeignKey("events.id", ondelete="CASCADE"))
    target_url = db.Column(db.String(255), nullable=False)
    event_types = db.Column(db.String(200), nullable=False, default="ticket.purchased,ticket.scanned")
    is_active = db.Column(db.Boolean, default=True, nullable=False)

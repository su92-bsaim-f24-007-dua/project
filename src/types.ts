export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role_id: number;
  role_slug: 'admin' | 'organizer' | 'finance' | 'gate_staff' | 'attendee' | string;
  role_name: string;
  role_level: number;
  organization_name: string;
  avatar_url: string;
  permissions: string[];
}

export interface CategoryItem {
  id: number;
  name: string;
  slug: string;
  icon_name: string;
  description: string;
}

export interface VenueItem {
  id: number;
  name: string;
  address: string;
  city: string;
  country: string;
  total_capacity: number;
  venue_type: string;
  timezone: string;
  zone_count: number;
  gate_count: number;
}

export interface EventTemplateItem {
  id: number;
  code: string;
  name: string;
  category_id: number;
  category_name: string;
  category_slug: string;
  description: string;
  default_duration_hours: number;
  default_capacity: number;
  suggested_ticket_price_cents: number;
  layout_style: string;
  color_accent: string;
  checklist_json: string;
  default_tiers_json: string;
  default_schedule_json: string;
  events_created: number;
}

export interface EventSummary {
  id: number;
  organizer_id: number;
  template_id: number | null;
  category_id: number;
  category_name: string;
  category_slug: string;
  venue_id: number;
  venue_name: string;
  venue_city: string;
  organizer_name: string;
  organization_name: string;
  template_code: string | null;
  template_name: string | null;
  title: string;
  slug: string;
  summary: string;
  description: string;
  banner_url: string;
  start_at: string;
  end_at: string;
  status: 'draft' | 'published' | 'live' | 'completed' | 'cancelled';
  capacity: number;
  is_featured: number;
  min_price_cents: number;
  tickets_sold: number;
  total_allocation: number;
  checked_in_count: number;
}

export interface TicketTier {
  id: number;
  event_id: number;
  zone_id: number | null;
  zone_name?: string;
  name: string;
  description: string;
  price_cents: number;
  quantity_total: number;
  quantity_sold: number;
  max_per_order: number;
  is_active: number;
}

export interface UserTicket {
  id: number;
  event_id: number;
  ticket_code: string;
  qr_signature: string;
  holder_name: string;
  holder_email: string;
  status: 'valid' | 'checked_in' | 'cancelled' | 'refunded';
  checked_in_at: string | null;
  created_at: string;
  event_title: string;
  start_at: string;
  end_at: string;
  banner_url: string;
  venue_name: string;
  venue_city: string;
  tier_name: string;
  price_cents: number;
  order_number: string;
}

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
  rowCount: number;
  columns: ColumnMeta[];
}

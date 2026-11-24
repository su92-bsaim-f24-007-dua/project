import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarPlus,
  Database,
  Download,
  LayoutDashboard,
  Layers,
  Menu,
  Moon,
  RotateCcw,
  ScanLine,
  Shield,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { apiRequest, formatCurrency, formatDateTime } from '../lib/api';
import type { AuthUser, CategoryItem, EventSummary, EventTemplateItem, VenueItem } from '../types';
import { SchemaExplorerView } from './SchemaExplorerView';
import { TemplatesView } from './TemplatesView';

interface OrganizerDashboardProps {
  user: AuthUser | null;
  events: EventSummary[];
  templates: EventTemplateItem[];
  categories: CategoryItem[];
  venues: VenueItem[];
  darkMode: boolean;
  onToggleDark: () => void;
  onRefreshAll: () => Promise<void>;
  onRequireAuth: (role?: string) => void;
  onOpenScanner: () => void;
  onFlash: (msg: string) => void;
  initialTemplateForCreate?: EventTemplateItem | null;
  onClearInitialTemplate?: () => void;
}

type DashTab = 'overview' | 'reports' | 'roles' | 'templates' | 'schema';
type ReportSubTab = 'sales' | 'attendance' | 'templates' | 'finance' | 'audit';

interface ReportOverviewPayload {
  salesByEvent: Array<Record<string, unknown>>;
  attendanceByEvent: Array<Record<string, unknown>>;
  templatePerformance: Array<Record<string, unknown>>;
  payouts: Array<Record<string, unknown>>;
  recentOrders: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  auditLogs: Array<Record<string, unknown>>;
  exportHistory: Array<Record<string, unknown>>;
}

export const OrganizerDashboard: React.FC<OrganizerDashboardProps> = ({
  user,
  events,
  templates,
  categories,
  venues,
  darkMode,
  onToggleDark,
  onRefreshAll,
  onRequireAuth,
  onOpenScanner,
  onFlash,
  initialTemplateForCreate,
  onClearInitialTemplate,
}) => {
  const [tab, setTab] = useState<DashTab>('overview');
  const [reportSubTab, setReportSubTab] = useState<ReportSubTab>('sales');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [reports, setReports] = useState<ReportOverviewPayload | null>(null);
  const [rolesList, setRolesList] = useState<Array<Record<string, unknown>>>([]);
  const [usersList, setUsersList] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);

  // Create Event Modal state
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [evTemplateId, setEvTemplateId] = useState<string>('');
  const [evTitle, setEvTitle] = useState('');
  const [evSummary, setEvSummary] = useState('');
  const [evCategoryId, setEvCategoryId] = useState<number>(categories[0]?.id ?? 1);
  const [evVenueId, setEvVenueId] = useState<number>(venues[0]?.id ?? 1);
  const [evCapacity, setEvCapacity] = useState<number>(300);
  const [evStart, setEvStart] = useState('2026-12-20T09:00');
  const [evEnd, setEvEnd] = useState('2026-12-20T17:00');
  const [evStatus, setEvStatus] = useState<'published' | 'draft' | 'live'>('published');
  const [evBanner, setEvBanner] = useState('/src/assets/images/hero_summit_stage_1795541473829.jpg');
  const [creatingEv, setCreatingEv] = useState(false);

  const hasDashAccess = Boolean(user && ['admin', 'organizer', 'finance', 'gate_staff'].includes(user.role_slug));

  const applyTemplateSelection = useCallback(
    (tpl: EventTemplateItem | null) => {
      if (!tpl) {
        setEvTemplateId('');
        return;
      }
      setEvTemplateId(String(tpl.id));
      setEvTitle(`${tpl.name} 2026`);
      setEvSummary(tpl.description);
      setEvCategoryId(tpl.category_id);
      setEvCapacity(tpl.default_capacity);
      const start = new Date('2026-12-22T09:00:00');
      const end = new Date(start.getTime() + tpl.default_duration_hours * 3600000);
      setEvStart(start.toISOString().slice(0, 16));
      setEvEnd(end.toISOString().slice(0, 16));
    },
    []
  );

  useEffect(() => {
    if (initialTemplateForCreate) {
      applyTemplateSelection(initialTemplateForCreate);
      setShowCreateEvent(true);
      onClearInitialTemplate?.();
    }
  }, [initialTemplateForCreate, applyTemplateSelection, onClearInitialTemplate]);

  const loadDashboardData = useCallback(async () => {
    if (!hasDashAccess) return;
    setError(null);
    try {
      const [repRes, roleRes] = await Promise.all([
        apiRequest<ReportOverviewPayload>('/api/reports/overview'),
        apiRequest<{ roles: Array<Record<string, unknown>> }>('/api/roles'),
      ]);
      setReports(repRes);
      setRolesList(roleRes.roles);

      if (user && ['admin', 'organizer'].includes(user.role_slug)) {
        const usersRes = await apiRequest<{ users: Array<Record<string, unknown>> }>('/api/auth/users');
        setUsersList(usersRes.users);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard reports.');
    }
  }, [hasDashAccess, user]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreatingEv(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/events', {
        method: 'POST',
        body: JSON.stringify({
          title: evTitle,
          summary: evSummary,
          templateId: evTemplateId ? Number(evTemplateId) : null,
          categoryId: evCategoryId,
          venueId: evVenueId,
          capacity: evCapacity,
          startAt: new Date(evStart).toISOString(),
          endAt: new Date(evEnd).toISOString(),
          status: evStatus,
          bannerUrl: evBanner,
        }),
      });
      setShowCreateEvent(false);
      onFlash(res.message);
      await onRefreshAll();
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Event creation failed.');
    } finally {
      setCreatingEv(false);
    }
  }

  async function handleStatusChange(eventId: number, status: string) {
    try {
      await apiRequest(`/api/events/${eventId}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      onFlash(`Event status updated to ${status}.`);
      await onRefreshAll();
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    }
  }

  async function handleDeleteEvent(eventId: number) {
    try {
      const res = await apiRequest<{ message: string }>(`/api/events/${eventId}`, { method: 'DELETE' });
      onFlash(res.message);
      await onRefreshAll();
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  async function handleExportReport(reportType: string, format: 'csv' | 'json') {
    try {
      const res = await apiRequest<{ fileName: string; content: string; rowCount: number }>('/api/reports/export', {
        method: 'POST',
        body: JSON.stringify({ reportType, format }),
      });
      const blob = new Blob([res.content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onFlash(`Exported ${res.fileName} (${res.rowCount} rows).`);
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  }

  async function handleRefundOrder(orderId: number) {
    try {
      const res = await apiRequest<{ message: string }>(`/api/orders/${orderId}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Processed via Finance Reconciliation Console' }),
      });
      onFlash(res.message);
      await loadDashboardData();
      await onRefreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed.');
    }
  }

  async function handleUpdateUserRole(targetUserId: number, roleSlug: string, isActive: number) {
    try {
      const res = await apiRequest<{ message: string }>(`/api/auth/users/${targetUserId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ roleSlug, isActive }),
      });
      onFlash(res.message);
      await loadDashboardData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed.');
    }
  }

  if (!hasDashAccess) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <LayoutDashboard className="mx-auto h-9 w-9 text-blue-600" />
        <h2 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
          Organizer &amp; Enterprise Operations Hub
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Create an account as an <strong>Event Organizer</strong>, <strong>Finance Analyst</strong>, <strong>Gate Staff</strong>, or claim{' '}
          <strong>Administrator</strong> access to manage events, 40 templates, reporting modules, and the 42-table database.
        </p>
        <button
          type="button"
          onClick={() => onRequireAuth('organizer')}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Open Organizer Account
        </button>
      </div>
    );
  }

  const totalRevenueCents = (reports?.salesByEvent ?? []).reduce((s, r) => s + Number(r.net_collected_cents || 0), 0);
  const totalTicketsSold = events.reduce((s, e) => s + Number(e.tickets_sold || 0), 0);
  const totalCheckedIn = events.reduce((s, e) => s + Number(e.checked_in_count || 0), 0);

  const navItems: Array<{ id: DashTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Events & Operations', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'templates', label: '40 Event Templates', icon: <Layers className="h-4 w-4" /> },
    { id: 'reports', label: 'Reporting Modules', icon: <BarChart3 className="h-4 w-4" /> },
    { id: 'roles', label: 'Users & RBAC Roles', icon: <Shield className="h-4 w-4" /> },
    { id: 'schema', label: '42-Table Schema', icon: <Database className="h-4 w-4" /> },
  ];

  const breadcrumbLabel = navItems.find((i) => i.id === tab)?.label ?? 'Overview';

  return (
    <div className="flex min-h-[760px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:flex-row dark:border-slate-800 dark:bg-slate-900">
      {/* Desktop 240px Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-slate-200 bg-slate-50/70 p-4 lg:flex dark:border-slate-800 dark:bg-slate-950/60">
        <div className="space-y-6">
          <div>
            <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Workspace</p>
            <nav className="mt-2 space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                    tab === item.id
                      ? 'bg-white text-blue-700 shadow-xs dark:bg-slate-900 dark:text-blue-400'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={onOpenScanner}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-100"
              >
                <ScanLine className="h-4 w-4" />
                <span>Gate Scanner Console</span>
              </button>
            </nav>
          </div>
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="px-2">
            <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">{user?.full_name}</p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user?.role_name}</p>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <span>{darkMode ? 'Dark Surface' : 'Light Surface'}</span>
            {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </aside>

      {/* Mobile Slide-Over Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-10 flex w-64 flex-col justify-between bg-white p-4 dark:bg-slate-900">
            <div>
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <span className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Organizer Menu</span>
                <button type="button" onClick={() => setMobileMenuOpen(false)} className="rounded p-1 text-slate-500">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="mt-4 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium ${
                      tab === item.id
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
            </div>
            <button
              type="button"
              onClick={onToggleDark}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300"
            >
              <span>{darkMode ? 'Dark Surface' : 'Light Surface'}</span>
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 p-5 sm:p-7">
        {/* Top Breadcrumb Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden dark:border-slate-800 dark:text-slate-300"
              aria-label="Open workspace menu"
            >
              <Menu className="h-4 w-4" />
            </button>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              <span>Organizer Hub</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{breadcrumbLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {['admin', 'organizer'].includes(user?.role_slug || '') && (
              <button
                type="button"
                onClick={() => {
                  setEvCategoryId(categories[0]?.id ?? 1);
                  setEvVenueId(venues[0]?.id ?? 1);
                  setShowCreateEvent(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <CalendarPlus className="h-4 w-4" />
                Create Event
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* TAB 1: OVERVIEW & EVENTS */}
        {tab === 'overview' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Scheduled Events</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {events.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">Across {venues.length} active venues</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Net Ticket Revenue</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatCurrency(totalRevenueCents)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Tax &amp; promo adjusted</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Tickets Issued</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {totalTicketsSold}
                </p>
                <p className="mt-1 text-xs text-slate-500">HMAC-SHA256 QR signed</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Verified Check-Ins</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                  {totalCheckedIn}
                </p>
                <p className="mt-1 text-xs text-slate-500">40 templates · 42 DB tables</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Event Portfolio</h3>
                <span className="font-mono text-xs text-slate-500 tabular-nums">{events.length} events</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Event &amp; Venue</th>
                      <th className="px-4 py-3 font-medium">Template</th>
                      <th className="px-4 py-3 font-medium">Start Date</th>
                      <th className="px-4 py-3 text-right font-medium">Sold / Cap</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      {['admin', 'organizer'].includes(user?.role_slug || '') && (
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {events.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{ev.title}</p>
                          <p className="text-slate-500 dark:text-slate-400">
                            {ev.venue_name} · {ev.venue_city}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                          {ev.template_code || 'Custom'}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600 tabular-nums dark:text-slate-300">
                          {formatDateTime(ev.start_at)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {ev.tickets_sold} / {ev.capacity}
                        </td>
                        <td className="px-4 py-3">
                          {['admin', 'organizer'].includes(user?.role_slug || '') ? (
                            <select
                              value={ev.status}
                              onChange={(e) => handleStatusChange(ev.id, e.target.value)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                            >
                              <option value="draft">Draft</option>
                              <option value="published">Published</option>
                              <option value="live">Live</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          ) : (
                            <span className="uppercase font-medium text-slate-700 dark:text-slate-300">{ev.status}</span>
                          )}
                        </td>
                        {['admin', 'organizer'].includes(user?.role_slug || '') && (
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteEvent(ev.id)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                              title="Delete or cancel event"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: 5 REPORTING MODULES */}
        {tab === 'reports' && reports && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                {(
                  [
                    ['sales', 'Sales & Revenue'],
                    ['attendance', 'Attendance & Gates'],
                    ['templates', 'Template Matrix'],
                    ['finance', 'Payouts & Refunds'],
                    ['audit', 'Security & Audit'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReportSubTab(id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      reportSubTab === id
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleExportReport(
                      reportSubTab === 'sales'
                        ? 'sales_revenue'
                        : reportSubTab === 'attendance'
                          ? 'attendance_velocity'
                          : reportSubTab === 'templates'
                            ? 'template_performance'
                            : reportSubTab === 'finance'
                              ? 'financial_payouts'
                              : 'security_audit',
                      'csv'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleExportReport(
                      reportSubTab === 'sales'
                        ? 'sales_revenue'
                        : reportSubTab === 'attendance'
                          ? 'attendance_velocity'
                          : reportSubTab === 'templates'
                            ? 'template_performance'
                            : reportSubTab === 'finance'
                              ? 'financial_payouts'
                              : 'security_audit',
                      'json'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export JSON
                </button>
              </div>
            </div>

            {reportSubTab === 'sales' && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 text-right font-medium">Orders</th>
                      <th className="px-4 py-3 text-right font-medium">Sold</th>
                      <th className="px-4 py-3 text-right font-medium">Gross</th>
                      <th className="px-4 py-3 text-right font-medium">Discounts</th>
                      <th className="px-4 py-3 text-right font-medium">Tax</th>
                      <th className="px-4 py-3 text-right font-medium">Net Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {reports.salesByEvent.map((row) => (
                      <tr key={Number(row.id)}>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{String(row.title)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.order_count)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.tickets_sold)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(Number(row.gross_cents))}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-600">
                          -{formatCurrency(Number(row.discount_cents))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{formatCurrency(Number(row.tax_cents))}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                          {formatCurrency(Number(row.net_collected_cents))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportSubTab === 'attendance' && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Event</th>
                      <th className="px-4 py-3 text-right font-medium">Active Passes</th>
                      <th className="px-4 py-3 text-right font-medium">Checked In</th>
                      <th className="px-4 py-3 text-right font-medium">Check-In Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Valid Scans</th>
                      <th className="px-4 py-3 text-right font-medium">Blocked Scans</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {reports.attendanceByEvent.map((row) => {
                      const active = Number(row.active_tickets) || 0;
                      const checked = Number(row.checked_in) || 0;
                      const rate = active > 0 ? Math.round((checked / active) * 100) : 0;
                      return (
                        <tr key={Number(row.id)}>
                          <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{String(row.title)}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{active}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-600">{checked}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{rate}%</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.valid_scans)}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums text-red-600">{Number(row.rejected_scans)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {reportSubTab === 'templates' && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 text-right font-medium">Custom Templates</th>
                      <th className="px-4 py-3 text-right font-medium">Events Launched</th>
                      <th className="px-4 py-3 text-right font-medium">Avg Default Capacity</th>
                      <th className="px-4 py-3 text-right font-medium">Avg Suggested Price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {reports.templatePerformance.map((row, i) => (
                      <tr key={i}>
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{String(row.category_name)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.template_count)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.events_launched)}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">{Number(row.avg_capacity).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums">
                          {formatCurrency(Number(row.avg_price_cents))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {reportSubTab === 'finance' && (
              <div className="space-y-6">
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <h4 className="font-display text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                      Organizer Payouts Ledger
                    </h4>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Event</th>
                        <th className="px-4 py-2.5 text-right font-medium">Gross</th>
                        <th className="px-4 py-2.5 text-right font-medium">Platform Fee (5%)</th>
                        <th className="px-4 py-2.5 text-right font-medium">Net Payout</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reports.payouts.map((p) => (
                        <tr key={Number(p.id)}>
                          <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{String(p.event_title)}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(Number(p.gross_cents))}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(Number(p.platform_fee_cents))}</td>
                          <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums">{formatCurrency(Number(p.net_payout_cents))}</td>
                          <td className="px-4 py-2.5 uppercase font-mono text-slate-600 dark:text-slate-300">{String(p.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <h4 className="font-display text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                      Recent Orders &amp; Refunds
                    </h4>
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Order #</th>
                        <th className="px-4 py-2.5 font-medium">Buyer</th>
                        <th className="px-4 py-2.5 font-medium">Event</th>
                        <th className="px-4 py-2.5 text-right font-medium">Total</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        {['admin', 'finance', 'organizer'].includes(user?.role_slug || '') && (
                          <th className="px-4 py-2.5 text-right font-medium">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reports.recentOrders.map((ord) => (
                        <tr key={Number(ord.id)}>
                          <td className="px-4 py-2.5 font-mono font-semibold">{String(ord.order_number)}</td>
                          <td className="px-4 py-2.5">{String(ord.buyer_name)}</td>
                          <td className="px-4 py-2.5 truncate max-w-[200px]">{String(ord.event_title)}</td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">{formatCurrency(Number(ord.total_cents))}</td>
                          <td className="px-4 py-2.5 font-mono uppercase">{String(ord.status)}</td>
                          {['admin', 'finance', 'organizer'].includes(user?.role_slug || '') && (
                            <td className="px-4 py-2.5 text-right">
                              {ord.status === 'paid' && (
                                <button
                                  type="button"
                                  onClick={() => handleRefundOrder(Number(ord.id))}
                                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Refund
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportSubTab === 'audit' && (
              <div className="space-y-6">
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">Table</th>
                        <th className="px-4 py-3 font-medium">Actor</th>
                        <th className="px-4 py-3 font-medium">Details</th>
                        <th className="px-4 py-3 font-medium">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {reports.auditLogs.map((al) => (
                        <tr key={Number(al.id)}>
                          <td className="px-4 py-2.5 font-mono font-semibold text-blue-600 dark:text-blue-400">{String(al.action)}</td>
                          <td className="px-4 py-2.5 font-mono">{String(al.entity_table)}</td>
                          <td className="px-4 py-2.5">{al.actor_name ? String(al.actor_name) : 'System'}</td>
                          <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{String(al.details)}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-500 tabular-nums">{formatDateTime(String(al.created_at))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: USERS & RBAC ROLES */}
        {tab === 'roles' && (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rolesList.map((role) => (
                <div key={Number(role.id)} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">{String(role.name)}</h4>
                    <span className="font-mono text-xs text-slate-500 tabular-nums">L{Number(role.level)}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{String(role.description)}</p>
                  <p className="mt-3 font-mono text-xs text-slate-500 tabular-nums">
                    {Number(role.permission_count)} permissions · {Number(role.user_count)} users
                  </p>
                </div>
              ))}
            </div>

            {usersList.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                  <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">User Accounts &amp; Role Assignments</h4>
                </div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Email</th>
                      <th className="px-4 py-2.5 font-medium">Organization</th>
                      <th className="px-4 py-2.5 font-medium">Assigned Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {usersList.map((u) => (
                      <tr key={Number(u.id)}>
                        <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">{String(u.full_name)}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400">{String(u.email)}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{String(u.organization_name || '—')}</td>
                        <td className="px-4 py-2.5">
                          {user?.role_slug === 'admin' ? (
                            <select
                              value={String(u.role_slug)}
                              onChange={(e) => handleUpdateUserRole(Number(u.id), e.target.value, Number(u.is_active))}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                            >
                              {rolesList.map((r) => (
                                <option key={String(r.slug)} value={String(r.slug)}>
                                  {String(r.name)}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span>{String(u.role_name)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: 40 TEMPLATES INSIDE DASHBOARD */}
        {tab === 'templates' && (
          <TemplatesView
            templates={templates}
            categories={categories}
            user={user}
            onUseTemplate={(tpl) => {
              applyTemplateSelection(tpl);
              setShowCreateEvent(true);
            }}
            onTemplateCreated={async (msg) => {
              onFlash(msg);
              await onRefreshAll();
            }}
            onRequireAuth={onRequireAuth}
          />
        )}

        {/* TAB 5: 42-TABLE SCHEMA EXPLORER */}
        {tab === 'schema' && <SchemaExplorerView user={user} onRequireAuth={onRequireAuth} onFlash={onFlash} />}
      </div>

      {/* Create Event Modal (from Scratch or 40 Templates) */}
      {showCreateEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">Launch New Event</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Optionally select any of the 40 custom event templates to auto-populate tiers, schedule tracks, and tasks.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateEvent(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEvent} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Event Blueprint Template (40 Available)
                </label>
                <select
                  value={evTemplateId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const found = templates.find((t) => String(t.id) === id) ?? null;
                    applyTemplateSelection(found);
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">Blank Custom Event (No Template)</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} — {t.name} ({t.category_name} · {t.default_capacity} cap)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Event Title</label>
                <input
                  type="text"
                  required
                  value={evTitle}
                  onChange={(e) => setEvTitle(e.target.value)}
                  placeholder="Global AI & Systems Summit 2026"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Summary</label>
                <textarea
                  rows={2}
                  required
                  value={evSummary}
                  onChange={(e) => setEvSummary(e.target.value)}
                  placeholder="Concise description of the event program and audience..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Category</label>
                  <select
                    value={evCategoryId}
                    onChange={(e) => setEvCategoryId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Venue</label>
                  <select
                    value={evVenueId}
                    onChange={(e) => setEvVenueId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.city})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Capacity</label>
                  <input
                    type="number"
                    min={10}
                    max={50000}
                    required
                    value={evCapacity}
                    onChange={(e) => setEvCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Start Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={evStart}
                    onChange={(e) => setEvStart(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">End Time</label>
                  <input
                    type="datetime-local"
                    required
                    value={evEnd}
                    onChange={(e) => setEvEnd(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Publish Status</label>
                  <select
                    value={evStatus}
                    onChange={(e) => setEvStatus(e.target.value as 'published' | 'draft' | 'live')}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="published">Published (Open for Tickets)</option>
                    <option value="live">Live (Gate Scanning Active)</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Cover Photography</label>
                <select
                  value={evBanner}
                  onChange={(e) => setEvBanner(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="/src/assets/images/hero_summit_stage_1795541473829.jpg">Architectural Keynote Auditorium</option>
                  <option value="/src/assets/images/event_music_festival_1795541473367.jpg">Twilight Amphitheater Concert</option>
                  <option value="/src/assets/images/event_design_workshop_1795541473705.jpg">Sunlit Design Studio Workshop</option>
                  <option value="/src/assets/images/event_gala_dinner_1795541474151.jpg">Museum Atrium Evening Gala</option>
                </select>
              </div>

              <div className="flex justify-end gap-2.5 border-t border-slate-200 pt-4 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateEvent(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingEv}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingEv ? 'Provisioning Event...' : 'Publish Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

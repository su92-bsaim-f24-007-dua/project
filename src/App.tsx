import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle2, LogOut, Moon, Search, Sun, Ticket, X } from 'lucide-react';
import { apiRequest, formatCurrency, formatDateTime, setAuthToken } from './lib/api';
import type { AuthUser, CategoryItem, EventSummary, EventTemplateItem, VenueItem } from './types';
import { AuthModal } from './components/AuthModal';
import { EventDetailModal } from './components/EventDetailModal';
import { MyPassesView } from './components/MyPassesView';
import { TemplatesView } from './components/TemplatesView';
import { ScannerView } from './components/ScannerView';
import { OrganizerDashboard } from './components/OrganizerDashboard';
import { SchemaExplorerView } from './components/SchemaExplorerView';

type ActivePage = 'discover' | 'templates' | 'scanner' | 'dashboard' | 'schema' | 'passes';

export default function App() {
  const [page, setPage] = useState<ActivePage>('discover');
  const [darkMode, setDarkMode] = useState(false);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [templates, setTemplates] = useState<EventTemplateItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [venues, setVenues] = useState<VenueItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Catalog filters
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & cross-view handoffs
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authSuggestedRole, setAuthSuggestedRole] = useState('organizer');
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [templateToLaunch, setTemplateToLaunch] = useState<EventTemplateItem | null>(null);
  const [scannerPrefill, setScannerPrefill] = useState<{ payload: string; eventId: number } | null>(null);
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const showFlash = useCallback((msg: string) => {
    setFlashMessage(msg);
    setTimeout(() => {
      setFlashMessage((curr) => (curr === msg ? null : curr));
    }, 4500);
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      const [meRes, evRes, tplRes, catRes, venRes] = await Promise.all([
        apiRequest<{ user: AuthUser | null }>('/api/auth/me'),
        apiRequest<{ events: EventSummary[] }>('/api/events'),
        apiRequest<{ templates: EventTemplateItem[] }>('/api/templates'),
        apiRequest<{ categories: CategoryItem[] }>('/api/categories'),
        apiRequest<{ venues: VenueItem[] }>('/api/venues'),
      ]);
      setUser(meRes.user);
      setEvents(evRes.events);
      setTemplates(tplRes.templates);
      setCategories(catRes.categories);
      setVenues(venRes.venues);
    } catch {
      // keep existing state on transient error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return events.filter((ev) => {
      if (selectedCategory !== 'all' && ev.category_slug !== selectedCategory) return false;
      if (q) {
        const hay = `${ev.title} ${ev.summary} ${ev.venue_name} ${ev.venue_city} ${ev.category_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, selectedCategory, searchQuery]);

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setUser(null);
    showFlash('Signed out of workspace.');
  }

  function openAuth(role = 'organizer') {
    setAuthSuggestedRole(role);
    setAuthModalOpen(true);
  }

  function handleUseTemplate(tpl: EventTemplateItem) {
    if (!user || !['admin', 'organizer'].includes(user.role_slug)) {
      setTemplateToLaunch(tpl);
      openAuth('organizer');
      return;
    }
    setTemplateToLaunch(tpl);
    setPage('dashboard');
  }

  const navLinks: Array<{ id: ActivePage; label: string }> = [
    { id: 'discover', label: 'Discover' },
    { id: 'templates', label: '40 Templates' },
    { id: 'scanner', label: 'Ticket Scanner' },
    { id: 'dashboard', label: 'Organizer Hub' },
    { id: 'schema', label: '42-Table Schema' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors dark:bg-slate-950 dark:text-slate-100">
      {/* Top Bar Contract: Strict 3 Zones separated by gap-8 */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Brand wordmark (1 line, no badges or subtitles) */}
          <button
            type="button"
            onClick={() => setPage('discover')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 dark:text-slate-100"
          >
            Cadence Events
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => {
              const active = page === link.id;
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => setPage(link.id)}
                  className={`border-b-2 py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-blue-600 text-slate-900 dark:text-slate-100'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:border-slate-700 dark:hover:text-slate-100'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            {user ? (
              <button
                type="button"
                onClick={() => setPage(page === 'passes' ? 'dashboard' : 'passes')}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-700"
              >
                {page === 'passes' ? 'Open Workspace' : `My Passes (${user.role_name.split(' ')[0]})`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuth('organizer')}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                Sign In
              </button>
            )}
          </div>
        </div>

        {/* Mobile Secondary Nav Row (only below md) */}
        <div className="flex items-center gap-4 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden dark:border-slate-800">
          {navLinks.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => setPage(link.id)}
              className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                page === link.id ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {link.label}
            </button>
          ))}
        </div>
      </header>

      {/* Flash Feedback Banner (PRG / Server Feedback) */}
      {flashMessage && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{flashMessage}</span>
            </div>
            <button type="button" onClick={() => setFlashMessage(null)} className="rounded p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {page === 'discover' && (
          <div className="space-y-10">
            {/* Hero Split Section */}
            <section className="grid items-stretch gap-6 lg:grid-cols-12">
              <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-7 sm:p-9 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    Event Operations &amp; Cryptographic Ticketing
                  </p>
                  <h1 className="mt-3 max-w-xl font-display text-3xl font-extrabold tracking-tight text-slate-900 text-balance sm:text-4xl dark:text-slate-100">
                    Orchestrate live events, ticket inventory, and gate entry in one system.
                  </h1>
                  <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    Launch new productions from 40 pre-engineered event blueprints, issue HMAC-SHA256 verifiable QR passes,
                    track real-time venue occupancy across entry gates, and export audit-ready financial reports.
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <a
                    href="#catalog"
                    className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap"
                  >
                    Browse Upcoming Events
                  </a>
                  <button
                    type="button"
                    onClick={() => setPage('templates')}
                    className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Explore 40 Templates
                  </button>
                </div>
              </div>

              <div className="relative min-h-[280px] overflow-hidden rounded-xl border border-slate-200 bg-slate-900 lg:col-span-6 dark:border-slate-800">
                <img
                  src="/src/assets/images/hero_summit_stage_1795541473829.jpg"
                  alt="Keynote auditorium stage"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent" />
                <div className="absolute bottom-5 left-5 right-5 text-white">
                  <p className="text-xs text-slate-300">Featured Live Summit · San Francisco</p>
                  <p className="mt-1 font-display text-lg font-bold">Meridian AI &amp; Systems Summit 2026</p>
                  <p className="mt-1 text-xs text-slate-300">
                    Real-time gate verification active across Main Concourse Gate A &amp; VIP Express Gate B
                  </p>
                </div>
              </div>
            </section>

            {/* Full-Width 4-Column Summary KPI Strip */}
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Custom Event Blueprints</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {templates.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">Ready across 8 event categories</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Relational SQLite Tables</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">42</p>
                <p className="mt-1 text-xs text-slate-500">Foreign-key linked CRUD schema</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Active Catalog Events</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {events.length}
                </p>
                <p className="mt-1 text-xs text-slate-500">Multi-tier ticketing &amp; promos</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">Entry Security Standard</p>
                <p className="mt-1.5 font-mono text-2xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  HMAC-SHA256
                </p>
                <p className="mt-1 text-xs text-slate-500">Anti-passback live gate scanner</p>
              </div>
            </section>

            {/* Event Catalog Section */}
            <section id="catalog" className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Upcoming Events</h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Select any event to inspect schedules, apply promo codes, and issue verifiable QR passes.
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search events, venues, cities..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Segmented Category Filter */}
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  All Events
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCategory(c.slug)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                      selectedCategory === c.slug
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-80 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {filteredEvents.map((ev) => (
                    <article
                      key={ev.id}
                      onClick={() => setSelectedEventId(ev.id)}
                      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      <div className="relative aspect-4/3 overflow-hidden bg-slate-200 dark:bg-slate-800">
                        <img
                          src={ev.banner_url}
                          alt={ev.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-5">
                        <div>
                          {/* Unboxed metadata with · separators (Zero-Pill discipline) */}
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {ev.category_name} · {ev.venue_city} · <span className="uppercase">{ev.status}</span>
                          </p>
                          <h3 className="mt-2 font-display text-base font-bold text-slate-900 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                            {ev.title}
                          </h3>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                            {ev.summary}
                          </p>
                        </div>

                        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3.5 text-xs dark:border-slate-800">
                          <span className="flex items-center gap-1.5 text-slate-500 tabular-nums dark:text-slate-400">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateTime(ev.start_at)}
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                            From {formatCurrency(ev.min_price_cents)}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {!loading && filteredEvents.length === 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
                  <Ticket className="mx-auto h-7 w-7 text-slate-400" />
                  <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">No events match your current filters</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchQuery('');
                    }}
                    className="mt-3 rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    Reset Filters
                  </button>
                </div>
              )}
            </section>
          </div>
        )}

        {page === 'templates' && (
          <TemplatesView
            templates={templates}
            categories={categories}
            user={user}
            onUseTemplate={handleUseTemplate}
            onTemplateCreated={async (msg) => {
              showFlash(msg);
              await loadAllData();
            }}
            onRequireAuth={openAuth}
          />
        )}

        {page === 'scanner' && (
          <ScannerView
            user={user}
            onRequireAuth={openAuth}
            prefilledPayload={scannerPrefill}
            onClearPrefill={() => setScannerPrefill(null)}
          />
        )}

        {page === 'dashboard' && (
          <OrganizerDashboard
            user={user}
            events={events}
            templates={templates}
            categories={categories}
            venues={venues}
            darkMode={darkMode}
            onToggleDark={() => setDarkMode((d) => !d)}
            onRefreshAll={loadAllData}
            onRequireAuth={openAuth}
            onOpenScanner={() => setPage('scanner')}
            onFlash={showFlash}
            initialTemplateForCreate={templateToLaunch}
            onClearInitialTemplate={() => setTemplateToLaunch(null)}
          />
        )}

        {page === 'schema' && <SchemaExplorerView user={user} onRequireAuth={openAuth} onFlash={showFlash} />}

        {page === 'passes' && (
          <MyPassesView
            user={user}
            onRequireAuth={openAuth}
            onOpenScannerWithPayload={(payload, eventId) => {
              setScannerPrefill({ payload, eventId });
              setPage('scanner');
            }}
          />
        )}
      </main>

      {/* Clean Editorial Footer */}
      <footer className="mt-16 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-xs text-slate-500 sm:px-6 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-display font-semibold text-slate-900 dark:text-slate-100">Cadence Events</span>
            <span>Event Management, Ticketing &amp; Gate Verification</span>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out ({user.email})
              </button>
            )}
            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {darkMode ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        suggestedRole={authSuggestedRole}
        onAuthenticated={async (authedUser, msg) => {
          setUser(authedUser);
          showFlash(msg);
          await loadAllData();
          if (templateToLaunch && ['admin', 'organizer'].includes(authedUser.role_slug)) {
            setPage('dashboard');
          }
        }}
      />

      <EventDetailModal
        eventId={selectedEventId}
        user={user}
        onClose={() => setSelectedEventId(null)}
        onRequireAuth={openAuth}
        onOrderSuccess={async (msg) => {
          showFlash(msg);
          await loadAllData();
        }}
      />
    </div>
  );
}

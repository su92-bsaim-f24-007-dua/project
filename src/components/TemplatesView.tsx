import React, { useMemo, useState } from 'react';
import { CheckSquare, Layers, Plus, Search, X } from 'lucide-react';
import { apiRequest, formatCurrency } from '../lib/api';
import type { AuthUser, CategoryItem, EventTemplateItem } from '../types';

interface TemplatesViewProps {
  templates: EventTemplateItem[];
  categories: CategoryItem[];
  user: AuthUser | null;
  onUseTemplate: (tpl: EventTemplateItem) => void;
  onTemplateCreated: (message: string) => void;
  onRequireAuth: (role?: string) => void;
}

export const TemplatesView: React.FC<TemplatesViewProps> = ({
  templates,
  categories,
  user,
  onUseTemplate,
  onTemplateCreated,
  onRequireAuth,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [inspected, setInspected] = useState<EventTemplateItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Custom template form state
  const [tplName, setTplName] = useState('');
  const [tplCategoryId, setTplCategoryId] = useState<number>(categories[0]?.id ?? 1);
  const [tplDesc, setTplDesc] = useState('');
  const [tplDuration, setTplDuration] = useState(6);
  const [tplCapacity, setTplCapacity] = useState(300);
  const [tplPriceUsd, setTplPriceUsd] = useState('75');
  const [tplLayout, setTplLayout] = useState('Conference Hall');
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (selectedCategory !== 'all' && t.category_slug !== selectedCategory) return false;
      if (q) {
        const hay = `${t.code} ${t.name} ${t.description} ${t.layout_style} ${t.category_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [templates, selectedCategory, search]);

  async function handleCreateTemplate(e: React.FormEvent) {
    e.preventDefault();
    setCreateErr(null);
    setCreating(true);
    try {
      const priceCents = Math.max(0, Math.round(Number(tplPriceUsd || 0) * 100));
      const res = await apiRequest<{ message: string }>('/api/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: tplName,
          categoryId: tplCategoryId,
          description: tplDesc,
          defaultDurationHours: tplDuration,
          defaultCapacity: tplCapacity,
          suggestedTicketPriceCents: priceCents,
          layoutStyle: tplLayout,
        }),
      });
      setShowCreateModal(false);
      setTplName('');
      setTplDesc('');
      onTemplateCreated(res.message);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Unable to create template.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Custom Event Templates ({templates.length})
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Pre-engineered blueprints with ticket tier pricing, schedule tracks, and operational checklists. Launch any template directly into your organizer workflow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!user || !['admin', 'organizer'].includes(user.role_slug)) {
              onRequireAuth('organizer');
              return;
            }
            setTplCategoryId(categories[0]?.id ?? 1);
            setShowCreateModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Custom Template
        </button>
      </div>

      {/* Category segmented filter & search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
            All ({templates.length})
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

        <div className="relative w-full lg:w-72 shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter 40 templates by name or code..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((tpl) => (
          <div
            key={tpl.id}
            className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
          >
            <div>
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{tpl.code}</span>
                <span className="truncate">{tpl.category_name}</span>
              </div>
              <h3 className="mt-2 font-display text-sm font-bold text-slate-900 dark:text-slate-100">{tpl.name}</h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">{tpl.description}</p>
            </div>

            <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums dark:text-slate-400">
                <span>{tpl.default_capacity.toLocaleString()} cap · {tpl.default_duration_hours}h</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {formatCurrency(tpl.suggested_ticket_price_cents)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInspected(tpl)}
                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Inspect Blueprint
                </button>
                <button
                  type="button"
                  onClick={() => onUseTemplate(tpl)}
                  className="flex-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap dark:bg-blue-600 dark:hover:bg-blue-700"
                >
                  Use Template
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Template Inspector Modal */}
      {inspected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="font-mono text-xs text-blue-600 dark:text-blue-400">
                  {inspected.code} · {inspected.category_name} · {inspected.layout_style}
                </p>
                <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-slate-100">{inspected.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setInspected(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{inspected.description}</p>

            <div className="mt-5 grid grid-cols-3 gap-3 border-y border-slate-200 py-3 text-xs dark:border-slate-800">
              <div>
                <span className="text-slate-500">Default Capacity</span>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {inspected.default_capacity.toLocaleString()} guests
                </p>
              </div>
              <div>
                <span className="text-slate-500">Duration</span>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {inspected.default_duration_hours} hours
                </p>
              </div>
              <div>
                <span className="text-slate-500">Suggested Entry</span>
                <p className="mt-0.5 font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatCurrency(inspected.suggested_ticket_price_cents)}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <h4 className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  <Layers className="h-3.5 w-3.5" /> Pre-Configured Ticket Tiers
                </h4>
                <div className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {(JSON.parse(inspected.default_tiers_json || '[]') as Array<{ name: string; description: string; priceCents: number; sharePct: number }>).map(
                    (tier, idx) => (
                      <div key={idx} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{tier.name}</p>
                          <p className="text-slate-500 dark:text-slate-400">{tier.description}</p>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <p className="font-bold text-slate-900 dark:text-slate-100">{formatCurrency(tier.priceCents)}</p>
                          <p className="text-slate-500">{Math.round((tier.sharePct || 0) * 100)}% allocation</p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>

              <div>
                <h4 className="flex items-center gap-1.5 font-display text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                  <CheckSquare className="h-3.5 w-3.5" /> Operational Production Checklist
                </h4>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {(JSON.parse(inspected.checklist_json || '[]') as string[]).map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInspected(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = inspected;
                  setInspected(null);
                  onUseTemplate(target);
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Launch Event from {inspected.code}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom Template Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Create Custom Event Template</h3>
              <button type="button" onClick={() => setShowCreateModal(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            {createErr && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {createErr}
              </div>
            )}
            <form onSubmit={handleCreateTemplate} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Template Name</label>
                <input
                  type="text"
                  required
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                  placeholder="Executive Cloud Architecture Workshop"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Category</label>
                  <select
                    value={tplCategoryId}
                    onChange={(e) => setTplCategoryId(Number(e.target.value))}
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
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Layout Style</label>
                  <input
                    type="text"
                    required
                    value={tplLayout}
                    onChange={(e) => setTplLayout(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Duration (hrs)</label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={tplDuration}
                    onChange={(e) => setTplDuration(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Capacity</label>
                  <input
                    type="number"
                    min={10}
                    max={50000}
                    value={tplCapacity}
                    onChange={(e) => setTplCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Price (USD)</label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={tplPriceUsd}
                    onChange={(e) => setTplPriceUsd(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Description</label>
                <textarea
                  rows={3}
                  required
                  value={tplDesc}
                  onChange={(e) => setTplDesc(e.target.value)}
                  placeholder="Describe layout, stage configuration, and target event format..."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={creating}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Saving Template...' : 'Save Custom Template'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

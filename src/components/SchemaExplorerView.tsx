import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Edit3, Plus, Search, Trash2, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthUser, TableMeta } from '../types';

interface SchemaExplorerViewProps {
  user: AuthUser | null;
  onRequireAuth: (role?: string) => void;
  onFlash: (msg: string) => void;
}

export const SchemaExplorerView: React.FC<SchemaExplorerViewProps> = ({ user, onRequireAuth, onFlash }) => {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selectedTableName, setSelectedTableName] = useState<string>('events');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [tableSearch, setTableSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create/Edit modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const canBrowseRows = Boolean(user && ['admin', 'organizer', 'finance'].includes(user.role_slug));
  const canMutateRows = Boolean(user && ['admin', 'organizer'].includes(user.role_slug));

  const loadTables = useCallback(async () => {
    try {
      const res = await apiRequest<{ totalTables: number; tables: TableMeta[] }>('/api/schema/tables');
      setTables(res.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load schema metadata.');
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!canBrowseRows || !selectedTableName) return;
    setLoadingRows(true);
    setError(null);
    try {
      const res = await apiRequest<{ table: TableMeta; rows: Array<Record<string, unknown>> }>(
        `/api/schema/tables/${encodeURIComponent(selectedTableName)}?limit=60&search=${encodeURIComponent(rowSearch)}`
      );
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to fetch table rows.');
    } finally {
      setLoadingRows(false);
    }
  }, [canBrowseRows, selectedTableName, rowSearch]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const groupedTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    const groups = new Map<string, TableMeta[]>();
    for (const t of tables) {
      if (q && !`${t.name} ${t.label} ${t.domain}`.toLowerCase().includes(q)) continue;
      if (!groups.has(t.domain)) groups.set(t.domain, []);
      groups.get(t.domain)!.push(t);
    }
    return Array.from(groups.entries());
  }, [tables, tableSearch]);

  const activeMeta = tables.find((t) => t.name === selectedTableName) ?? null;

  function openCreate() {
    if (!activeMeta) return;
    const init: Record<string, string> = {};
    for (const col of activeMeta.columns) {
      if (!col.readonly) init[col.name] = col.type === 'boolean' ? '1' : '';
    }
    setFormValues(init);
    setEditingId(null);
    setModalMode('create');
  }

  function openEdit(row: Record<string, unknown>) {
    if (!activeMeta) return;
    const init: Record<string, string> = {};
    for (const col of activeMeta.columns) {
      if (!col.readonly) init[col.name] = row[col.name] !== null && row[col.name] !== undefined ? String(row[col.name]) : '';
    }
    setFormValues(init);
    setEditingId(Number(row.id));
    setModalMode('edit');
  }

  async function handleSaveRow(e: React.FormEvent) {
    e.preventDefault();
    if (!activeMeta) return;
    setSaving(true);
    setError(null);
    try {
      if (modalMode === 'create') {
        const res = await apiRequest<{ message: string }>(`/api/schema/tables/${activeMeta.name}`, {
          method: 'POST',
          body: JSON.stringify(formValues),
        });
        onFlash(res.message);
      } else if (modalMode === 'edit' && editingId) {
        const res = await apiRequest<{ message: string }>(`/api/schema/tables/${activeMeta.name}/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(formValues),
        });
        onFlash(res.message);
      }
      setModalMode(null);
      await loadRows();
      await loadTables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRow(id: number) {
    if (!activeMeta) return;
    setError(null);
    try {
      const res = await apiRequest<{ message: string }>(`/api/schema/tables/${activeMeta.name}/${id}`, {
        method: 'DELETE',
      });
      onFlash(res.message);
      await loadRows();
      await loadTables();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete blocked by relational constraint.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Relational Database Schema ({tables.length} Tables)
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Normalized SQLite relational model with foreign-key enforcement, audit logging, and full CRUD inspection across all {tables.length} tables.
          </p>
        </div>
        <div className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {tables.reduce((s, t) => s + t.rowCount, 0).toLocaleString()} Total Records
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: 42 Tables Navigator */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search 42 tables..."
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div className="max-h-[600px] space-y-4 overflow-y-auto pr-1">
            {groupedTables.map(([domain, items]) => (
              <div key={domain}>
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {domain} ({items.length})
                </p>
                <div className="space-y-0.5">
                  {items.map((tbl) => {
                    const active = tbl.name === selectedTableName;
                    return (
                      <button
                        key={tbl.name}
                        type="button"
                        onClick={() => setSelectedTableName(tbl.name)}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                          active
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="truncate font-mono">{tbl.name}</span>
                        <span className="ml-2 shrink-0 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          {tbl.rowCount}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Table Definition & CRUD Data Grid */}
        <div className="space-y-4 lg:col-span-8">
          {activeMeta && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{activeMeta.domain}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{activeMeta.columns.length} columns</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{activeMeta.rowCount} rows</span>
                  </div>
                  <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-slate-100">
                    {activeMeta.label} <span className="font-mono text-sm font-normal text-slate-400">({activeMeta.name})</span>
                  </h3>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{activeMeta.description}</p>
                </div>

                {canMutateRows && !['user_sessions', 'audit_logs'].includes(activeMeta.name) && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Row
                  </button>
                )}
              </div>

              {/* Column & Foreign Key Blueprint */}
              <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-400">
                {activeMeta.columns.map((c) => (
                  <span key={c.name} className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono dark:border-slate-800 dark:bg-slate-950">
                    {c.name}: <span className="text-slate-400">{c.type}</span>
                    {c.fk && <span className="text-blue-600 dark:text-blue-400"> → {c.fk}</span>}
                  </span>
                ))}
              </div>

              {error && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </div>
              )}

              {!canBrowseRows ? (
                <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-950">
                  <Database className="mx-auto h-6 w-6 text-slate-400" />
                  <p className="mt-2 text-xs font-medium text-slate-900 dark:text-slate-100">
                    Live Row Inspection Requires Organizer, Finance, or Admin Access
                  </p>
                  <button
                    type="button"
                    onClick={() => onRequireAuth('organizer')}
                    className="mt-3 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-blue-600"
                  >
                    Sign In to Inspect &amp; Edit Table Rows
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="search"
                      value={rowSearch}
                      onChange={(e) => setRowSearch(e.target.value)}
                      placeholder={`Filter ${activeMeta.name} records...`}
                      className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    {loadingRows && <span className="text-xs text-slate-400">Refreshing...</span>}
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                        <tr>
                          {activeMeta.columns.slice(0, 6).map((c) => (
                            <th key={c.name} className="px-3 py-2.5 font-mono font-medium whitespace-nowrap">
                              {c.name}
                            </th>
                          ))}
                          {canMutateRows && <th className="px-3 py-2.5 text-right font-medium">Actions</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {rows.map((row) => (
                          <tr key={Number(row.id)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                            {activeMeta.columns.slice(0, 6).map((c) => (
                              <td
                                key={c.name}
                                className="max-w-[180px] truncate px-3 py-2 font-mono text-[11px] text-slate-800 tabular-nums dark:text-slate-200"
                              >
                                {row[c.name] === null || row[c.name] === undefined ? '—' : String(row[c.name])}
                              </td>
                            ))}
                            {canMutateRows && (
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => openEdit(row)}
                                  className="mr-1.5 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"
                                  title="Edit row"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRow(Number(row.id))}
                                  className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                                  title="Delete row"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-500">
                              No matching records found in {activeMeta.name}.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      {modalMode && activeMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {modalMode === 'create' ? `Insert into ${activeMeta.name}` : `Edit ${activeMeta.name} #${editingId}`}
              </h3>
              <button type="button" onClick={() => setModalMode(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveRow} className="mt-4 space-y-3">
              {activeMeta.columns
                .filter((c) => !c.readonly)
                .map((c) => (
                  <div key={c.name}>
                    <label className="mb-1 block font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
                      {c.name} {c.required && <span className="text-red-500">*</span>}
                      {c.fk && <span className="ml-1 text-blue-600 dark:text-blue-400">({c.fk})</span>}
                    </label>
                    <input
                      type={c.type === 'integer' || c.type === 'real' ? 'number' : 'text'}
                      required={c.required}
                      value={formValues[c.name] ?? ''}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, [c.name]: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                ))}
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Check, Copy, QrCode, Ticket } from 'lucide-react';
import { apiRequest, formatCurrency, formatDateTime } from '../lib/api';
import type { AuthUser, UserTicket } from '../types';

interface MyPassesViewProps {
  user: AuthUser | null;
  onRequireAuth: (role?: string) => void;
  onOpenScannerWithPayload?: (payload: string, eventId: number) => void;
}

export const MyPassesView: React.FC<MyPassesViewProps> = ({ user, onRequireAuth, onOpenScannerWithPayload }) => {
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, { svg: string; qrPayload: string }>>({});
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setTickets([]);
      return;
    }
    setLoading(true);
    apiRequest<{ tickets: UserTicket[] }>('/api/my-tickets')
      .then(async (res) => {
        setTickets(res.tickets);
        const entries = await Promise.all(
          res.tickets.map(async (tk) => {
            const qr = await apiRequest<{ svg: string; qrPayload: string }>(`/api/tickets/${encodeURIComponent(tk.ticket_code)}/qr`);
            return [tk.ticket_code, qr] as const;
          })
        );
        setQrMap(Object.fromEntries(entries));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <Ticket className="mx-auto h-8 w-8 text-slate-400" />
        <h2 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-slate-100">Digital Ticket Wallet</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Sign in or create an account to purchase event tickets and access your cryptographically signed QR passes.
        </p>
        <button
          type="button"
          onClick={() => onRequireAuth('attendee')}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign In / Create Account
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">My Event Passes</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Cryptographically signed HMAC-SHA256 QR passes ready for express gate verification.
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {tickets.length} Pass{tickets.length === 1 ? '' : 'es'} Issued
        </span>
      </div>

      {loading && <div className="py-12 text-center text-sm text-slate-500">Loading your digital passes...</div>}

      {!loading && tickets.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <QrCode className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-3 text-sm font-medium text-slate-900 dark:text-slate-100">No passes purchased yet</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Browse upcoming events in Discover to book a ticket and generate your verifiable QR pass.
          </p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {tickets.map((tk) => {
          const qr = qrMap[tk.ticket_code];
          const statusColor =
            tk.status === 'checked_in'
              ? 'text-emerald-700 dark:text-emerald-400'
              : tk.status === 'refunded' || tk.status === 'cancelled'
                ? 'text-red-700 dark:text-red-400'
                : 'text-blue-700 dark:text-blue-400';

          return (
            <div
              key={tk.id}
              className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className={`font-semibold uppercase tracking-wide ${statusColor}`}>
                    {tk.status.replace('_', ' ')}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{tk.order_number}</span>
                </div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">{tk.event_title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {tk.tier_name} · <span className="font-mono tabular-nums">{formatCurrency(tk.price_cents)}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(tk.start_at)} · {tk.venue_name}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Holder: {tk.holder_name} · Code: <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{tk.ticket_code}</span>
                </p>
                {qr && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(qr.qrPayload);
                        setCopiedCode(tk.ticket_code);
                        setTimeout(() => setCopiedCode(null), 1800);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      {copiedCode === tk.ticket_code ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedCode === tk.ticket_code ? 'Copied QR Payload' : 'Copy QR Payload'}
                    </button>
                    {onOpenScannerWithPayload && user.role_slug !== 'attendee' && (
                      <button
                        type="button"
                        onClick={() => onOpenScannerWithPayload(qr.qrPayload, tk.event_id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap dark:bg-slate-100 dark:text-slate-900"
                      >
                        <QrCode className="h-3.5 w-3.5" />
                        Test in Gate Scanner
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-700">
                {qr ? (
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`}
                    alt={`QR Pass for ${tk.ticket_code}`}
                    className="h-32 w-32"
                  />
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center text-xs text-slate-400">QR Loading</div>
                )}
                <span className="mt-1 font-mono text-[10px] text-slate-500">{tk.qr_signature.slice(0, 12)}…</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

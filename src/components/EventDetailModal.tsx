import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, MapPin, Minus, Plus, Ticket, Users, X } from 'lucide-react';
import { apiRequest, formatCurrency, formatDateTime } from '../lib/api';
import type { AuthUser, TicketTier } from '../types';

interface EventDetailModalProps {
  eventId: number | null;
  user: AuthUser | null;
  onClose: () => void;
  onRequireAuth: (role?: string) => void;
  onOrderSuccess: (message: string) => void;
}

interface EventDetailPayload {
  event: Record<string, unknown>;
  tiers: TicketTier[];
  sessions: Array<Record<string, unknown>>;
  sponsors: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  promoCodes: Array<{ code: string; discount_type: string; discount_value: number }>;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  eventId,
  user,
  onClose,
  onRequireAuth,
  onOrderSuccess,
}) => {
  const [data, setData] = useState<EventDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [promoCode, setPromoCode] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderEmail, setHolderEmail] = useState('');
  const [checkingOut, setCheckingOut] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    orderNumber: string;
    totalCents: number;
    tickets: Array<{ ticketCode: string; tierName: string }>;
  } | null>(null);

  useEffect(() => {
    if (!eventId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setConfirmation(null);
    setQuantities({});
    setPromoCode('');
    apiRequest<EventDetailPayload>(`/api/events/${eventId}`)
      .then((res) => {
        setData(res);
        if (res.tiers.length > 0) {
          setQuantities({ [res.tiers[0].id]: 1 });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load event details.'))
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (user) {
      setHolderName((prev) => prev || user.full_name);
      setHolderEmail((prev) => prev || user.email);
    }
  }, [user]);

  if (!eventId) return null;

  const selectedItems = (data?.tiers ?? [])
    .map((t) => ({ tier: t, qty: quantities[t.id] || 0 }))
    .filter((i) => i.qty > 0);

  const subtotalCents = selectedItems.reduce((sum, i) => sum + i.tier.price_cents * i.qty, 0);
  const matchedPromo = data?.promoCodes.find((p) => p.code.toUpperCase() === promoCode.trim().toUpperCase());
  const discountCents = matchedPromo
    ? matchedPromo.discount_type === 'percent'
      ? Math.round((subtotalCents * matchedPromo.discount_value) / 100)
      : Math.min(subtotalCents, matchedPromo.discount_value)
    : 0;
  const estTaxCents = Math.round(Math.max(0, subtotalCents - discountCents) * 0.085);
  const totalCents = Math.max(0, subtotalCents - discountCents) + estTaxCents;

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      onRequireAuth('attendee');
      return;
    }
    if (selectedItems.length === 0) {
      setError('Select at least one ticket quantity.');
      return;
    }
    setError(null);
    setCheckingOut(true);
    try {
      const res = await apiRequest<{
        orderNumber: string;
        totalCents: number;
        tickets: Array<{ ticketCode: string; tierName: string }>;
        message: string;
      }>('/api/orders/checkout', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          items: selectedItems.map((i) => ({ tierId: i.tier.id, quantity: i.qty })),
          promoCode: promoCode.trim() || undefined,
          holderName: holderName.trim() || user.full_name,
          holderEmail: holderEmail.trim() || user.email,
        }),
      });
      setConfirmation(res);
      onOrderSuccess(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed.');
    } finally {
      setCheckingOut(false);
    }
  }

  const ev = data?.event;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {ev ? `${String(ev.category_name)} · ${String(ev.venue_city)}` : 'Event Details'}
            </p>
            <h2 className="truncate font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {ev ? String(ev.title) : 'Loading Event...'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            aria-label="Close event dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {loading && <div className="py-12 text-center text-sm text-slate-500">Loading event schedule &amp; ticket inventory...</div>}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </div>
          )}

          {data && ev && (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="space-y-6 lg:col-span-7">
                <div className="relative aspect-16/9 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 dark:border-slate-800">
                  <img
                    src={String(ev.banner_url)}
                    alt={String(ev.title)}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center gap-4 text-xs text-slate-200">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDateTime(String(ev.start_at))}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {String(ev.venue_name)}, {String(ev.venue_city)}
                    </span>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      <Users className="h-3.5 w-3.5" />
                      Capacity {Number(ev.capacity).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">About This Event</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{String(ev.description)}</p>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Organized by {String(ev.organizer_name)}
                    {ev.organization_name ? ` · ${String(ev.organization_name)}` : ''}
                    {ev.template_code ? ` · Blueprint ${String(ev.template_code)}` : ''}
                  </p>
                </div>

                {data.sessions.length > 0 && (
                  <div className="border-t border-slate-200 pt-5 dark:border-slate-800">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Program Schedule ({data.sessions.length} Sessions)
                    </h3>
                    <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                      {data.sessions.map((s) => (
                        <div key={Number(s.id)} className="py-3">
                          <div className="flex items-baseline justify-between gap-4">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{String(s.title)}</p>
                            <span className="shrink-0 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                              {formatDateTime(String(s.start_at))}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {String(s.track_name)}
                            {s.zone_name ? ` · ${String(s.zone_name)}` : ''}
                            {s.speakers_label ? ` · ${String(s.speakers_label)}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-5">
                {confirmation ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2.5 text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-5 w-5" />
                      <h3 className="font-display text-base font-bold">Order Confirmed</h3>
                    </div>
                    <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                      Order <span className="font-mono font-semibold">{confirmation.orderNumber}</span> · Total{' '}
                      <span className="font-mono font-semibold tabular-nums">{formatCurrency(confirmation.totalCents)}</span>
                    </p>
                    <div className="mt-4 space-y-2">
                      {confirmation.tickets.map((tk) => (
                        <div
                          key={tk.ticketCode}
                          className="flex items-center justify-between rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs dark:border-emerald-900/40 dark:bg-slate-900"
                        >
                          <span className="font-medium text-slate-900 dark:text-slate-100">{tk.tierName}</span>
                          <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{tk.ticketCode}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-xs text-slate-600 dark:text-slate-400">
                      Your cryptographic QR passes are now stored in <strong>My Passes</strong> and ready for instant gate scanning.
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <form
                    onSubmit={handleCheckout}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">Select Tickets</h3>
                      <Ticket className="h-4 w-4 text-slate-400" />
                    </div>

                    <div className="mt-4 space-y-3">
                      {data.tiers.map((tier) => {
                        const remaining = Math.max(0, tier.quantity_total - tier.quantity_sold);
                        const qty = quantities[tier.id] || 0;
                        return (
                          <div
                            key={tier.id}
                            className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{tier.name}</p>
                                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{tier.description}</p>
                                <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                                  {remaining} remaining
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                                  {formatCurrency(tier.price_cents)}
                                </p>
                                <div className="mt-2 flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setQuantities((q) => ({ ...q, [tier.id]: Math.max(0, qty - 1) }))}
                                    className="rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    aria-label={`Decrease ${tier.name}`}
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <span className="w-6 text-center font-mono text-xs font-semibold tabular-nums">{qty}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setQuantities((q) => ({
                                        ...q,
                                        [tier.id]: Math.min(remaining, tier.max_per_order, qty + 1),
                                      }))
                                    }
                                    className="rounded border border-slate-300 p-1 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                    aria-label={`Increase ${tier.name}`}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Promo Code {data.promoCodes[0] && <span className="text-slate-400">(try {data.promoCodes[0].code})</span>}
                        </label>
                        <input
                          type="text"
                          value={promoCode}
                          onChange={(e) => setPromoCode(e.target.value)}
                          placeholder="SUMMIT20"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs uppercase text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        />
                      </div>

                      {user && (
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Pass Holder</label>
                            <input
                              type="text"
                              required
                              value={holderName}
                              onChange={(e) => setHolderName(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Pass Email</label>
                            <input
                              type="email"
                              required
                              value={holderEmail}
                              onChange={(e) => setHolderEmail(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            />
                          </div>
                        </div>
                      )}

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                          <span>Subtotal</span>
                          <span className="font-mono tabular-nums">{formatCurrency(subtotalCents)}</span>
                        </div>
                        {discountCents > 0 && (
                          <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                            <span>Promo Discount</span>
                            <span className="font-mono tabular-nums">-{formatCurrency(discountCents)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-slate-600 dark:text-slate-400">
                          <span>Estimated Event Tax (8.5%)</span>
                          <span className="font-mono tabular-nums">{formatCurrency(estTaxCents)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-2 text-sm font-bold text-slate-900 dark:border-slate-800 dark:text-slate-100">
                          <span>Total</span>
                          <span className="font-mono tabular-nums">{formatCurrency(totalCents)}</span>
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={checkingOut || selectedItems.length === 0}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {!user
                          ? 'Sign In to Complete Checkout'
                          : checkingOut
                            ? 'Issuing QR Passes...'
                            : `Complete Order · ${formatCurrency(totalCents)}`}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

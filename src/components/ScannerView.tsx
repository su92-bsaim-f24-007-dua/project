import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, LogOut, QrCode, ScanLine, ShieldAlert, XCircle } from 'lucide-react';
import { apiRequest, formatDateTime } from '../lib/api';
import type { AuthUser } from '../types';

interface ScannerViewProps {
  user: AuthUser | null;
  onRequireAuth: (role?: string) => void;
  prefilledPayload?: { payload: string; eventId: number } | null;
  onClearPrefill?: () => void;
}

interface ScannerContext {
  events: Array<{ id: number; title: string; venue_id: number; capacity: number; status: string; venue_name: string }>;
  gates: Array<{ id: number; venue_id: number; gate_name: string; gate_code: string; gate_type: string; venue_name: string }>;
  devices: Array<{ id: number; gate_id: number; device_name: string; device_serial: string; status: string }>;
  recentScans: Array<Record<string, unknown>>;
  sampleTickets: Array<{
    ticket_code: string;
    event_id: number;
    qr_signature: string;
    holder_name: string;
    status: string;
    tier_name: string;
    event_title: string;
  }>;
}

interface LiveAttendance {
  event: { id: number; title: string; capacity: number; venue_id: number };
  currentOccupancy: number;
  ticketStats: { total_issued: number; checked_in_total: number; pending_arrival: number; voided_total: number };
  gateBreakdown: Array<{ id: number; gate_name: string; gate_code: string; valid_scans: number; rejected_scans: number }>;
  zoneBreakdown: Array<{ id: number; name: string; zone_code: string; capacity: number; is_vip: number; occupancy: number }>;
}

interface ScanOutcome {
  verified: boolean;
  scanResult: string;
  rejectionReason: string;
  ticketCode: string;
  holderName: string;
  tierName: string;
  gateName: string;
  scannedAt: string;
}

export const ScannerView: React.FC<ScannerViewProps> = ({
  user,
  onRequireAuth,
  prefilledPayload,
  onClearPrefill,
}) => {
  const [context, setContext] = useState<ScannerContext | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number>(1);
  const [selectedGateId, setSelectedGateId] = useState<number>(1);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number>(1);
  const [rawInput, setRawInput] = useState('');
  const [liveData, setLiveData] = useState<LiveAttendance | null>(null);
  const [recentScans, setRecentScans] = useState<Array<Record<string, unknown>>>([]);
  const [lastOutcome, setLastOutcome] = useState<ScanOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Camera QR state
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraNotice, setCameraNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const canScan = Boolean(user && ['admin', 'organizer', 'gate_staff'].includes(user.role_slug));

  const loadContext = useCallback(async () => {
    if (!canScan) return;
    try {
      const res = await apiRequest<ScannerContext>('/api/scanner/context');
      setContext(res);
      setRecentScans(res.recentScans);
      if (res.events.length > 0) {
        const firstEv = res.events[0];
        setSelectedEventId((prev) => (res.events.some((e) => e.id === prev) ? prev : firstEv.id));
      }
      if (res.gates.length > 0) {
        setSelectedGateId((prev) => (res.gates.some((g) => g.id === prev) ? prev : res.gates[0].id));
      }
      if (res.devices.length > 0) {
        setSelectedDeviceId((prev) => (res.devices.some((d) => d.id === prev) ? prev : res.devices[0].id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gate scanner context.');
    }
  }, [canScan]);

  const loadLiveAttendance = useCallback(async (evId: number) => {
    if (!evId) return;
    try {
      const live = await apiRequest<LiveAttendance>(`/api/events/${evId}/attendance-live`);
      setLiveData(live);
    } catch {
      // ignore transient
    }
  }, []);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (prefilledPayload) {
      setSelectedEventId(prefilledPayload.eventId);
      setRawInput(prefilledPayload.payload);
      onClearPrefill?.();
    }
  }, [prefilledPayload, onClearPrefill]);

  useEffect(() => {
    if (!canScan || !selectedEventId) return;
    loadLiveAttendance(selectedEventId);

    const sse = new EventSource(`/api/events/${selectedEventId}/attendance-stream`);
    sse.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload.type === 'scan' || payload.type === 'checkout') {
          loadLiveAttendance(selectedEventId);
          loadContext();
        }
      } catch {
        // ignore keepalive parse
      }
    };
    return () => {
      sse.close();
    };
  }, [canScan, selectedEventId, loadLiveAttendance, loadContext]);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function verifyPayload(inputToVerify: string) {
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await apiRequest<ScanOutcome>('/api/scanner/verify', {
        method: 'POST',
        body: JSON.stringify({
          rawInput: inputToVerify,
          eventId: selectedEventId,
          gateId: selectedGateId,
          scannerDeviceId: selectedDeviceId,
        }),
      });
      setLastOutcome(outcome);
      await loadLiveAttendance(selectedEventId);
      await loadContext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExitGate(ticketCode: string) {
    setError(null);
    try {
      await apiRequest('/api/scanner/checkout-gate', {
        method: 'POST',
        body: JSON.stringify({ ticketCode, eventId: selectedEventId }),
      });
      await loadLiveAttendance(selectedEventId);
      await loadContext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exit scan failed.');
    }
  }

  async function toggleCameraScanner() {
    if (cameraActive) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCameraActive(false);
      setCameraNotice(null);
      return;
    }

    setCameraNotice(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraNotice('Camera API unavailable in this context. Use handheld input or quick-test payloads below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);

      // Check native BarcodeDetector support
      const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        setCameraNotice('Live camera preview active. Automatic QR decoding requires Chrome BarcodeDetector; paste or type ticket code below.');
        return;
      }

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      const timer = setInterval(async () => {
        if (!videoRef.current || !streamRef.current) {
          clearInterval(timer);
          return;
        }
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            const scanned = codes[0].rawValue;
            setRawInput(scanned);
            clearInterval(timer);
            stream.getTracks().forEach((t) => t.stop());
            setCameraActive(false);
            verifyPayload(scanned);
          }
        } catch {
          // frame skip
        }
      }, 450);
    } catch {
      setCameraNotice('Camera permission denied or no webcam attached. Use handheld QR input or sample ticket tests.');
    }
  }

  if (!canScan) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
        <ScanLine className="mx-auto h-9 w-9 text-blue-600" />
        <h2 className="mt-4 font-display text-xl font-bold text-slate-900 dark:text-slate-100">
          Gate &amp; QR Verification Console
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Secure entry verification and real-time attendance tracking require <strong>Gate &amp; Scanner Staff</strong>,{' '}
          <strong>Event Organizer</strong>, or <strong>Platform Administrator</strong> privileges.
        </p>
        <button
          type="button"
          onClick={() => onRequireAuth('gate_staff')}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {user ? 'Sign In with Gate Staff / Organizer Role' : 'Create Gate Staff Account'}
        </button>
      </div>
    );
  }

  const selectedEvent = context?.events.find((e) => e.id === selectedEventId);
  const matchingGates = context?.gates.filter((g) => !selectedEvent || g.venue_id === selectedEvent.venue_id) ?? [];
  const sampleForEvent = context?.sampleTickets.filter((s) => s.event_id === selectedEventId) ?? [];
  const occupancyPct = liveData && liveData.event.capacity > 0
    ? Math.min(100, Math.round((liveData.currentOccupancy / liveData.event.capacity) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
            Secure Ticket Scanner &amp; Live Attendance
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            HMAC-SHA256 QR verification, anti-passback duplicate blocking, and real-time gate occupancy streams.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Operator: {user?.full_name}</span>
          <span aria-hidden="true">·</span>
          <span>{user?.role_name}</span>
        </div>
      </div>

      {/* Gate & Event Configuration Bar */}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Active Event</label>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {context?.events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} ({ev.venue_name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Entry Gate</label>
          <select
            value={selectedGateId}
            onChange={(e) => setSelectedGateId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {(matchingGates.length > 0 ? matchingGates : context?.gates ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.gate_name} ({g.gate_type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Scanner Terminal</label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            {context?.devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.device_name} · {d.device_serial}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Verification Terminal */}
        <div className="space-y-5 lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">QR / Ticket Code Verification</h3>
              <button
                type="button"
                onClick={toggleCameraScanner}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Camera className="h-3.5 w-3.5" />
                {cameraActive ? 'Stop Camera' : 'Use Camera QR'}
              </button>
            </div>

            {cameraNotice && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                {cameraNotice}
              </p>
            )}

            {cameraActive && (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800">
                <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
              </div>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                verifyPayload(rawInput);
              }}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Scan QR JSON Payload or Ticket Code
                </label>
                <input
                  type="text"
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder='e.g. CAD-1001-BRAVO or {"code":"CAD-1001-BRAVO","eventId":1,"sig":"..."}'
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-mono text-xs text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div className="flex gap-2.5">
                <button
                  type="submit"
                  disabled={submitting || !rawInput.trim()}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <QrCode className="h-4 w-4" />
                  {submitting ? 'Verifying Signature...' : 'Verify & Check In (IN)'}
                </button>
                <button
                  type="button"
                  disabled={!rawInput.trim()}
                  onClick={() => handleExitGate(rawInput.startsWith('{') ? JSON.parse(rawInput).code : rawInput)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Log Exit (OUT)
                </button>
              </div>
            </form>

            {/* Instant Verification Result Banner */}
            {lastOutcome && (
              <div
                className={`mt-4 rounded-xl border p-4 ${
                  lastOutcome.verified
                    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
                    : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
                }`}
              >
                <div className="flex items-start gap-3">
                  {lastOutcome.verified ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-display text-sm font-bold ${
                          lastOutcome.verified ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'
                        }`}
                      >
                        {lastOutcome.verified ? 'ENTRY GRANTED · VALID PASS' : `REJECTED · ${lastOutcome.scanResult}`}
                      </span>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{lastOutcome.ticketCode}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                      {lastOutcome.holderName} · {lastOutcome.tierName} · {lastOutcome.gateName}
                    </p>
                    {lastOutcome.rejectionReason && (
                      <p className="mt-1.5 text-xs font-medium text-red-700 dark:text-red-300">{lastOutcome.rejectionReason}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick-Test Gate Scenarios using live DB tickets */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Event Pass Registry (Quick Gate Test)
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Test valid HMAC QR passes, duplicate entry blocking, cancelled passes, or forged signature detection.
            </p>
            <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
              {sampleForEvent.map((tk) => {
                const payload = JSON.stringify({ code: tk.ticket_code, eventId: tk.event_id, sig: tk.qr_signature });
                return (
                  <div key={tk.ticket_code} className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">{tk.ticket_code}</p>
                      <p className="truncate text-slate-500 dark:text-slate-400">
                        {tk.holder_name} · {tk.tier_name} · <span className="uppercase">{tk.status}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setRawInput(payload);
                          verifyPayload(payload);
                        }}
                        className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700"
                      >
                        Scan QR
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const tampered = JSON.stringify({ code: tk.ticket_code, eventId: tk.event_id, sig: 'FORGED000000' });
                          setRawInput(tampered);
                          verifyPayload(tampered);
                        }}
                        title="Simulate forged QR signature"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {sampleForEvent.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-500">
                  No tickets issued yet for this event. Purchase a ticket in Discover to generate a live pass.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Real-Time Attendance Monitor */}
        <div className="space-y-5 lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Real-Time Venue Occupancy
              </h3>
              <span className="font-mono text-xs font-semibold text-blue-600 tabular-nums dark:text-blue-400">
                {occupancyPct}% Capacity
              </span>
            </div>

            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${occupancyPct}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Inside Venue</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {liveData?.currentOccupancy ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Checked In</p>
                <p className="mt-1 font-mono text-xl font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                  {liveData?.ticketStats.checked_in_total ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Awaiting Entry</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {liveData?.ticketStats.pending_arrival ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">Event Cap</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {liveData?.event.capacity ?? 0}
                </p>
              </div>
            </div>

            {liveData && liveData.gateBreakdown.length > 0 && (
              <div className="mt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Gate Throughput Breakdown
                </h4>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="py-2 font-medium">Gate</th>
                        <th className="py-2 text-right font-medium">Valid</th>
                        <th className="py-2 text-right font-medium">Blocked</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {liveData.gateBreakdown.map((g) => (
                        <tr key={g.id}>
                          <td className="py-2 font-medium text-slate-900 dark:text-slate-100">
                            {g.gate_name} <span className="font-mono text-slate-400">({g.gate_code})</span>
                          </td>
                          <td className="py-2 text-right font-mono text-emerald-600 tabular-nums dark:text-emerald-400">
                            {g.valid_scans}
                          </td>
                          <td className="py-2 text-right font-mono text-red-600 tabular-nums dark:text-red-400">
                            {g.rejected_scans}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Live Scan Audit Feed */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Live Gate Verification Stream
            </h3>
            <div className="mt-3 max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {recentScans.map((scan) => {
                const isValid = scan.scan_result === 'VALID';
                return (
                  <div key={Number(scan.id)} className="flex items-start justify-between gap-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono font-semibold ${
                            isValid ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                          }`}
                        >
                          {String(scan.scan_result)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-900 dark:text-slate-100">
                          {scan.ticket_code ? String(scan.ticket_code) : 'UNREGISTERED'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-slate-500 dark:text-slate-400">
                        {scan.holder_name ? `${String(scan.holder_name)} · ` : ''}
                        {String(scan.gate_name)}
                        {scan.rejection_reason ? ` — ${String(scan.rejection_reason)}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatDateTime(String(scan.scanned_at))}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

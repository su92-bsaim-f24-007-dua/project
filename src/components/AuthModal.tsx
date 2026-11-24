import React, { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { apiRequest, setAuthToken } from '../lib/api';
import type { AuthUser } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthenticated: (user: AuthUser, flashMessage: string) => void;
  initialTab?: 'login' | 'register' | 'admin';
  suggestedRole?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
  initialTab = 'register',
  suggestedRole = 'organizer',
}) => {
  const [tab, setTab] = useState<'login' | 'register' | 'admin'>(initialTab);
  const [adminStatus, setAdminStatus] = useState<{
    adminClaimed: boolean;
    hasEnvPasscode: boolean;
    canClaimFirstAdmin: boolean;
  } | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [roleSlug, setRoleSlug] = useState(suggestedRole);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setTab(initialTab);
    setRoleSlug(suggestedRole);
    apiRequest<{ adminClaimed: boolean; hasEnvPasscode: boolean; canClaimFirstAdmin: boolean }>('/api/auth/admin-status')
      .then(setAdminStatus)
      .catch(() => {});
  }, [isOpen, initialTab, suggestedRole]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'login') {
        const res = await apiRequest<{ token: string; user: AuthUser; message: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.message);
        onClose();
      } else if (tab === 'register') {
        const res = await apiRequest<{ token: string; user: AuthUser; message: string }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ fullName, email, password, roleSlug, organizationName }),
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.message);
        onClose();
      } else {
        const res = await apiRequest<{ token: string; user: AuthUser; message: string }>('/api/auth/claim-admin', {
          method: 'POST',
          body: JSON.stringify({ fullName, email, password, passcode }),
        });
        setAuthToken(res.token);
        onAuthenticated(res.user, res.message);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  const showAdminTab = !adminStatus?.adminClaimed || adminStatus?.hasEnvPasscode;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 id="auth-modal-title" className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Workspace Access
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Role-based session authentication with server-verified credentials.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'register'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Create Account
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              tab === 'login'
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            Sign In
          </button>
          {showAdminTab && (
            <button
              type="button"
              onClick={() => {
                setTab('admin');
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                tab === 'admin'
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              Admin Claim
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {tab !== 'login' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Jordan Rivera"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@organization.com"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
              Password {tab !== 'login' && <span className="text-slate-400">(min 8 characters)</span>}
            </label>
            <input
              type="password"
              required
              minLength={tab === 'login' ? 1 : 8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {tab === 'register' && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">Workspace Role</label>
                <select
                  value={roleSlug}
                  onChange={(e) => setRoleSlug(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="organizer">Event Organizer — Manage events, 40 templates & reports</option>
                  <option value="gate_staff">Gate & Scanner Staff — QR verification & live occupancy</option>
                  <option value="finance">Finance & Reporting Analyst — Payouts, refunds & exports</option>
                  <option value="attendee">Ticket Attendee — Purchase tickets & view QR passes</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Organization <span className="text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Meridian Live Productions"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </>
          )}

          {tab === 'admin' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
              <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                <span>First-Run Platform Administrator Claim</span>
              </div>
              <p className="mt-1 leading-relaxed">
                {adminStatus?.hasEnvPasscode
                  ? 'Enter the server ADMIN_PASSCODE configured in environment secrets to initialize an administrator.'
                  : 'Creates the initial Platform Administrator with full 42-table schema CRUD and RBAC role assignment access. Locks automatically once claimed.'}
              </p>
              {adminStatus?.hasEnvPasscode && (
                <div className="mt-2.5">
                  <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Admin Bootstrap Passcode
                  </label>
                  <input
                    type="password"
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Enter server ADMIN_PASSCODE"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting
              ? 'Verifying...'
              : tab === 'login'
                ? 'Sign In to Workspace'
                : tab === 'admin'
                  ? 'Claim Administrator Workspace'
                  : 'Create Account & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

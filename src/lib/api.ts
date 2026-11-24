let memoryBearerToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryBearerToken = token;
}

export function getAuthToken(): string | null {
  return memoryBearerToken;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('X-Requested-With', 'CadenceSPA');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryBearerToken) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!response.ok) {
    const errMsg =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed with status ${response.status}`;
    throw new Error(errMsg);
  }

  return data as T;
}

export function formatCurrency(cents: number): string {
  if (cents === 0) return 'Free';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

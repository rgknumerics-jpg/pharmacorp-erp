const API = (window as unknown as { __ERP_API__?: string }).__ERP_API__ ?? (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export async function papi<T = any>(path: string, opt: { method?: string; json?: unknown; token?: string | null; headers?: Record<string, string> } = {}): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(`${API}${path}`, {
    method: opt.method ?? (opt.json !== undefined ? 'POST' : 'GET'),
    headers: { ...(opt.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opt.token ? { Authorization: `Bearer ${opt.token}` } : {}), ...(opt.headers ?? {}) },
    body: opt.json !== undefined ? JSON.stringify(opt.json) : undefined,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ message: res.statusText }));
    const e = new Error(Array.isArray(b.message) ? b.message.join(', ') : b.message ?? 'Erreur') as Error & { status: number };
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { if (v === null || v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

export const fcfa = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} FCFA`;

/** Bip + vibration + notification système (si autorisée) : pour alerter le livreur d'une nouvelle course. */
export function alertUser(title: string, body: string) {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) { const c = new AC(), o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); o.stop(c.currentTime + 0.35); }
  } catch { /* ignore */ }
  try { navigator.vibrate?.([300, 120, 300]); } catch { /* ignore */ }
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); } catch { /* ignore */ }
}

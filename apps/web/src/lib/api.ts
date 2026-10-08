// la version installée injecte l'adresse réelle du serveur (port différent de la version de développement)
const API_URL = (window as unknown as { __ERP_API__?: string }).__ERP_API__ ?? (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string; slug: string };
  permissions: string[];
}

/**
 * Session conservee dans sessionStorage (disparait a la fermeture de l'onglet). Un cookie httpOnly emis par l'API
 * sera preferable en production (protection contre le vol de jeton par XSS) -- voir ARCHITECTURE.md section 8.
 */
const KEY = 'erp.session';
let session: Session | null = (() => {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
})();
let onExpire: () => void = () => undefined;

export const getSession = () => session;
export const setOnExpire = (fn: () => void) => { onExpire = fn; };
export const can = (perm: string) => !!session?.permissions.includes(perm);

function store(s: Session | null) {
  session = s;
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Poste partagé : un code personnel déverrouille le POS et fait travailler la personne sous son propre compte.
 * Le compte de départ est gardé de côté et restitué au verrouillage du poste.
 */
const BASE = 'erp.base';
export const hasBaseSession = () => { try { return !!sessionStorage.getItem(BASE); } catch { return false; } };
export function switchOperator(next: Session) {
  try { if (!sessionStorage.getItem(BASE) && session) sessionStorage.setItem(BASE, JSON.stringify(session)); } catch { /* ignore */ }
  store(next);
}
export function restoreBaseSession(): boolean {
  try {
    const b = sessionStorage.getItem(BASE);
    if (!b) return false;
    sessionStorage.removeItem(BASE); store(JSON.parse(b) as Session);
    return true;
  } catch { return false; }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function raw(path: string, init: RequestInit & { json?: unknown; form?: FormData } = {}, retry = true): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  let body: BodyInit | undefined = init.body ?? undefined;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  if (init.form) body = init.form;
  const res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  if (res.status === 401 && retry && session?.refreshToken) {
    const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: session.refreshToken }) });
    if (r.ok) {
      const next = (await r.json()) as Partial<Session>;
      store({ ...session, ...next } as Session);
      return raw(path, init, false);
    }
    store(null); onExpire();
  }
  return res;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await raw(path, init);
  if (!res.ok) {
    const b = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(Array.isArray(b.message) ? b.message.join(', ') : b.message ?? 'Erreur', res.status);
  }
  return res.json() as Promise<T>;
}

export async function apiBlob(path: string): Promise<Blob> {
  const res = await raw(path);
  if (!res.ok) throw new ApiError('Fichier indisponible', res.status);
  return res.blob();
}

export async function login(email: string, password: string, tenantSlug: string): Promise<Session> {
  const res = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, tenantSlug }) });
  if (!res.ok) {
    const b = await res.json().catch(() => ({ message: 'Connexion impossible' }));
    throw new ApiError(Array.isArray(b.message) ? b.message.join(', ') : b.message, res.status);
  }
  const s = (await res.json()) as Session;
  store(s);
  return s;
}

export function logout() { store(null); }
import { api } from './api';

export interface Branding {
  logo?: string;
  slogan?: string;
  receipt: { header?: string; footer?: string; widthMm: 58 | 80 | 210; showLogo: boolean; showNiu: boolean; showCashier: boolean; showCustomer: boolean; blocks: ReceiptBlock[] };
  label: { widthMm: number; heightMm: number; showPharmacy: boolean; showName: boolean; showDci: boolean; showPrice: boolean; showBarcode: boolean; showExpiry: boolean; showSupplier: boolean; showLot: boolean; layout: LabelLayout };
  voucher: { title: string; legalText: string; copies: number; autoPrint: boolean; showLogo: boolean };
}
export type ReceiptKey = 'logo' | 'name' | 'slogan' | 'address' | 'phone' | 'email' | 'legal' | 'header' | 'line1' | 'ticket' | 'cashier' | 'customer' | 'items' | 'total' | 'payments' | 'footer' | 'custom1' | 'custom2' | 'custom3' | 'thanks';
export interface ReceiptBlock { key: ReceiptKey; show: boolean; align: 'left' | 'center' | 'right'; size: number; bold: boolean; text?: string }
export type LabelKey = 'pharmacy' | 'name' | 'dci' | 'expiry' | 'supplier' | 'lot' | 'price' | 'barcode';
export interface LabelBox { x: number; y: number; w: number; fs: number; h?: number; align?: 'left' | 'center' | 'right'; bold?: boolean }
export type LabelLayout = Record<LabelKey, LabelBox>;
export interface Identity { name: string; address: string | null; city: string | null; phone: string | null; email: string | null; niu: string | null; rccm: string | null; authorization?: string | null; patente?: string | null }
export interface TicketInfo { fields: { rccm: boolean; niu: boolean; authorization: boolean; patente: boolean; bank: boolean; address: boolean; phone: boolean; email: boolean }; bankName: string; bankAccount: string }
export interface BrandingData { branding: Branding; identity: Identity; ticket?: TicketInfo }

let cache: Promise<BrandingData> | null = null;
/** Habillage de la structure (mis en cache ; rechargé après chaque enregistrement dans « Ma structure »). */
export function loadBranding(force = false): Promise<BrandingData> {
  if (!cache || force) cache = api<BrandingData>('/company/branding').catch((e) => { cache = null; throw e; });
  return cache;
}
export function setBrandingCache(d: BrandingData) { cache = Promise.resolve(d); }

import type { CategoryCode, KaratCode, KaratPriceRow } from '../types';

// Verbatim constants synchronized with firebase-blueprint.json & firestore.rules
export const VALIDATION_PATTERNS = {
  DOC_ID: /^[a-zA-Z0-9_-]+$/,
  UPPER_CODE: /^[A-Z0-9-]+$/,
  PHONE: /^[0-9+\-\s]+$/,
} as const;

export const VALIDATION_MAX_LEN = {
  DOC_ID: 128,
  STORE_NAME: 100,
  NPWP: 32,
  FOOTER_NOTE: 240,
  BRANCH_CODE: 20,
  BRANCH_NAME: 100,
  CITY: 80,
  ADDRESS: 240,
  PHONE: 30,
  SKU: 40,
  ITEM_NAME: 120,
  NOTES: 200,
  SCALE_SOURCE: 60,
} as const;

export function makeSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function clampText(value: string, maxLength: number, fallback = ''): string {
  const trimmed = value.trim();
  if (!trimmed && fallback) return fallback.slice(0, maxLength);
  return trimmed.slice(0, maxLength);
}

export function sanitizeUpperCode(value: string, maxLength: number, fallback: string): string {
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
  return cleaned.length >= 1 ? cleaned : fallback;
}

export function sanitizePhone(value: string): string {
  const cleaned = value.replace(/[^0-9+\-\s]/g, '').trim().slice(0, VALIDATION_MAX_LEN.PHONE);
  return cleaned.length >= 3 ? cleaned : '08120000000';
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const KARAT_SPECS: Array<{ karat: KaratCode; label: string; purityPercent: number }> = [
  { karat: '24K', label: 'Logam Mulia / Emas Murni', purityPercent: 99.99 },
  { karat: '23K', label: 'Emas Tua Spesial', purityPercent: 95.8 },
  { karat: '22K', label: 'Perhiasan Premium (916)', purityPercent: 91.6 },
  { karat: '20K', label: 'Perhiasan Emas Tua (833)', purityPercent: 83.3 },
  { karat: '18K', label: 'Standar Internasional (750)', purityPercent: 75.0 },
  { karat: '17K', label: 'Perhiasan Toko (700)', purityPercent: 70.0 },
  { karat: '16K', label: 'Perhiasan Menengah (666)', purityPercent: 66.6 },
  { karat: '9K', label: 'Emas Muda (375)', purityPercent: 37.5 },
  { karat: '8K', label: 'Emas Muda Ekonomis (333)', purityPercent: 33.3 },
];

export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  logam_mulia: 'Logam Mulia (Batangan)',
  cincin: 'Cincin',
  kalung: 'Kalung',
  gelang: 'Gelang',
  anting: 'Anting',
  liontin: 'Liontin',
  leburan: 'Bahan Leburan / Rosok',
};

export function getPurityForKarat(karat: KaratCode): number {
  return KARAT_SPECS.find((k) => k.karat === karat)?.purityPercent ?? 70.0;
}

export function computeKaratPriceMatrix(
  liveSpot24kPerGram: number,
  sellMarginPercent: number,
  buybackSpreadPerGram: number,
  manualSpot24kOverride = 0
): KaratPriceRow[] {
  const base24k = manualSpot24kOverride > 0 ? manualSpot24kOverride : liveSpot24kPerGram;
  const safeMargin = clampNumber(sellMarginPercent, 0, 50);
  const safeSpread = clampNumber(buybackSpreadPerGram, 0, 500000);

  return KARAT_SPECS.map((spec) => {
    const ratio = spec.purityPercent / 99.99;
    const rawSpot = base24k * ratio;
    const spotPerGram = Math.round(rawSpot / 500) * 500;
    const sellPerGram = Math.round((spotPerGram * (1 + safeMargin / 100)) / 1000) * 1000;
    const scaledSpread = Math.round(safeSpread * ratio);
    const buybackPerGram = Math.max(
      10000,
      Math.round((spotPerGram - scaledSpread) / 1000) * 1000
    );

    return {
      karat: spec.karat,
      label: spec.label,
      purityPercent: spec.purityPercent,
      spotPerGram,
      sellPerGram,
      buybackPerGram,
    };
  });
}

/**
 * Calculates transparent, statutory Indonesian Gold Taxes per PMK No. 48 Tahun 2023.
 * - End-consumer retail Gold Jewelry (Perhiasan) Sales: PPN Besaran Tertentu 1.1% of actual selling price.
 * - 24K Fine Gold Bullion (Logam Mulia) Sales: PPN Exempt (PP 49/2022), PPh Pasal 22 0.25% (with NPWP) or 0.5% (without NPWP).
 * - Customer Buyback (Toko membeli kembali dari konsumen): 0% PPN; PPh 22 applies only above statutory threshold if applicable.
 */
export function calculateOfficialGoldTax(params: {
  txType: 'sale' | 'buyback';
  category: CategoryCode;
  karat: KaratCode;
  dppAmount: number;
  customerHasNpwp: boolean;
}): { ppnAmount: number; pph22Amount: number; taxRuleLabel: string } {
  const { txType, category, karat, dppAmount, customerHasNpwp } = params;
  const cleanDpp = Math.max(0, Math.round(dppAmount));

  if (txType === 'buyback') {
    return {
      ppnAmount: 0,
      pph22Amount: 0,
      taxRuleLabel: 'Buyback Pelanggan (Bebas PPN)',
    };
  }

  if (category === 'logam_mulia' && karat === '24K') {
    const rate = customerHasNpwp ? 0.0025 : 0.005;
    const pph22Amount = Math.round(cleanDpp * rate);
    return {
      ppnAmount: 0,
      pph22Amount,
      taxRuleLabel: customerHasNpwp
        ? 'PMK 48/2023 LM 24K: Bebas PPN · PPh 22 (0,25% NPWP)'
        : 'PMK 48/2023 LM 24K: Bebas PPN · PPh 22 (0,50% Non-NPWP)',
    };
  }

  const ppnAmount = Math.round(cleanDpp * 0.011);
  return {
    ppnAmount,
    pph22Amount: 0,
    taxRuleLabel: 'PMK 48/2023 Emas Perhiasan: PPN Besaran Tertentu 1,1%',
  };
}

export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount || 0));
}

export function formatGrams(grams: number): string {
  return `${(grams || 0).toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  })} gr`;
}

export function formatTimestampId(ts?: { toDate?: () => Date } | string | null): string {
  if (!ts) return '-';
  const date =
    typeof ts === 'string'
      ? new Date(ts)
      : typeof ts.toDate === 'function'
        ? ts.toDate()
        : new Date();
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

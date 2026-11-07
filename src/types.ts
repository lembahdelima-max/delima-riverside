import type { Timestamp } from 'firebase/firestore';

export type NavTab = 'dashboard' | 'pos' | 'inventory' | 'customers' | 'reports' | 'settings';

export type KaratCode = '24K' | '23K' | '22K' | '20K' | '18K' | '17K' | '16K' | '9K' | '8K';

export type CategoryCode =
  | 'cincin'
  | 'kalung'
  | 'gelang'
  | 'anting'
  | 'liontin'
  | 'logam_mulia'
  | 'leburan';

export type PaymentMethod = 'tunai' | 'transfer' | 'qris' | 'debit';

export interface GoldMarketFeed {
  xauUsdPerOz: number;
  usdIdrRate: number;
  spot24kPerGramIdr: number;
  change24hPercent: number;
  source: string;
  updatedAt: string;
}

export interface KaratPriceRow {
  karat: KaratCode;
  label: string;
  purityPercent: number;
  spotPerGram: number;
  sellPerGram: number;
  buybackPerGram: number;
}

export interface StoreSetting {
  ownerId: string;
  storeName: string;
  npwpStore: string;
  sellMarginPercent: number;
  buybackSpreadPerGram: number;
  manualSpot24kOverride: number;
  receiptFooterNote: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Branch {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  managerName: string;
  monthlyOperationalCost: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface InventoryItem {
  id: string;
  ownerId: string;
  branchId: string;
  sku: string;
  name: string;
  category: CategoryCode;
  karat: KaratCode;
  purityPercent: number;
  weightGrams: number;
  costPerGram: number;
  makingCharge: number;
  status: 'available' | 'sold' | 'melting';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Customer {
  id: string;
  ownerId: string;
  branchId: string;
  name: string;
  phone: string;
  hasNpwp: boolean;
  npwpNumber: string;
  tier: 'reguler' | 'prioritas' | 'vip';
  totalTransactionsCount: number;
  totalWeightGrams: number;
  loyaltyPoints: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface PriceAlert {
  id: string;
  ownerId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  karat: KaratCode;
  alertType: 'buy_below' | 'sell_above';
  targetPricePerGram: number;
  status: 'active' | 'notified' | 'cancelled';
  notes: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface GoldTransaction {
  id: string;
  ownerId: string;
  branchId: string;
  branchName: string;
  invoiceNumber: string;
  txType: 'sale' | 'buyback';
  customerId: string;
  customerName: string;
  customerHasNpwp: boolean;
  inventoryItemId: string;
  sku: string;
  itemName: string;
  category: CategoryCode;
  karat: KaratCode;
  purityPercent: number;
  weightGrams: number;
  scaleSource: string;
  pricePerGram: number;
  costPerGram: number;
  makingCharge: number;
  deductionAmount: number;
  dppAmount: number;
  ppnAmount: number;
  pph22Amount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  status: 'completed' | 'voided';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StockTransfer {
  id: string;
  ownerId: string;
  inventoryItemId: string;
  sku: string;
  itemName: string;
  karat: KaratCode;
  weightGrams: number;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  notes: string;
  status: 'completed';
  createdAt?: Timestamp;
}

export type ScaleConnectionMode =
  | 'disconnected'
  | 'web_serial'
  | 'web_bluetooth'
  | 'web_hid'
  | 'keyboard_wedge'
  | 'websocket_bridge'
  | 'bench_calibrator';

export interface ScaleSerialConfig {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  brandPreset: string;
}

export interface ScaleState {
  mode: ScaleConnectionMode;
  deviceName: string;
  rawGrossGrams: number;
  tareGrams: number;
  netGrams: number;
  isStable: boolean;
  lastRawFrame: string;
  errorMessage: string | null;
}

export interface PrinterState {
  connected: boolean;
  deviceName: string;
  paperWidthMm: 58 | 80;
  errorMessage: string | null;
}

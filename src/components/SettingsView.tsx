import {
  Bluetooth,
  Cable,
  Check,
  Clock,
  Download,
  FileJson,
  Keyboard,
  Network,
  Plus,
  Printer,
  Scale,
  Store,
  Usb,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createBranch, upsertStoreSettings } from '../services/firestoreService';
import {
  printerService,
  SCALE_BRAND_PRESETS,
  scaleService,
} from '../services/hardwareService';
import type {
  Branch,
  Customer,
  GoldTransaction,
  InventoryItem,
  PriceAlert,
  PrinterState,
  ScaleSerialConfig,
  ScaleState,
  StockTransfer,
  StoreSetting,
} from '../types';
import { formatRupiah } from '../utils/goldMath';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getBackupStorageKey(uid: string): string {
  return `aurumpos_last_backup_at_${uid}`;
}

function readStoredBackupTimestamp(uid: string): string | null {
  try {
    return window.localStorage.getItem(getBackupStorageKey(uid));
  } catch {
    return null;
  }
}

function serializeFirestoreValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;

  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp.toDate === 'function') {
    return maybeTimestamp.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFirestoreValue(entry));
  }

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = serializeFirestoreValue(nested);
  }
  return output;
}

interface SettingsViewProps {
  uid: string;
  storeSetting: StoreSetting;
  hasSavedSetting: boolean;
  branches: Branch[];
  inventory: InventoryItem[];
  customers: Customer[];
  alerts: PriceAlert[];
  transactions: GoldTransaction[];
  transfers: StockTransfer[];
  scaleState: ScaleState;
  printerState: PrinterState;
}

export function SettingsView({
  uid,
  storeSetting,
  hasSavedSetting,
  branches,
  inventory,
  customers,
  alerts,
  transactions,
  transfers,
  scaleState,
  printerState,
}: SettingsViewProps) {
  // Store Pricing & Identity State
  const [storeName, setStoreName] = useState(storeSetting.storeName);
  const [npwpStore, setNpwpStore] = useState(storeSetting.npwpStore);
  const [sellMarginPercent, setSellMarginPercent] = useState(storeSetting.sellMarginPercent);
  const [buybackSpreadPerGram, setBuybackSpreadPerGram] = useState(
    storeSetting.buybackSpreadPerGram
  );
  const [manualSpotOverride, setManualSpotOverride] = useState(
    storeSetting.manualSpot24kOverride
  );
  const [receiptFooterNote, setReceiptFooterNote] = useState(storeSetting.receiptFooterNote);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setStoreName(storeSetting.storeName);
    setNpwpStore(storeSetting.npwpStore);
    setSellMarginPercent(storeSetting.sellMarginPercent);
    setBuybackSpreadPerGram(storeSetting.buybackSpreadPerGram);
    setManualSpotOverride(storeSetting.manualSpot24kOverride);
    setReceiptFooterNote(storeSetting.receiptFooterNote);
  }, [storeSetting]);

  // Digital Scale Serial Config
  const [selectedPresetId, setSelectedPresetId] = useState(SCALE_BRAND_PRESETS[0].id);
  const [serialConfig, setSerialConfig] = useState<ScaleSerialConfig>({
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    brandPreset: SCALE_BRAND_PRESETS[0].label,
  });
  const [wsBridgeUrl, setWsBridgeUrl] = useState('ws://127.0.0.1:8765');

  // Add Branch Modal
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [brCode, setBrCode] = useState('BDG-01');
  const [brName, setBrName] = useState('');
  const [brCity, setBrCity] = useState('');
  const [brAddress, setBrAddress] = useState('');
  const [brPhone, setBrPhone] = useState('022-');
  const [brManager, setBrManager] = useState('');
  const [brOpCost, setBrOpCost] = useState<number>(15000000);
  const [savingBranch, setSavingBranch] = useState(false);

  // 7-Day Workspace Manual JSON Backup State
  const [lastBackupIso, setLastBackupIso] = useState<string | null>(() =>
    readStoredBackupTimestamp(uid)
  );
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [exportSuccessNotice, setExportSuccessNotice] = useState(false);

  useEffect(() => {
    const storedIso = readStoredBackupTimestamp(uid);
    setLastBackupIso(storedIso);

    const parsedMs = storedIso ? Date.parse(storedIso) : Number.NaN;
    const isOverdue = Number.isNaN(parsedMs) || Date.now() - parsedMs >= SEVEN_DAYS_MS;
    if (isOverdue) {
      setShowBackupModal(true);
    }
  }, [uid]);

  useEffect(() => {
    if (!showBackupModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowBackupModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showBackupModal]);

  const backupStatus = useMemo(() => {
    if (!lastBackupIso) {
      return {
        hasBackup: false,
        isOverdue: true,
        daysSince: null as number | null,
        formattedDate: 'Belum pernah dicadangkan',
      };
    }
    const parsedMs = Date.parse(lastBackupIso);
    if (Number.isNaN(parsedMs)) {
      return {
        hasBackup: false,
        isOverdue: true,
        daysSince: null as number | null,
        formattedDate: 'Belum pernah dicadangkan',
      };
    }
    const elapsedMs = Math.max(0, Date.now() - parsedMs);
    const daysSince = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
    const isOverdue = elapsedMs >= SEVEN_DAYS_MS;
    const formattedDate = new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsedMs));

    return {
      hasBackup: true,
      isOverdue,
      daysSince,
      formattedDate,
    };
  }, [lastBackupIso]);

  const handleExportWorkspaceJson = useCallback(() => {
    const exportedAt = new Date().toISOString();
    const exportPayload = {
      metadata: {
        application: 'AurumPOS',
        schemaVersion: '1.0',
        exportedAt,
        ownerId: uid,
        storeName: storeSetting.storeName,
        recordCounts: {
          branches: branches.length,
          inventory: inventory.length,
          customers: customers.length,
          priceAlerts: alerts.length,
          transactions: transactions.length,
          stockTransfers: transfers.length,
        },
      },
      workspace: {
        storeSetting: serializeFirestoreValue(storeSetting),
        branches: serializeFirestoreValue(branches),
        inventory: serializeFirestoreValue(inventory),
        customers: serializeFirestoreValue(customers),
        priceAlerts: serializeFirestoreValue(alerts),
        transactions: serializeFirestoreValue(transactions),
        stockTransfers: serializeFirestoreValue(transfers),
      },
      localHardwarePreferences: {
        scaleSerialConfig: serialConfig,
        wsBridgeUrl,
        printerPaperWidthMm: printerState.paperWidthMm,
      },
    };

    const jsonContent = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);

    const safeStoreSlug = (storeSetting.storeName || 'AurumPOS')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    const dateStamp = exportedAt.slice(0, 10);

    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `aurumpos-backup-${safeStoreSlug || 'toko'}-${dateStamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(downloadUrl);

    try {
      window.localStorage.setItem(getBackupStorageKey(uid), exportedAt);
    } catch {
      // Ignore storage quota errors in restricted environments
    }

    setLastBackupIso(exportedAt);
    setShowBackupModal(false);
    setExportSuccessNotice(true);
    window.setTimeout(() => setExportSuccessNotice(false), 3500);
  }, [
    alerts,
    branches,
    customers,
    inventory,
    printerState.paperWidthMm,
    serialConfig,
    storeSetting,
    transactions,
    transfers,
    uid,
    wsBridgeUrl,
  ]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await upsertStoreSettings(
        uid,
        {
          storeName,
          npwpStore,
          sellMarginPercent,
          buybackSpreadPerGram,
          manualSpot24kOverride: manualSpotOverride,
          receiptFooterNote,
        },
        hasSavedSetting
      );
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    } finally {
      setSavingSettings(false);
    }
  };

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const found = SCALE_BRAND_PRESETS.find((p) => p.id === presetId);
    if (found) {
      setSerialConfig({
        baudRate: found.baudRate,
        dataBits: found.dataBits,
        stopBits: found.stopBits,
        parity: found.parity,
        brandPreset: found.label,
      });
    }
  };

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBranch(true);
    try {
      await createBranch(uid, {
        code: brCode,
        name: brName,
        city: brCity,
        address: brAddress,
        phone: brPhone,
        managerName: brManager,
        monthlyOperationalCost: brOpCost,
      });
      setBrName('');
      setBrCity('');
      setBrAddress('');
      setBrManager('');
      setShowBranchModal(false);
    } finally {
      setSavingBranch(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Section 0: Local Workspace Manual JSON Backup & 7-Day Status */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-stone-900">
              Cadangan & Ekspor Data Ruang Kerja (Format JSON)
            </h2>
            <p className="text-xs text-stone-600">
              Unduh salinan lengkap pengaturan toko, cabang, inventaris emas, buku pelanggan, dan riwayat transaksi ke perangkat lokal Anda.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-stone-500 tabular-nums">
              <span
                className={
                  backupStatus.isOverdue
                    ? 'font-medium text-amber-800'
                    : 'font-medium text-emerald-700'
                }
              >
                {backupStatus.isOverdue
                  ? 'Perlu cadangan baru (siklus 7 hari)'
                  : 'Cadangan lokal mutakhir'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">Terakhir: {backupStatus.formattedDate}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">
                {branches.length} cabang · {inventory.length} stok · {transactions.length} transaksi ·{' '}
                {customers.length} pelanggan
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowBackupModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0"
            >
              <Clock className="h-3.5 w-3.5 text-stone-500" />
              <span>Ringkasan Cadangan</span>
            </button>
            <button
              type="button"
              onClick={handleExportWorkspaceJson}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
            >
              {exportSuccessNotice ? (
                <Check className="h-3.5 w-3.5 text-white" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>
                {exportSuccessNotice ? 'Berkas JSON Terunduh' : 'Ekspor Cadangan JSON'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Section 1: Universal Digital Scale Integration */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Integrasi Timbangan Digital Universal (Segala Merk & Alat Hubung)
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Mendukung Vibra, Sartorius, Mettler Toledo, A&D, Shimadzu, Ohaus, Kern melalui RS-232/USB Serial, Bluetooth BLE, USB HID, Keyboard Wedge, atau LAN Bridge
            </p>
          </div>
          <div className="font-mono text-xs tabular-nums text-stone-700">
            Status: <strong>{scaleState.deviceName}</strong> ({scaleState.netGrams.toFixed(3)} g)
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-7">
            <div>
              <label className="block text-xs font-medium text-stone-700">
                Profil Merk Timbangan Emas (Auto-Parser ASCII & Konversi Unit ct/g/kg/ozt)
              </label>
              <select
                value={selectedPresetId}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
              >
                {SCALE_BRAND_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700">Baud Rate</label>
                <select
                  value={serialConfig.baudRate}
                  onChange={(e) =>
                    setSerialConfig({ ...serialConfig, baudRate: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs"
                >
                  {[1200, 2400, 4800, 9600, 19200, 38400, 115200].map((b) => (
                    <option key={b} value={b}>
                      {b} bps
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700">Data Bits</label>
                <select
                  value={serialConfig.dataBits}
                  onChange={(e) =>
                    setSerialConfig({
                      ...serialConfig,
                      dataBits: Number(e.target.value) as 7 | 8,
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs"
                >
                  <option value={8}>8 Bits</option>
                  <option value={7}>7 Bits</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700">Parity</label>
                <select
                  value={serialConfig.parity}
                  onChange={(e) =>
                    setSerialConfig({
                      ...serialConfig,
                      parity: e.target.value as 'none' | 'even' | 'odd',
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 font-mono text-xs"
                >
                  <option value="none">None (N)</option>
                  <option value="even">Even (E)</option>
                  <option value="odd">Odd (O)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void scaleService.connectWebSerial(serialConfig)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-stone-800 whitespace-nowrap"
              >
                <Cable className="h-3.5 w-3.5" />
                <span>Kabel RS-232 / USB Serial</span>
              </button>

              <button
                type="button"
                onClick={() => void scaleService.connectWebBluetooth()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 whitespace-nowrap"
              >
                <Bluetooth className="h-3.5 w-3.5" />
                <span>Bluetooth BLE</span>
              </button>

              <button
                type="button"
                onClick={() => void scaleService.connectWebHid()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 whitespace-nowrap"
              >
                <Usb className="h-3.5 w-3.5" />
                <span>USB HID POS</span>
              </button>

              <button
                type="button"
                onClick={() => void scaleService.enableKeyboardWedge()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-medium text-stone-800 hover:bg-stone-50 whitespace-nowrap"
              >
                <Keyboard className="h-3.5 w-3.5" />
                <span>Keyboard Wedge</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void scaleService.activateBenchCalibrator(10.0, serialConfig.brandPreset)
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
              >
                <Scale className="h-3.5 w-3.5" />
                <span>Mode Kalibrasi Meja (10.000g)</span>
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={wsBridgeUrl}
                onChange={(e) => setWsBridgeUrl(e.target.value)}
                placeholder="ws://127.0.0.1:8765"
                className="w-60 rounded-lg border border-stone-300 px-3 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => void scaleService.connectWebSocketBridge(wsBridgeUrl)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap"
              >
                <Network className="h-3.5 w-3.5" />
                <span>Hubungkan Jembatan LAN/Wi-Fi</span>
              </button>
            </div>

            {scaleState.errorMessage ? (
              <p className="text-xs text-amber-800">{scaleState.errorMessage}</p>
            ) : null}
          </div>

          {/* Bluetooth Thermal Printer Pairing Column (Single-Elevation Divider) */}
          <div className="border-t border-stone-200 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-900">
                Printer Nota Thermal Bluetooth (ESC/POS)
              </h3>
              <Printer className="h-4 w-4 text-stone-500" />
            </div>
            <p className="mt-1 text-xs text-stone-600">
              Kompatibel dengan printer kasir Bluetooth 58mm & 80mm (Eppos, Codeshop, Panda, Iware, Epson, Xprinter).
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <span className="block text-xs font-medium text-stone-700">Ukuran Kertas</span>
                <div className="mt-1.5 flex gap-2">
                  {([58, 80] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => printerService.setPaperWidth(w)}
                      className={`rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold ${
                        printerState.paperWidthMm === w
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-300 bg-white text-stone-700'
                      }`}
                    >
                      {w}mm
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-stone-600">
                Perangkat aktif: <strong>{printerState.deviceName}</strong>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void printerService.connectBluetooth()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap"
                >
                  <Bluetooth className="h-3.5 w-3.5" />
                  <span>Cari & Sambungkan Printer</span>
                </button>

                <button
                  type="button"
                  onClick={() => void printerService.printTestTicket(storeName)}
                  className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                >
                  Tes Cetak
                </button>

                {printerState.connected ? (
                  <button
                    type="button"
                    onClick={() => printerService.disconnect()}
                    className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs text-stone-600 hover:bg-stone-100"
                  >
                    Putuskan
                  </button>
                ) : null}
              </div>

              {printerState.errorMessage ? (
                <p className="text-xs text-amber-800">{printerState.errorMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Global Store Pricing & Receipt Configuration */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-xl border border-stone-200 bg-white p-6"
      >
        <div className="flex items-center justify-between border-b border-stone-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Identitas Jaringan Toko & Parameter Harga Emas Global
            </h3>
            <p className="mt-0.5 text-xs text-stone-500">
              Perubahan margin otomatis tersinkronisasi ke seluruh layar kasir cabang
            </p>
          </div>
          <button
            type="submit"
            disabled={savingSettings}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50 whitespace-nowrap"
          >
            {savedNotice ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : null}
            <span>{savingSettings ? 'Menyimpan...' : savedNotice ? 'Tersimpan' : 'Simpan Pengaturan'}</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-stone-700">Nama Jaringan Toko Emas</label>
            <input
              type="text"
              required
              maxLength={100}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">NPWP Badan / Pengusaha</label>
            <input
              type="text"
              maxLength={32}
              value={npwpStore}
              onChange={(e) => setNpwpStore(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">
              Margin Harga Jual di Atas Spot (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="50"
              value={sellMarginPercent}
              onChange={(e) => setSellMarginPercent(Number.parseFloat(e.target.value) || 0)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">
              Selisih Buyback Standar 24K (Rp / gr)
            </label>
            <input
              type="number"
              step="1000"
              min="0"
              max="500000"
              value={buybackSpreadPerGram}
              onChange={(e) => setBuybackSpreadPerGram(Number.parseFloat(e.target.value) || 0)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700">
              Patokan Manual Spot 24K (0 = Ikuti Pasar Live)
            </label>
            <input
              type="number"
              step="1000"
              min="0"
              value={manualSpotOverride}
              onChange={(e) => setManualSpotOverride(Number.parseFloat(e.target.value) || 0)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label className="block text-xs font-medium text-stone-700">
              Catatan Jaminan Kaki Surat Emas (Tercetak di Nota Bluetooth)
            </label>
            <input
              type="text"
              maxLength={240}
              value={receiptFooterNote}
              onChange={(e) => setReceiptFooterNote(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </form>

      {/* Section 3: Multi-Branch Network Management */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Manajemen Cabang Toko Fisik ({branches.length} Cabang Aktif)
            </h3>
            <p className="mt-0.5 text-xs text-stone-500">
              Kelola daftar lokasi toko dan beban operasional bulanan per cabang
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowBranchModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah Cabang Baru</span>
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-2.5 pr-3 font-medium">Kode & Nama Cabang</th>
                <th className="py-2.5 px-3 font-medium">Kota & Alamat</th>
                <th className="py-2.5 px-3 font-medium">Kepala Toko · Telepon</th>
                <th className="py-2.5 pl-3 text-right font-medium">Beban Operasional / Bln</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 tabular-nums">
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-stone-50">
                  <td className="py-3 pr-3">
                    <div className="inline-flex items-center gap-1.5 font-semibold text-stone-900">
                      <Store className="h-3.5 w-3.5 text-amber-800" />
                      <span>{b.name}</span>
                    </div>
                    <div className="font-mono text-[11px] text-stone-500">{b.code}</div>
                  </td>
                  <td className="py-3 px-3 text-stone-600">
                    <div className="font-medium text-stone-800">{b.city}</div>
                    <div className="text-[11px]">{b.address}</div>
                  </td>
                  <td className="py-3 px-3 text-stone-600">
                    {b.managerName} · <span className="font-mono">{b.phone}</span>
                  </td>
                  <td className="py-3 pl-3 text-right font-mono font-semibold text-stone-900">
                    {formatRupiah(b.monthlyOperationalCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add Branch Modal */}
      {showBranchModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleAddBranch}
            className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-semibold text-stone-900">Tambah Cabang Toko Fisik</h3>
              <button
                type="button"
                onClick={() => setShowBranchModal(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700">Kode Cabang</label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={brCode}
                    onChange={(e) => setBrCode(e.target.value.toUpperCase())}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700">Kota</label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={brCity}
                    onChange={(e) => setBrCity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700">Nama Cabang</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  placeholder="Cabang Braga Bandung"
                  value={brName}
                  onChange={(e) => setBrName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700">Alamat Lengkap</label>
                <input
                  type="text"
                  required
                  maxLength={240}
                  value={brAddress}
                  onChange={(e) => setBrAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700">Kepala Toko</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={brManager}
                    onChange={(e) => setBrManager(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block font-medium text-stone-700">Telepon</label>
                  <input
                    type="text"
                    required
                    maxLength={30}
                    value={brPhone}
                    onChange={(e) => setBrPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700">
                  Estimasi Beban Operasional Bulanan (Rp)
                </label>
                <input
                  type="number"
                  min="0"
                  step="500000"
                  value={brOpCost}
                  onChange={(e) => setBrOpCost(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBranchModal(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingBranch}
                className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {savingBranch ? 'Menyimpan...' : 'Tambah Cabang'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* 7-Day Local Workspace Manual JSON Backup Prompt Modal */}
      {showBackupModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
          onClick={() => setShowBackupModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-modal-title"
            className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-4">
              <div className="flex items-center gap-2.5">
                <FileJson className="h-5 w-5 text-amber-700 shrink-0" />
                <div>
                  <h3
                    id="backup-modal-title"
                    className="text-base font-semibold text-stone-900"
                  >
                    Cadangkan Ruang Kerja Toko Anda (JSON)
                  </h3>
                  <p className="text-xs text-stone-500">
                    Pengingat otomatis pencadangan lokal berkala setiap 7 hari
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
                aria-label="Tutup dialog cadangan"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs leading-relaxed text-stone-600">
              <p>
                {!backupStatus.hasBackup ? (
                  <>
                    Anda belum pernah menyimpan salinan cadangan lokal untuk ruang kerja{' '}
                    <strong className="font-semibold text-stone-900">
                      {storeSetting.storeName}
                    </strong>
                    . Kami menyarankan ekspor manual dalam format JSON setidaknya setiap 7 hari agar seluruh catatan pembukuan dan stok emas memiliki salinan arsip mandiri di perangkat Anda.
                  </>
                ) : backupStatus.isOverdue ? (
                  <>
                    Cadangan lokal terakhir diunduh{' '}
                    <strong className="font-mono font-semibold text-amber-800 tabular-nums">
                      {backupStatus.daysSince} hari yang lalu
                    </strong>{' '}
                    (<span className="font-mono tabular-nums">{backupStatus.formattedDate}</span>).
                    Karena sudah melewati batas 7 hari, silakan ekspor salinan JSON terbaru agar arsip toko tetap mutakhir.
                  </>
                ) : (
                  <>
                    Cadangan lokal ruang kerja Anda saat ini masih mutakhir (terakhir diekspor pada{' '}
                    <span className="font-mono font-semibold text-stone-800 tabular-nums">
                      {backupStatus.formattedDate}
                    </span>
                    ). Anda tetap dapat mengunduh berkas JSON terbaru kapan pun dibutuhkan.
                  </>
                )}
              </p>

              <div className="divide-y divide-stone-100 border-y border-stone-200 py-1">
                <div className="flex items-center justify-between py-2">
                  <span className="text-stone-600">Pengaturan Harga & Jaringan Cabang</span>
                  <span className="font-mono font-semibold text-stone-900 tabular-nums">
                    {branches.length} cabang
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-stone-600">Data Inventaris Perhiasan & Logam Mulia</span>
                  <span className="font-mono font-semibold text-stone-900 tabular-nums">
                    {inventory.length} item
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-stone-600">Buku Pelanggan Setia & Notifikasi Harga</span>
                  <span className="font-mono font-semibold text-stone-900 tabular-nums">
                    {customers.length} pelanggan · {alerts.length} alert
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-stone-600">Riwayat Transaksi Kasir & Mutasi Cabang</span>
                  <span className="font-mono font-semibold text-stone-900 tabular-nums">
                    {transactions.length} nota · {transfers.length} mutasi
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-stone-500">
                Berkas JSON akan langsung diunduh ke komputer atau perangkat kasir Anda tanpa mengubah data aktif di server.
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0"
              >
                Ingatkan Nanti
              </button>
              <button
                type="button"
                onClick={handleExportWorkspaceJson}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Ekspor Data JSON Sekarang</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

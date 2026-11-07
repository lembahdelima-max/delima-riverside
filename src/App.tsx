import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  BarChart3,
  Bell,
  Boxes,
  Calculator,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Scale,
  Settings,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import goldShowcaseImg from './assets/images/gold_jewelry_showcase_1793600623039.jpg';
import heroScaleImg from './assets/images/hero_gold_bullion_scale_1793600622615.jpg';
import { CustomersAlertsView } from './components/CustomersAlertsView';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { PosView } from './components/PosView';
import { ReceiptModal } from './components/ReceiptModal';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { auth, signInWithGoogle, signOutUser } from './firebase';
import {
  seedInitialStoreWorkspace,
  subscribeOwnerData,
} from './services/firestoreService';
import { printerService, scaleService } from './services/hardwareService';
import type {
  Branch,
  Customer,
  GoldMarketFeed,
  GoldTransaction,
  InventoryItem,
  NavTab,
  PriceAlert,
  PrinterState,
  ScaleState,
  StockTransfer,
  StoreSetting,
} from './types';
import { computeKaratPriceMatrix, formatRupiah } from './utils/goldMath';

const DEFAULT_STORE_SETTING: StoreSetting = {
  ownerId: '',
  storeName: 'Toko Emas Aurum Mulia',
  npwpStore: '',
  sellMarginPercent: 3.5,
  buybackSpreadPerGram: 45000,
  manualSpot24kOverride: 0,
  receiptFooterNote:
    'Barang telah ditimbang di hadapan pembeli. Simpan Surat Emas ini untuk jaminan buyback di seluruh cabang.',
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Navigation & Responsive Sidebar State
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL');

  // Real-Time Gold Spot Market Feed
  const [marketFeed, setMarketFeed] = useState<GoldMarketFeed | null>(null);
  const [refreshingMarket, setRefreshingMarket] = useState(false);

  // Cloud Firestore Multi-Branch State
  const [dataReady, setDataReady] = useState(false);
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [transactions, setTransactions] = useState<GoldTransaction[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);

  // Hardware State (Scale & Bluetooth Printer)
  const [scaleState, setScaleState] = useState<ScaleState>(scaleService.getState());
  const [printerState, setPrinterState] = useState<PrinterState>(printerService.getState());
  const [receiptModalTx, setReceiptModalTx] = useState<GoldTransaction | null>(null);

  // Image resilience state
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [showcaseImgFailed, setShowcaseImgFailed] = useState(false);

  const fetchGoldPrice = useCallback(async (force = false) => {
    setRefreshingMarket(true);
    try {
      const res = await fetch(`/api/gold-price${force ? '?refresh=1' : ''}`);
      if (res.ok) {
        const data = (await res.json()) as GoldMarketFeed;
        setMarketFeed(data);
      }
    } catch {
      // Keep previous market feed on transient error
    } finally {
      setRefreshingMarket(false);
    }
  }, []);

  useEffect(() => {
    void fetchGoldPrice(false);
    const interval = window.setInterval(() => {
      void fetchGoldPrice(false);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [fetchGoldPrice]);

  useEffect(() => {
    const unsubScale = scaleService.subscribe(setScaleState);
    const unsubPrinter = printerService.subscribe(setPrinterState);
    return () => {
      unsubScale();
      unsubPrinter();
    };
  }, []);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
    });
    return () => unsubAuth();
  }, []);

  const spot24Ref = useRef<number>(1420000);
  useEffect(() => {
    if (marketFeed?.spot24kPerGramIdr && marketFeed.spot24kPerGramIdr > 0) {
      spot24Ref.current = marketFeed.spot24kPerGramIdr;
    }
  }, [marketFeed?.spot24kPerGramIdr]);

  // Seed initial merchant workspace once if needed, then attach real-time Firestore listeners
  useEffect(() => {
    if (!authReady || !user) {
      setDataReady(false);
      return;
    }

    let cancelled = false;
    let unsubData: (() => void) | null = null;

    void (async () => {
      try {
        await seedInitialStoreWorkspace(user.uid, spot24Ref.current);
      } catch (err) {
        console.error('Seed error:', err);
      }

      if (cancelled) return;

      unsubData = subscribeOwnerData(user.uid, {
        onSettings: (s) => {
          if (!cancelled) setStoreSetting(s);
        },
        onBranches: (b) => {
          if (!cancelled) {
            setBranches(b);
            setSelectedBranchId((prev) => {
              if (prev === 'ALL') return 'ALL';
              return b.some((item) => item.id === prev) ? prev : 'ALL';
            });
          }
        },
        onInventory: (i) => !cancelled && setInventory(i),
        onCustomers: (c) => !cancelled && setCustomers(c),
        onAlerts: (a) => !cancelled && setAlerts(a),
        onTransactions: (t) => !cancelled && setTransactions(t),
        onTransfers: (tr) => !cancelled && setTransfers(tr),
        onReady: () => !cancelled && setDataReady(true),
      });
    })();

    return () => {
      cancelled = true;
      if (unsubData) {
        unsubData();
      }
    };
  }, [authReady, user]);

  const effectiveSetting: StoreSetting = storeSetting ?? {
    ...DEFAULT_STORE_SETTING,
    ownerId: user?.uid ?? '',
  };

  const karatMatrix = useMemo(() => {
    const liveSpot = marketFeed?.spot24kPerGramIdr ?? 1420000;
    return computeKaratPriceMatrix(
      liveSpot,
      effectiveSetting.sellMarginPercent,
      effectiveSetting.buybackSpreadPerGram,
      effectiveSetting.manualSpot24kOverride
    );
  }, [
    marketFeed?.spot24kPerGramIdr,
    effectiveSetting.sellMarginPercent,
    effectiveSetting.buybackSpreadPerGram,
    effectiveSetting.manualSpot24kOverride,
  ]);

  const activeBranch = useMemo(() => {
    if (selectedBranchId === 'ALL') return null;
    return branches.find((b) => b.id === selectedBranchId) ?? null;
  }, [branches, selectedBranchId]);

  const triggeredAlertsCount = useMemo(() => {
    return alerts.filter((alert) => {
      if (alert.status !== 'active') return false;
      const row = karatMatrix.find((r) => r.karat === alert.karat);
      if (!row) return false;
      const relevantPrice =
        alert.alertType === 'buy_below' ? row.sellPerGram : row.buybackPerGram;
      return alert.alertType === 'buy_below'
        ? relevantPrice <= alert.targetPricePerGram
        : relevantPrice >= alert.targetPricePerGram;
    }).length;
  }, [alerts, karatMatrix]);

  const handleGoogleLogin = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Gagal masuk dengan Google. Silakan coba kembali.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  const navItems: Array<{
    id: NavTab;
    label: string;
    subtitle: string;
    icon: typeof Calculator;
    alertCount?: number;
  }> = [
    { id: 'dashboard', label: 'Dashboard', subtitle: 'Ringkasan & Grafik', icon: LayoutDashboard },
    { id: 'pos', label: 'POS', subtitle: 'Kasir Jual & Buyback', icon: Calculator },
    { id: 'inventory', label: 'Inventory', subtitle: 'Stok & Mutasi Cabang', icon: Boxes },
    {
      id: 'customers',
      label: 'Pelanggan & Alert',
      subtitle: 'Notifikasi Harga',
      icon: Bell,
      alertCount: triggeredAlertsCount,
    },
    { id: 'reports', label: 'Reports', subtitle: 'Laba Rugi & Pajak', icon: BarChart3 },
    { id: 'settings', label: 'Settings', subtitle: 'Timbangan & Printer', icon: Settings },
  ];

  // Loading state before Firebase Auth initializes
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 text-sm text-stone-600">
        Memuat ruang kerja AurumPOS...
      </div>
    );
  }

  // Unauthenticated Landing & Live Gold Price Board
  if (!user) {
    const row24 = karatMatrix[0];
    return (
      <div className="min-h-screen bg-stone-50 text-stone-900">
        {/* Strict 3-Zone Top Bar Contract */}
        <header className="mx-auto flex max-w-7xl items-center justify-between gap-8 border-b border-stone-200 bg-white px-6 py-4">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-stone-900 whitespace-nowrap shrink-0"
          >
            AurumPOS
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600">
            <a
              href="#harga-live"
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Harga Real-Time
            </a>
            <a
              href="#perangkat"
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Timbangan & Printer
            </a>
            <a
              href="#multi-cabang"
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Multi-Cabang
            </a>
            <a
              href="#pajak-resmi"
              className="hover:text-stone-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Laporan & Pajak
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={signingIn}
              className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              {signingIn ? 'Menghubungkan...' : 'Masuk dengan Google'}
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl space-y-12 px-6 py-10">
          {/* Balanced 2-Column Hero Split */}
          <section className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
            <div className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-8 lg:col-span-6">
              <div>
                <p className="text-xs font-medium text-amber-800">
                  Sistem Kasir & Inventaris Toko Emas Fisik Multi-Cabang
                </p>
                <h1 className="mt-3 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl [text-wrap:balance]">
                  Presisi timbangan digital, harga emas real-time, dan cetak nota Bluetooth dalam satu meja kasir.
                </h1>
                <p className="mt-4 text-base leading-relaxed text-stone-600">
                  Kelola penjualan perhiasan, terima buyback pelanggan, pantau mutasi stok lintas cabang secara langsung, dan cetak Surat Emas ke printer thermal Bluetooth maupun timbangan digital segala merk.
                </p>
              </div>

              <div className="mt-8 space-y-3 border-t border-stone-100 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={signingIn}
                    className="rounded-lg bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-stone-800 disabled:opacity-60 whitespace-nowrap"
                  >
                    {signingIn
                      ? 'Membuka Ruang Kerja...'
                      : 'Masuk & Buka Kasir Multi-Cabang'}
                  </button>
                  <a
                    href="#harga-live"
                    className="rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap"
                  >
                    Cek Tabel Kadar 24K–8K
                  </a>
                </div>
                {authError ? <p className="text-xs text-red-700">{authError}</p> : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 lg:col-span-6">
              {!heroImgFailed ? (
                <img
                  src={heroScaleImg}
                  alt="Timbangan analitik digital presisi dan emas batangan 24 karat di meja toko emas"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="h-full min-h-[300px] w-full object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center bg-stone-900 p-8 text-stone-200">
                  <Scale className="h-10 w-10 text-amber-400" />
                  <span className="mt-3 font-mono text-sm">
                    Integrasi Timbangan Analitik Presisi 0.001g
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Full-Width Live Gold Spot KPI Strip */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Acuan Spot 24K Murni / gr</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-stone-900">
                {formatRupiah(row24?.spotPerGram ?? 1420000)}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                {marketFeed ? marketFeed.source : 'Memuat pasar spot...'}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Harga Jual Toko 24K / gr</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-800">
                {formatRupiah(row24?.sellPerGram ?? 1470000)}
              </div>
              <div className="mt-1 text-xs text-stone-500">Margin ritel standar 3,5%</div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Terima Buyback 24K / gr</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-stone-900">
                {formatRupiah(row24?.buybackPerGram ?? 1375000)}
              </div>
              <div className="mt-1 text-xs text-stone-500">Siap hitung otomatis dengan timbangan</div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Spot Dunia & Kurs USD/IDR</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-stone-900">
                ${marketFeed ? marketFeed.xauUsdPerOz.toLocaleString('en-US') : '2,745.50'}
              </div>
              <div className="mt-1 font-mono text-xs tabular-nums text-stone-500">
                USD/IDR Rp {marketFeed ? marketFeed.usdIdrRate.toLocaleString('id-ID') : '15.850'}
              </div>
            </div>
          </section>

          {/* Live Public Gold Karat Reference Table */}
          <section
            id="harga-live"
            className="rounded-xl border border-stone-200 bg-white p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-stone-900">
                  Bảng Harga Emas Real-Time Seluruh Kadar (24K hingga 8K)
                </h2>
                <p className="text-xs text-stone-500">
                  Diperbarui otomatis dari pasar spot XAU/USD dan nilai tukar Rupiah terkini
                </p>
              </div>
              <button
                type="button"
                onClick={() => void fetchGoldPrice(true)}
                disabled={refreshingMarket}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingMarket ? 'animate-spin' : ''}`} />
                <span>Segarkan Harga</span>
              </button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="py-2.5 pr-3 font-medium">Kadar</th>
                    <th className="py-2.5 px-3 font-medium">Keterangan Standar Toko</th>
                    <th className="py-2.5 px-3 text-right font-medium">Kemurnian</th>
                    <th className="py-2.5 px-3 text-right font-medium">Acuan Spot / gr</th>
                    <th className="py-2.5 px-3 text-right font-medium">Harga Jual / gr</th>
                    <th className="py-2.5 pl-3 text-right font-medium">Terima Buyback / gr</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-mono tabular-nums">
                  {karatMatrix.map((row) => (
                    <tr key={row.karat} className="hover:bg-stone-50">
                      <td className="py-2.5 pr-3 font-sans font-semibold text-stone-900">
                        {row.karat}
                      </td>
                      <td className="py-2.5 px-3 font-sans text-stone-600">{row.label}</td>
                      <td className="py-2.5 px-3 text-right text-stone-600">
                        {row.purityPercent}%
                      </td>
                      <td className="py-2.5 px-3 text-right text-stone-500">
                        {formatRupiah(row.spotPerGram)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold text-stone-900">
                        {formatRupiah(row.sellPerGram)}
                      </td>
                      <td className="py-2.5 pl-3 text-right font-medium text-amber-800">
                        {formatRupiah(row.buybackPerGram)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Hardware & Compliance Feature Section */}
          <section
            id="perangkat"
            className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12"
          >
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-100 lg:col-span-5">
              {!showcaseImgFailed ? (
                <img
                  src={goldShowcaseImg}
                  alt="Koleksi kalung dan gelang emas di baki beludru etalase toko emas fisik"
                  referrerPolicy="no-referrer"
                  onError={() => setShowcaseImgFailed(true)}
                  className="h-full min-h-[240px] w-full object-cover"
                />
              ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center bg-stone-200 text-xs text-stone-600">
                  Manajemen Etalase Perhiasan Multi-Cabang
                </div>
              )}
            </div>

            <div
              id="multi-cabang"
              className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-8 lg:col-span-7"
            >
              <div className="space-y-5">
                <div>
                  <h3 className="text-lg font-semibold text-stone-900">
                    01. Koneksi Timbangan Digital & Printer Bluetooth
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Terhubung langsung dengan timbangan analitik Vibra, Sartorius, Mettler Toledo, A&D, Shimadzu, hingga Ohaus melalui kabel RS-232/USB Serial, Bluetooth BLE, USB HID, dan Keyboard Wedge, serta mencetak Surat Emas ke printer thermal 58mm/80mm.
                  </p>
                </div>

                <div id="pajak-resmi" className="border-t border-stone-100 pt-5">
                  <h3 className="text-lg font-semibold text-stone-900">
                    02. Sinkronisasi Multi-Cabang, Laba Rugi & Kepatuhan Pajak PMK 48/2023
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Memisahkan tampilan analisis Laba Rugi Operasional internal (HPP, ongkos bikin, beban cabang) dan Rekapitulasi Pajak Resmi (PPN Perhiasan 1,1% & PPh Pasal 22 Logam Mulia) secara transparan berdasarkan 100% nilai transaksi sesungguhnya.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ==========================================================================
  // Authenticated Responsive Sidebar Layout (POS, Inventory, Alerts, Reports, Settings)
  // ==========================================================================
  const currentNavMeta = navItems.find((n) => n.id === activeTab) ?? navItems[0];

  return (
    <div className="flex min-h-screen bg-stone-50 text-stone-900">
      {/* Mobile Sidebar Scrim */}
      {mobileMenuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-stone-950/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}

      {/* Responsive Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col justify-between border-r border-stone-200 bg-white transition-transform duration-150 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="flex h-16 items-center justify-between border-b border-stone-200 px-5">
            <span className="text-base font-bold tracking-tight text-stone-900 truncate">
              {effectiveSetting.storeName}
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100 lg:hidden"
              aria-label="Tutup navigasi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Primary Navigation Links */}
          <nav className="space-y-1 p-3" aria-label="Menu Utama">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-stone-900 text-white'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-amber-400' : 'text-stone-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold leading-tight whitespace-nowrap truncate">
                        {item.label}
                      </div>
                      <div
                        className={`text-[11px] leading-tight whitespace-nowrap truncate ${
                          isActive ? 'text-stone-300' : 'text-stone-500'
                        }`}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  {item.alertCount && item.alertCount > 0 ? (
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        isActive ? 'text-amber-400' : 'text-amber-800'
                      }`}
                    >
                      {item.alertCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Account & Hardware Summary Footer */}
        <div className="border-t border-stone-200 p-4 space-y-3">
          <div className="text-xs text-stone-600 space-y-1">
            <div className="truncate font-medium text-stone-900">
              {user.displayName || user.email}
            </div>
            <div className="truncate text-[11px] text-stone-500">
              Timbangan: {scaleState.netGrams.toFixed(2)} g · Printer:{' '}
              {printerState.connected ? 'Aktif' : 'Siaga'}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOutUser()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Keluar Akun</span>
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* SaaS Workspace Header (Breadcrumb on Left, Branch Selector + Live 24K Action on Right) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-stone-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg border border-stone-200 p-2 text-stone-700 hover:bg-stone-100 lg:hidden"
              aria-label="Buka menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-stone-500 whitespace-nowrap">AurumPOS</span>
              <span className="hidden sm:inline text-stone-300">/</span>
              <span className="font-semibold text-stone-900 whitespace-nowrap truncate">
                {currentNavMeta.label} — {currentNavMeta.subtitle}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Multi-Branch Context Switcher */}
            <select
              aria-label="Pilih Cabang Aktif"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="max-w-[210px] truncate rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-800 focus:border-amber-700 focus:bg-white focus:outline-none"
            >
              <option value="ALL">Semua Cabang (Konsolidasi)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>

            {/* Live 24K Benchmark Action */}
            <button
              type="button"
              onClick={() => void fetchGoldPrice(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3.5 py-1.5 font-mono text-xs font-semibold tabular-nums text-white hover:bg-stone-800 whitespace-nowrap shrink-0"
              title="Klik untuk perbarui harga emas dunia real-time"
            >
              <RefreshCw className={`h-3 w-3 text-amber-400 ${refreshingMarket ? 'animate-spin' : ''}`} />
              <span>24K: {formatRupiah(karatMatrix[0]?.sellPerGram ?? 0)}/gr</span>
            </button>
          </div>
        </header>

        {/* Active Module Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1400px] w-full mx-auto">
          {!dataReady ? (
            <div className="space-y-4">
              <div className="h-28 animate-pulse rounded-xl border border-stone-200 bg-white" />
              <div className="h-96 animate-pulse rounded-xl border border-stone-200 bg-white" />
            </div>
          ) : (
            <>
              {activeTab === 'dashboard' ? (
                <DashboardView
                  activeBranch={activeBranch}
                  branches={branches}
                  inventory={inventory}
                  transactions={transactions}
                  alerts={alerts}
                  karatMatrix={karatMatrix}
                  onNavigate={(tab, branchId) => {
                    if (branchId) setSelectedBranchId(branchId);
                    setActiveTab(tab);
                  }}
                />
              ) : null}

              {activeTab === 'pos' ? (
                <PosView
                  uid={user.uid}
                  activeBranch={activeBranch}
                  branches={branches}
                  inventory={inventory}
                  customers={customers}
                  transactions={transactions}
                  karatMatrix={karatMatrix}
                  marketFeed={marketFeed}
                  refreshingMarket={refreshingMarket}
                  onRefreshMarket={() => void fetchGoldPrice(true)}
                  scaleState={scaleState}
                  printerState={printerState}
                  storeSetting={effectiveSetting}
                  onOpenReceipt={(tx) => setReceiptModalTx(tx)}
                  onGoToHardwareSettings={() => setActiveTab('settings')}
                />
              ) : null}

              {activeTab === 'inventory' ? (
                <InventoryView
                  uid={user.uid}
                  activeBranch={activeBranch}
                  branches={branches}
                  inventory={inventory}
                  transfers={transfers}
                  karatMatrix={karatMatrix}
                  scaleState={scaleState}
                />
              ) : null}

              {activeTab === 'customers' ? (
                <CustomersAlertsView
                  uid={user.uid}
                  activeBranch={activeBranch}
                  branches={branches}
                  customers={customers}
                  alerts={alerts}
                  karatMatrix={karatMatrix}
                  storeSetting={effectiveSetting}
                />
              ) : null}

              {activeTab === 'reports' ? (
                <ReportsView
                  activeBranch={activeBranch}
                  branches={branches}
                  transactions={transactions}
                  storeSetting={effectiveSetting}
                  onOpenReceipt={(tx) => setReceiptModalTx(tx)}
                />
              ) : null}

              {activeTab === 'settings' ? (
                <SettingsView
                  uid={user.uid}
                  storeSetting={effectiveSetting}
                  hasSavedSetting={Boolean(storeSetting)}
                  branches={branches}
                  inventory={inventory}
                  customers={customers}
                  alerts={alerts}
                  transactions={transactions}
                  transfers={transfers}
                  scaleState={scaleState}
                  printerState={printerState}
                />
              ) : null}
            </>
          )}
        </main>
      </div>

      {/* Bluetooth & Printable Receipt Modal */}
      <ReceiptModal
        transaction={receiptModalTx}
        storeSetting={effectiveSetting}
        printerState={printerState}
        onClose={() => setReceiptModalTx(null)}
      />
    </div>
  );
}

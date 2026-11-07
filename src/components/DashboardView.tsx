import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Award,
  Boxes,
  Calculator,
  TrendingUp,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Branch,
  GoldTransaction,
  InventoryItem,
  KaratPriceRow,
  NavTab,
  PriceAlert,
} from '../types';
import { CATEGORY_LABELS, formatGrams, formatRupiah } from '../utils/goldMath';

interface DashboardViewProps {
  activeBranch: Branch | null;
  branches: Branch[];
  inventory: InventoryItem[];
  transactions: GoldTransaction[];
  alerts: PriceAlert[];
  karatMatrix: KaratPriceRow[];
  onNavigate: (tab: NavTab, branchId?: string) => void;
}

interface DailyPoint {
  dateKey: string;
  label: string;
  salesIdr: number;
  buybackIdr: number;
  salesGrams: number;
  buybackGrams: number;
  txCount: number;
}

interface LowStockEntry {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  title: string;
  detail: string;
  availableGrams: number;
  skuCount: number;
  severity: 'critical' | 'low';
}

function formatCompactIdr(value: number): string {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}jt`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}rb`;
  }
  return String(value);
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function DashboardView({
  activeBranch,
  branches,
  inventory,
  transactions,
  alerts,
  karatMatrix,
  onNavigate,
}: DashboardViewProps) {
  const [daysWindow, setDaysWindow] = useState<7 | 14 | 30>(7);
  const [chartMetric, setChartMetric] = useState<'idr' | 'grams'>('idr');
  const [lowStockThresholdGrams, setLowStockThresholdGrams] = useState<10 | 20 | 50>(20);

  const effectiveThreshold = lowStockThresholdGrams;

  const validTransactions = useMemo(
    () => transactions.filter((tx) => tx.status === 'completed'),
    [transactions]
  );

  const scopedTransactions = useMemo(
    () =>
      activeBranch
        ? validTransactions.filter((tx) => tx.branchId === activeBranch.id)
        : validTransactions,
    [validTransactions, activeBranch]
  );

  // 1. Daily Sales & Buyback Time-Series for Recharts AreaChart
  const dailySeries = useMemo<DailyPoint[]>(() => {
    const now = new Date();
    const map = new Map<string, DailyPoint>();

    for (let i = daysWindow - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = toLocalDateKey(d);
      const label = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'short',
      }).format(d);
      map.set(key, {
        dateKey: key,
        label,
        salesIdr: 0,
        buybackIdr: 0,
        salesGrams: 0,
        buybackGrams: 0,
        txCount: 0,
      });
    }

    for (const tx of scopedTransactions) {
      const txDate = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date();
      const key = toLocalDateKey(txDate);
      const bucket = map.get(key);
      if (bucket) {
        bucket.txCount += 1;
        if (tx.txType === 'sale') {
          bucket.salesIdr += tx.dppAmount;
          bucket.salesGrams = Number((bucket.salesGrams + tx.weightGrams).toFixed(3));
        } else {
          bucket.buybackIdr += tx.totalAmount;
          bucket.buybackGrams = Number((bucket.buybackGrams + tx.weightGrams).toFixed(3));
        }
      }
    }

    return Array.from(map.values());
  }, [scopedTransactions, daysWindow]);

  // Today's & Window KPIs
  const todayStats = useMemo(() => {
    const todayKey = toLocalDateKey(new Date());
    const todayPoint = dailySeries.find((p) => p.dateKey === todayKey);
    const windowSalesIdr = dailySeries.reduce((sum, p) => sum + p.salesIdr, 0);
    const windowSalesGrams = dailySeries.reduce((sum, p) => sum + p.salesGrams, 0);
    const windowBuybackIdr = dailySeries.reduce((sum, p) => sum + p.buybackIdr, 0);
    const windowBuybackGrams = dailySeries.reduce((sum, p) => sum + p.buybackGrams, 0);

    return {
      todaySalesIdr: todayPoint?.salesIdr ?? 0,
      todaySalesGrams: todayPoint?.salesGrams ?? 0,
      todayTxCount: todayPoint?.txCount ?? 0,
      windowSalesIdr,
      windowSalesGrams,
      windowBuybackIdr,
      windowBuybackGrams,
    };
  }, [dailySeries]);

  // 2. Top-Performing Branches Data for Recharts BarChart
  const branchPerformance = useMemo(() => {
    return branches
      .map((branch) => {
        const bTxs = validTransactions.filter((tx) => tx.branchId === branch.id);
        let salesIdr = 0;
        let salesGrams = 0;
        let grossProfitIdr = 0;
        let txCount = 0;

        for (const tx of bTxs) {
          txCount += 1;
          if (tx.txType === 'sale') {
            salesIdr += tx.dppAmount;
            salesGrams += tx.weightGrams;
            grossProfitIdr += tx.dppAmount - Math.round(tx.weightGrams * tx.costPerGram);
          }
        }

        return {
          branchId: branch.id,
          code: branch.code,
          name: branch.name,
          shortName: branch.name.replace(/^Cabang\s+/i, ''),
          city: branch.city,
          salesIdr,
          salesGrams: Number(salesGrams.toFixed(2)),
          grossProfitIdr,
          txCount,
        };
      })
      .sort((a, b) => b.salesIdr - a.salesIdr);
  }, [branches, validTransactions]);

  const topBranch = branchPerformance[0] ?? null;

  // 3. Low-Stock Alerts Evaluation (Branch Bullion Gaps + Low-Grammage Stock)
  const lowStockAlerts = useMemo<LowStockEntry[]>(() => {
    const entries: LowStockEntry[] = [];
    const targetBranches = activeBranch ? [activeBranch] : branches;

    for (const branch of targetBranches) {
      const branchAvailable = inventory.filter(
        (i) => i.branchId === branch.id && i.status === 'available'
      );

      // Check 1: 24K Bullion (Logam Mulia) availability per branch
      const lmItems = branchAvailable.filter(
        (i) => i.category === 'logam_mulia' || i.karat === '24K'
      );
      const lmWeight = lmItems.reduce((s, i) => s + i.weightGrams, 0);
      if (lmItems.length === 0) {
        entries.push({
          id: `gap_lm_${branch.id}`,
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          title: 'Stok Logam Mulia 24K Kosong',
          detail: '0 SKU batangan tersedia di brankas cabang',
          availableGrams: 0,
          skuCount: 0,
          severity: 'critical',
        });
      } else if (lmWeight < effectiveThreshold) {
        entries.push({
          id: `low_lm_${branch.id}`,
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          title: 'Cadangan Logam Mulia 24K Menipis',
          detail: `${lmItems.length} SKU tersisa di bawah batas ${effectiveThreshold} gr`,
          availableGrams: Number(lmWeight.toFixed(2)),
          skuCount: lmItems.length,
          severity: 'low',
        });
      }

      // Check 2: Jewelry (Perhiasan) total stock per branch
      const jewelryItems = branchAvailable.filter((i) => i.category !== 'logam_mulia');
      const jewelryWeight = jewelryItems.reduce((s, i) => s + i.weightGrams, 0);
      if (jewelryItems.length === 0) {
        entries.push({
          id: `gap_jwl_${branch.id}`,
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          title: 'Etalase Perhiasan Emas Kosong',
          detail: 'Belum ada cincin/kalung/gelang siap jual di cabang ini',
          availableGrams: 0,
          skuCount: 0,
          severity: 'critical',
        });
      } else if (jewelryWeight < effectiveThreshold) {
        entries.push({
          id: `low_jwl_${branch.id}`,
          branchId: branch.id,
          branchName: branch.name,
          branchCode: branch.code,
          title: 'Total Berat Perhiasan Etalase Rendah',
          detail: `${jewelryItems.length} unit perhiasan (${formatGrams(jewelryWeight)}) < ${effectiveThreshold} gr`,
          availableGrams: Number(jewelryWeight.toFixed(2)),
          skuCount: jewelryItems.length,
          severity: 'low',
        });
      }

      // Check 3: Individual category/SKU low-weight items (< 5g) for quick restock visibility
      for (const item of branchAvailable) {
        if (item.weightGrams < Math.min(6, effectiveThreshold / 2)) {
          entries.push({
            id: `sku_${item.id}`,
            branchId: branch.id,
            branchName: branch.name,
            branchCode: branch.code,
            title: `${CATEGORY_LABELS[item.category]} ${item.karat} (${item.sku})`,
            detail: `${item.name} — stok tunggal gramasi kecil`,
            availableGrams: item.weightGrams,
            skuCount: 1,
            severity: 'low',
          });
        }
      }
    }

    return entries.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return a.availableGrams - b.availableGrams;
    });
  }, [activeBranch, branches, inventory, effectiveThreshold]);

  const triggeredCustomerAlertsCount = useMemo(() => {
    return alerts.filter((a) => {
      if (a.status !== 'active') return false;
      const row = karatMatrix.find((r) => r.karat === a.karat);
      if (!row) return false;
      const price = a.alertType === 'buy_below' ? row.sellPerGram : row.buybackPerGram;
      return a.alertType === 'buy_below'
        ? price <= a.targetPricePerGram
        : price >= a.targetPricePerGram;
    }).length;
  }, [alerts, karatMatrix]);

  return (
    <div className="space-y-6">
      {/* Executive Action Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div>
          <h1 className="text-base font-semibold text-stone-900">
            Ringkasan Eksekutif {activeBranch ? `— ${activeBranch.name}` : '— Konsolidasi Seluruh Cabang'}
          </h1>
          <p className="mt-0.5 text-xs text-stone-500">
            Pemantauan langsung volume penjualan harian, peringkat kinerja toko cabang, dan peringatan ketersediaan stok emas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {triggeredCustomerAlertsCount > 0 ? (
            <button
              type="button"
              onClick={() => onNavigate('customers')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
            >
              <span>{triggeredCustomerAlertsCount} Target Harga Pelanggan Tercapai</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 whitespace-nowrap shrink-0"
          >
            <Calculator className="h-3.5 w-3.5" />
            <span>Buka Kasir POS</span>
          </button>
        </div>
      </div>

      {/* 4-Column Executive KPI Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>Penjualan Hari Ini</span>
            <TrendingUp className="h-4 w-4 text-emerald-700" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatRupiah(todayStats.todaySalesIdr)}
          </div>
          <div className="mt-1 text-xs text-stone-500 tabular-nums">
            {formatGrams(todayStats.todaySalesGrams)} terjual · {todayStats.todayTxCount} transaksi
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>Volume {daysWindow} Hari Terakhir</span>
            <ArrowUpRight className="h-4 w-4 text-amber-700" />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatRupiah(todayStats.windowSalesIdr)}
          </div>
          <div className="mt-1 text-xs text-stone-500 tabular-nums">
            Buyback: {formatRupiah(todayStats.windowBuybackIdr)} ({formatGrams(todayStats.windowBuybackGrams)})
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>Cabang Berkinerja Tertinggi</span>
            <Award className="h-4 w-4 text-amber-700" />
          </div>
          <div className="mt-2 truncate text-lg font-bold text-stone-900">
            {topBranch ? topBranch.shortName : 'Belum Ada Cabang'}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-stone-500">
            {topBranch
              ? `${formatRupiah(topBranch.salesIdr)} · ${topBranch.txCount} nota`
              : '-'}
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-stone-500">
            <span>Peringatan Stok Menipis</span>
            <AlertTriangle
              className={`h-4 w-4 ${
                lowStockAlerts.length > 0 ? 'text-amber-700' : 'text-stone-400'
              }`}
            />
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-stone-900">
            {lowStockAlerts.length} Item
          </div>
          <div className="mt-1 text-xs text-stone-500">
            Batas pantau minimum {effectiveThreshold} gr / kategori
          </div>
        </div>
      </div>

      {/* Main Graphical Summary Grid (Daily Sales Volume + Top-Performing Branches) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Chart: Daily Sales & Buyback Volume (AreaChart) */}
        <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-6 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">
                Grafik Volume Penjualan & Buyback Harian
              </h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Tren transaksi harian {activeBranch ? activeBranch.name : 'seluruh cabang'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
                <button
                  type="button"
                  onClick={() => setChartMetric('idr')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    chartMetric === 'idr'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Nilai (Rp)
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric('grams')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    chartMetric === 'grams'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Berat (Gram)
                </button>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
                {([7, 14, 30] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDaysWindow(d)}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                      daysWindow === d
                        ? 'bg-white text-stone-900 shadow-xs'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {d}H
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 h-72 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailySeries} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="goldSalesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#b45309" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="#b45309" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="stoneBuybackFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#57534e" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#57534e" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  axisLine={{ stroke: '#e7e5e4' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(val: number) =>
                    chartMetric === 'idr' ? formatCompactIdr(val) : `${val}g`
                  }
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#d6d3d1',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontFamily: 'var(--font-mono)',
                  }}
                  formatter={(value, name) => {
                    const num = Number(value ?? 0);
                    return [
                      chartMetric === 'idr' ? formatRupiah(num) : formatGrams(num),
                      name === 'sales' ? 'Penjualan' : 'Buyback',
                    ];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={chartMetric === 'idr' ? 'salesIdr' : 'salesGrams'}
                  name="sales"
                  stroke="#b45309"
                  strokeWidth={2}
                  fill="url(#goldSalesFill)"
                />
                <Area
                  type="monotone"
                  dataKey={chartMetric === 'idr' ? 'buybackIdr' : 'buybackGrams'}
                  name="buyback"
                  stroke="#57534e"
                  strokeWidth={1.75}
                  fill="url(#stoneBuybackFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-3 text-xs text-stone-500">
            <span>Garis Emas: Omzet Penjualan · Garis Abu: Terima Buyback</span>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="font-medium text-stone-800 hover:underline whitespace-nowrap"
            >
              Lihat Laporan Laba Rugi Lengkap →
            </button>
          </div>
        </section>

        {/* Right Chart: Top-Performing Branches (BarChart + Ranked Breakdown) */}
        <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-6 xl:col-span-5">
          <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-4">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">
                Peringkat Kinerja Cabang Toko
              </h2>
              <p className="mt-0.5 text-xs text-stone-500">
                Perbandingan omzet penjualan aktual antar-cabang
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="text-xs font-medium text-amber-800 hover:underline whitespace-nowrap shrink-0"
            >
              Kelola Cabang
            </button>
          </div>

          {branchPerformance.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-xs text-stone-500">
              Belum ada data cabang terdaftar.
            </div>
          ) : (
            <>
              <div className="mt-5 h-48 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={branchPerformance}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => formatCompactIdr(v)}
                      tick={{ fontSize: 11, fill: '#78716c' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="code"
                      tick={{ fontSize: 11, fill: '#1c1917', fontWeight: 600 }}
                      axisLine={false}
                      tickLine={false}
                      width={68}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#ffffff',
                        borderColor: '#d6d3d1',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                      }}
                      formatter={(val) => [formatRupiah(Number(val ?? 0)), 'Omzet Penjualan']}
                    />
                    <Bar dataKey="salesIdr" radius={[0, 6, 6, 0]} barSize={22}>
                      {branchPerformance.map((entry, idx) => (
                        <Cell
                          key={entry.branchId}
                          fill={idx === 0 ? '#b45309' : '#292524'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 divide-y divide-stone-100 border-t border-stone-100 pt-2 text-xs tabular-nums">
                {branchPerformance.slice(0, 4).map((b, idx) => (
                  <div
                    key={b.branchId}
                    className="flex items-center justify-between gap-2 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-stone-900">
                        0{idx + 1}. {b.name}
                      </div>
                      <div className="text-[11px] text-stone-500">
                        {b.city} · {formatGrams(b.salesGrams)} terjual · Laba kotor{' '}
                        {formatRupiah(b.grossProfitIdr)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('pos', b.branchId)}
                      className="rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap shrink-0"
                    >
                      Pilih Kasir
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Bottom Section: Low-Stock Alerts Table & Restock Action */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Peringatan Stok Rendah & Kekosongan Etalase ({lowStockAlerts.length} Temuan)
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Mendeteksi otomatis brankas cabang yang kehabisan Logam Mulia 24K atau memiliki cadangan perhiasan di bawah ambang batas gramasi
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-500">Batas Minimum:</span>
            <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
              {([10, 20, 50] as const).map((th) => (
                <button
                  key={th}
                  type="button"
                  onClick={() => setLowStockThresholdGrams(th)}
                  className={`rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap ${
                    effectiveThreshold === th
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {th}g
                </button>
              ))}
            </div>
          </div>
        </div>

        {lowStockAlerts.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-emerald-800">
              Seluruh cabang memiliki cadangan emas di atas batas minimum ({effectiveThreshold} gr).
            </p>
            <p className="mt-1 text-xs text-stone-500">
              Tidak diperlukan pengisian ulang mendesak saat ini.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">Cabang Toko</th>
                  <th className="py-2.5 px-3 font-medium">Kategori / Peringatan Stok</th>
                  <th className="py-2.5 px-3 font-medium">Tingkat Prioritas</th>
                  <th className="py-2.5 px-3 text-right font-medium">Sisa Berat</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Tindak Lanjut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {lowStockAlerts.slice(0, 10).map((alert) => (
                  <tr key={alert.id} className="hover:bg-stone-50">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-stone-900">{alert.branchName}</div>
                      <div className="font-mono text-[11px] text-stone-500">{alert.branchCode}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-medium text-stone-900">{alert.title}</div>
                      <div className="text-[11px] text-stone-500">{alert.detail}</div>
                    </td>
                    <td className="py-3 px-3">
                      {alert.severity === 'critical' ? (
                        <span className="font-semibold text-red-700">Stok Habis · Segera Isi</span>
                      ) : (
                        <span className="font-semibold text-amber-800">Stok Menipis</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-stone-900">
                      {formatGrams(alert.availableGrams)}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigate('inventory', alert.branchId)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-100 whitespace-nowrap"
                      >
                        <Boxes className="h-3.5 w-3.5" />
                        <span>Isi / Mutasi Stok</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

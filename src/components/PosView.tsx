import {
  ArrowDownLeft,
  ArrowUpRight,
  Bluetooth,
  CheckCircle2,
  Printer,
  RefreshCw,
  Scale,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { recordPosTransaction } from '../services/firestoreService';
import { scaleService } from '../services/hardwareService';
import type {
  Branch,
  CategoryCode,
  Customer,
  GoldMarketFeed,
  GoldTransaction,
  InventoryItem,
  KaratCode,
  KaratPriceRow,
  PaymentMethod,
  PrinterState,
  ScaleState,
  StoreSetting,
} from '../types';
import {
  calculateOfficialGoldTax,
  CATEGORY_LABELS,
  formatGrams,
  formatRupiah,
  formatTimestampId,
  KARAT_SPECS,
} from '../utils/goldMath';

interface PosViewProps {
  uid: string;
  activeBranch: Branch | null;
  branches: Branch[];
  inventory: InventoryItem[];
  customers: Customer[];
  transactions: GoldTransaction[];
  karatMatrix: KaratPriceRow[];
  marketFeed: GoldMarketFeed | null;
  refreshingMarket: boolean;
  onRefreshMarket: () => void;
  scaleState: ScaleState;
  printerState: PrinterState;
  storeSetting: StoreSetting;
  onOpenReceipt: (tx: GoldTransaction) => void;
  onGoToHardwareSettings: () => void;
}

export function PosView({
  uid,
  activeBranch,
  branches,
  inventory,
  customers,
  transactions,
  karatMatrix,
  marketFeed,
  refreshingMarket,
  onRefreshMarket,
  scaleState,
  printerState,
  onOpenReceipt,
  onGoToHardwareSettings,
}: PosViewProps) {
  const targetBranch = activeBranch ?? branches[0] ?? null;

  const [txType, setTxType] = useState<'sale' | 'buyback'>('sale');
  const [sourceMode, setSourceMode] = useState<'stock' | 'custom'>('stock');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [walkInName, setWalkInName] = useState('Pelanggan Umum');
  const [walkInNpwp, setWalkInNpwp] = useState(false);

  const [sku, setSku] = useState('AU-CUSTOM-01');
  const [itemName, setItemName] = useState('Cincin Emas Polos');
  const [category, setCategory] = useState<CategoryCode>('cincin');
  const [karat, setKarat] = useState<KaratCode>('17K');
  const [weightGrams, setWeightGrams] = useState<number>(5.0);
  const [scaleSourceLabel, setScaleSourceLabel] = useState<string>('Input Terkalibrasi');
  const [pricePerGram, setPricePerGram] = useState<number>(0);
  const [makingCharge, setMakingCharge] = useState<number>(150000);
  const [deductionAmount, setDeductionAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('tunai');
  const [addBuybackToStock, setAddBuybackToStock] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [benchInput, setBenchInput] = useState<string>('5.25');

  const branchAvailableStock = useMemo(() => {
    if (!targetBranch) return [];
    return inventory.filter(
      (item) => item.branchId === targetBranch.id && item.status === 'available'
    );
  }, [inventory, targetBranch]);

  const selectedStockItem = useMemo(() => {
    if (txType !== 'sale' || sourceMode !== 'stock') return null;
    return branchAvailableStock.find((i) => i.id === selectedItemId) ?? null;
  }, [branchAvailableStock, selectedItemId, sourceMode, txType]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );

  // Sync default price per gram when karat or txType changes
  useEffect(() => {
    const row = karatMatrix.find((r) => r.karat === karat);
    if (row) {
      setPricePerGram(txType === 'sale' ? row.sellPerGram : row.buybackPerGram);
    }
  }, [karat, txType, karatMatrix]);

  // Sync form fields when an inventory item is chosen
  useEffect(() => {
    if (selectedStockItem) {
      setSku(selectedStockItem.sku);
      setItemName(selectedStockItem.name);
      setCategory(selectedStockItem.category);
      setKarat(selectedStockItem.karat);
      setWeightGrams(selectedStockItem.weightGrams);
      setMakingCharge(selectedStockItem.makingCharge);
      setScaleSourceLabel('Stok Terverifikasi');
      const row = karatMatrix.find((r) => r.karat === selectedStockItem.karat);
      if (row) setPricePerGram(row.sellPerGram);
    }
  }, [selectedStockItem, karatMatrix]);

  const handleCaptureScaleWeight = () => {
    const captured = scaleState.netGrams > 0 ? scaleState.netGrams : Number(benchInput) || 1;
    if (txType === 'sale' && sourceMode === 'stock') {
      setSourceMode('custom');
      setSelectedItemId('');
    }
    setWeightGrams(captured);
    setScaleSourceLabel(
      scaleState.mode === 'disconnected'
        ? 'Meja Timbang Presisi (0.001g)'
        : scaleState.deviceName
    );
  };

  const handleSelectKaratFromBoard = (row: KaratPriceRow) => {
    if (txType === 'sale' && sourceMode === 'stock') {
      setSourceMode('custom');
      setSelectedItemId('');
    }
    setKarat(row.karat);
    if (row.karat === '24K') {
      setCategory('logam_mulia');
      setMakingCharge(0);
    }
    setPricePerGram(txType === 'sale' ? row.sellPerGram : row.buybackPerGram);
  };

  const activeHasNpwp = selectedCustomer ? selectedCustomer.hasNpwp : walkInNpwp;

  const financialSummary = useMemo(() => {
    const goldBase = Math.round(weightGrams * pricePerGram);
    const grossBeforeDeduction =
      txType === 'sale' ? goldBase + Math.round(makingCharge) : goldBase;
    const dppAmount = Math.max(0, grossBeforeDeduction - Math.round(deductionAmount));
    const tax = calculateOfficialGoldTax({
      txType,
      category,
      karat,
      dppAmount,
      customerHasNpwp: activeHasNpwp,
    });
    const totalAmount = dppAmount + tax.ppnAmount + tax.pph22Amount;
    const row = karatMatrix.find((r) => r.karat === karat);
    const estimatedCostPerGram = selectedStockItem
      ? selectedStockItem.costPerGram
      : row
        ? row.buybackPerGram
        : pricePerGram;

    return {
      goldBase,
      dppAmount,
      ppnAmount: tax.ppnAmount,
      pph22Amount: tax.pph22Amount,
      taxRuleLabel: tax.taxRuleLabel,
      totalAmount,
      estimatedCostPerGram,
    };
  }, [
    weightGrams,
    pricePerGram,
    makingCharge,
    deductionAmount,
    txType,
    category,
    karat,
    activeHasNpwp,
    karatMatrix,
    selectedStockItem,
  ]);

  const handleSubmitPos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBranch || weightGrams <= 0 || pricePerGram <= 0) return;

    setSubmitting(true);
    try {
      const createdTx = await recordPosTransaction({
        uid,
        branch: targetBranch,
        txType,
        customer: selectedCustomer,
        walkInCustomerName: walkInName,
        walkInHasNpwp: walkInNpwp,
        selectedInventoryItem: selectedStockItem,
        sku,
        itemName,
        category,
        karat,
        weightGrams,
        scaleSource: scaleSourceLabel,
        pricePerGram,
        costPerGram: financialSummary.estimatedCostPerGram,
        makingCharge: txType === 'sale' ? makingCharge : 0,
        deductionAmount,
        dppAmount: financialSummary.dppAmount,
        ppnAmount: financialSummary.ppnAmount,
        pph22Amount: financialSummary.pph22Amount,
        totalAmount: financialSummary.totalAmount,
        paymentMethod,
        addBuybackToStock,
      });

      setSelectedItemId('');
      setDeductionAmount(0);
      onOpenReceipt(createdTx);
    } finally {
      setSubmitting(false);
    }
  };

  const recentBranchTransactions = useMemo(() => {
    const list = targetBranch
      ? transactions.filter((t) => t.branchId === targetBranch.id)
      : transactions;
    return list.slice(0, 6);
  }, [transactions, targetBranch]);

  return (
    <div className="space-y-6">
      {/* Top Row: Digital Scale Instrument Panel + Real-Time Gold Karat Board */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Precision Digital Scale Console */}
        <section className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-5 xl:col-span-5">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-stone-900">
                  Timbangan Digital Presisi
                </h2>
                <p className="mt-0.5 text-xs text-stone-500">
                  {scaleState.deviceName} ·{' '}
                  {scaleState.mode === 'disconnected' ? 'Siap Kalibrasi' : 'Aktif'}
                </p>
              </div>
              <button
                type="button"
                onClick={onGoToHardwareSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 whitespace-nowrap shrink-0"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>Hubungkan Alat</span>
              </button>
            </div>

            {/* Metallic Segmented Instrument Readout */}
            <div className="mt-4 rounded-lg bg-stone-950 px-5 py-4 text-stone-100">
              <div className="flex items-center justify-between text-[11px] font-mono text-stone-400">
                <span>{scaleState.isStable ? 'STABLE' : 'MOTION'}</span>
                <span>TARE: {scaleState.tareGrams.toFixed(3)} g</span>
              </div>
              <div className="mt-1 flex items-baseline justify-end gap-2 font-mono tabular-nums">
                <span className="text-4xl font-semibold tracking-tight text-amber-400">
                  {scaleState.netGrams.toFixed(3)}
                </span>
                <span className="text-base text-stone-300">g</span>
              </div>
              {scaleState.lastRawFrame ? (
                <div className="mt-1 text-right font-mono text-[10px] text-stone-500">
                  Frame: {scaleState.lastRawFrame}
                </div>
              ) : null}
            </div>

            {/* Quick Bench Weight & Tare Controls */}
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={benchInput}
                  onChange={(e) => {
                    setBenchInput(e.target.value);
                    scaleService.setBenchWeight(Number.parseFloat(e.target.value) || 0);
                  }}
                  aria-label="Uji berat meja timbang (gram)"
                  className="w-28 rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 font-mono text-xs tabular-nums text-stone-900 focus:border-amber-700 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1.5">
                  {[2.5, 5.0, 10.0, 25.0].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setBenchInput(String(preset));
                        scaleService.setBenchWeight(preset);
                      }}
                      className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1 font-mono text-xs tabular-nums text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                    >
                      {preset}g
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2 pt-3 border-t border-stone-100">
            <button
              type="button"
              onClick={() => scaleService.tare()}
              className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0"
            >
              Tare (Nol Wadah)
            </button>
            <button
              type="button"
              onClick={() => scaleService.zero()}
              className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50 whitespace-nowrap shrink-0"
            >
              Zero
            </button>
            <button
              type="button"
              onClick={handleCaptureScaleWeight}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 whitespace-nowrap shrink-0"
            >
              <Scale className="h-3.5 w-3.5" />
              <span>Ambil Berat ke Kasir</span>
            </button>
          </div>
        </section>

        {/* Live Real-Time Gold Price Matrix */}
        <section className="rounded-xl border border-stone-200 bg-white p-5 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-stone-900">
                Bảng Harga Emas Real-Time (Klik Baris untuk Pakai di Kasir)
              </h2>
              <p className="mt-0.5 text-xs text-stone-500 tabular-nums">
                {marketFeed
                  ? `${marketFeed.source} · XAU $${marketFeed.xauUsdPerOz.toLocaleString('en-US')}/oz · Kurs Rp ${marketFeed.usdIdrRate.toLocaleString('id-ID')} · ${
                      marketFeed.change24hPercent >= 0 ? '+' : ''
                    }${marketFeed.change24hPercent}%`
                  : 'Memuat acuan spot emas dunia...'}
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshMarket}
              disabled={refreshingMarket}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshingMarket ? 'animate-spin' : ''}`} />
              <span>Perbarui Spot</span>
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2 pr-3 font-medium">Kadar</th>
                  <th className="py-2 px-3 font-medium">Kemurnian</th>
                  <th className="py-2 px-3 text-right font-medium">Acuan Spot/gr</th>
                  <th className="py-2 px-3 text-right font-medium">Harga Jual Toko/gr</th>
                  <th className="py-2 pl-3 text-right font-medium">Terima Buyback/gr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 font-mono tabular-nums">
                {karatMatrix.slice(0, 6).map((row) => {
                  const isSelected = row.karat === karat;
                  return (
                    <tr
                      key={row.karat}
                      onClick={() => handleSelectKaratFromBoard(row)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-amber-50/70' : 'hover:bg-stone-50'
                      }`}
                    >
                      <td className="py-2 pr-3 font-sans font-semibold text-stone-900">
                        {row.karat}
                      </td>
                      <td className="py-2 px-3 text-stone-600">{row.purityPercent}%</td>
                      <td className="py-2 px-3 text-right text-stone-500">
                        {formatRupiah(row.spotPerGram)}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-stone-900">
                        {formatRupiah(row.sellPerGram)}
                      </td>
                      <td className="py-2 pl-3 text-right font-medium text-amber-800">
                        {formatRupiah(row.buybackPerGram)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Main POS Transaction Form + Calculation Summary */}
      <form onSubmit={handleSubmitPos} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-stone-200 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
            {/* Segmented Mode Control */}
            <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
              <button
                type="button"
                onClick={() => setTxType('sale')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  txType === 'sale'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <ArrowUpRight className="h-3.5 w-3.5 text-emerald-700" />
                <span>Jual Emas (Penjualan)</span>
              </button>
              <button
                type="button"
                onClick={() => setTxType('buyback')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  txType === 'buyback'
                    ? 'bg-white text-stone-900 shadow-xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <ArrowDownLeft className="h-3.5 w-3.5 text-amber-700" />
                <span>Terima Buyback Pelanggan</span>
              </button>
            </div>

            {txType === 'sale' ? (
              <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
                <button
                  type="button"
                  onClick={() => setSourceMode('stock')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    sourceMode === 'stock'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Pilih Stok Etalase ({branchAvailableStock.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSourceMode('custom');
                    setSelectedItemId('');
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    sourceMode === 'custom'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  Timbang Manual / Custom
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Inventory Stock Picker when Sale + Stock mode */}
            {txType === 'sale' && sourceMode === 'stock' ? (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-700">
                  Pilih Barang dari Stok {targetBranch?.name ?? 'Cabang'}
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
                >
                  <option value="">-- Pilih SKU Perhiasan / Logam Mulia Tersedia --</option>
                  {branchAvailableStock.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sku} — {item.name} · {item.karat} · {formatGrams(item.weightGrams)}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {/* Customer Selection */}
            <div>
              <label className="block text-xs font-medium text-stone-700">
                Pelanggan Setia / Member
              </label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
              >
                <option value="">Pelanggan Umum (Walk-In)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.tier.toUpperCase()} {c.hasNpwp ? '· NPWP' : ''}
                  </option>
                ))}
              </select>
            </div>

            {!selectedCustomer ? (
              <div>
                <label className="block text-xs font-medium text-stone-700">
                  Nama di Surat Emas
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={walkInName}
                    onChange={(e) => setWalkInName(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:border-amber-700 focus:outline-none"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-stone-600 whitespace-nowrap shrink-0">
                    <input
                      type="checkbox"
                      checked={walkInNpwp}
                      onChange={(e) => setWalkInNpwp(e.target.checked)}
                      className="rounded border-stone-300 text-amber-700 focus:ring-amber-700"
                    />
                    <span>NPWP</span>
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex flex-col justify-end pb-1 text-xs text-stone-600">
                <span>
                  Akumulasi: <strong className="font-mono">{formatGrams(selectedCustomer.totalWeightGrams)}</strong> ·{' '}
                  {selectedCustomer.loyaltyPoints} poin ·{' '}
                  {selectedCustomer.hasNpwp ? 'Tarif NPWP Aktif' : 'Non-NPWP'}
                </span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-700">Kode Barang / SKU</label>
              <input
                type="text"
                required
                maxLength={40}
                value={sku}
                disabled={Boolean(selectedStockItem)}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm text-stone-900 disabled:bg-stone-100 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700">
                Nama Perhiasan / Emas
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={itemName}
                disabled={Boolean(selectedStockItem)}
                onChange={(e) => setItemName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:bg-stone-100 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700">Kategori</label>
              <select
                value={category}
                disabled={Boolean(selectedStockItem)}
                onChange={(e) => setCategory(e.target.value as CategoryCode)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:bg-stone-100 focus:border-amber-700 focus:outline-none"
              >
                {Object.entries(CATEGORY_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700">Kadar Emas</label>
              <select
                value={karat}
                disabled={Boolean(selectedStockItem)}
                onChange={(e) => setKarat(e.target.value as KaratCode)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 disabled:bg-stone-100 focus:border-amber-700 focus:outline-none"
              >
                {KARAT_SPECS.map((spec) => (
                  <option key={spec.karat} value={spec.karat}>
                    {spec.karat} — {spec.label} ({spec.purityPercent}%)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-stone-700">
                  Berat Emas (gram)
                </label>
                <button
                  type="button"
                  onClick={handleCaptureScaleWeight}
                  className="text-xs font-medium text-amber-800 hover:underline"
                >
                  Baca Timbangan ({scaleState.netGrams.toFixed(2)}g)
                </button>
              </div>
              <input
                type="number"
                required
                step="0.001"
                min="0.01"
                max="100000"
                value={weightGrams}
                disabled={Boolean(selectedStockItem)}
                onChange={(e) => setWeightGrams(Number.parseFloat(e.target.value) || 0)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-stone-900 disabled:bg-stone-100 focus:border-amber-700 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700">
                {txType === 'sale' ? 'Harga Jual / gram (Rp)' : 'Harga Terima Buyback / gram (Rp)'}
              </label>
              <input
                type="number"
                required
                min="1000"
                step="500"
                value={pricePerGram}
                onChange={(e) => setPricePerGram(Number.parseFloat(e.target.value) || 0)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>

            {txType === 'sale' ? (
              <div>
                <label className="block text-xs font-medium text-stone-700">
                  Ongkos Bikin / Upah Kerja (Rp)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5000"
                  value={makingCharge}
                  onChange={(e) => setMakingCharge(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-stone-900 focus:border-amber-700 focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input
                    type="checkbox"
                    checked={addBuybackToStock}
                    onChange={(e) => setAddBuybackToStock(e.target.checked)}
                    className="rounded border-stone-300 text-amber-700 focus:ring-amber-700"
                  />
                  <span>Masukkan otomatis ke inventaris cabang</span>
                </label>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-stone-700">
                {txType === 'sale' ? 'Diskon Pelanggan (Rp)' : 'Potongan Susut / Tanpa Surat (Rp)'}
              </label>
              <input
                type="number"
                min="0"
                step="5000"
                value={deductionAmount}
                onChange={(e) => setDeductionAmount(Number.parseFloat(e.target.value) || 0)}
                className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm tabular-nums text-stone-900 focus:border-amber-700 focus:outline-none"
              />
            </div>
          </div>
        </section>

        {/* Right Checkout & Bluetooth Receipt Panel */}
        <section className="flex flex-col justify-between rounded-xl border border-stone-200 bg-white p-6 lg:col-span-5">
          <div>
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <div>
                <h3 className="text-sm font-semibold text-stone-900">Ringkasan Kasir</h3>
                <p className="text-xs text-stone-500">
                  {targetBranch ? `${targetBranch.name} (${targetBranch.code})` : 'Pilih cabang'}
                </p>
              </div>
              <span className="text-xs text-stone-500">
                Printer: {printerState.connected ? printerState.deviceName : 'Siap Sambung'}
              </span>
            </div>

            <div className="mt-5 space-y-3 text-sm tabular-nums">
              <div className="flex justify-between text-stone-600">
                <span>
                  Nilai Emas ({formatGrams(weightGrams)} × {formatRupiah(pricePerGram)})
                </span>
                <span className="font-mono font-medium text-stone-900">
                  {formatRupiah(financialSummary.goldBase)}
                </span>
              </div>

              {txType === 'sale' && makingCharge > 0 ? (
                <div className="flex justify-between text-stone-600">
                  <span>Ongkos Bikin Perhiasan</span>
                  <span className="font-mono">{formatRupiah(makingCharge)}</span>
                </div>
              ) : null}

              {deductionAmount > 0 ? (
                <div className="flex justify-between text-amber-800">
                  <span>{txType === 'sale' ? 'Diskon' : 'Potongan Susut / Lebur'}</span>
                  <span className="font-mono">-{formatRupiah(deductionAmount)}</span>
                </div>
              ) : null}

              <div className="border-t border-stone-100 pt-3 flex justify-between text-stone-700">
                <span>Dasar Pengenaan Pajak (DPP)</span>
                <span className="font-mono font-medium">
                  {formatRupiah(financialSummary.dppAmount)}
                </span>
              </div>

              <div className="flex justify-between text-xs text-stone-500">
                <span>{financialSummary.taxRuleLabel}</span>
                <span className="font-mono">
                  {formatRupiah(financialSummary.ppnAmount + financialSummary.pph22Amount)}
                </span>
              </div>

              <div className="border-t border-stone-200 pt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold text-stone-600">
                    {txType === 'sale' ? 'Total Diterima Kasir' : 'Total Dibayarkan ke Pelanggan'}
                  </span>
                  <span className="font-mono text-2xl font-bold text-stone-900">
                    {formatRupiah(financialSummary.totalAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="mt-6">
              <span className="block text-xs font-medium text-stone-700">Metode Pembayaran</span>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {(['tunai', 'transfer', 'qris', 'debit'] as PaymentMethod[]).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`rounded-lg border py-2 text-xs font-semibold uppercase transition-colors whitespace-nowrap ${
                      paymentMethod === method
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2.5 pt-4 border-t border-stone-100">
            <button
              type="submit"
              disabled={submitting || !targetBranch || weightGrams <= 0}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>
                {submitting
                  ? 'Menyimpan & Menyiapkan Nota...'
                  : txType === 'sale'
                    ? 'Proses Penjualan & Cetak Surat Emas'
                    : 'Proses Buyback & Cetak Nota'}
              </span>
            </button>

            <div className="flex items-center justify-between text-xs text-stone-500">
              <span className="inline-flex items-center gap-1">
                <Bluetooth className="h-3.5 w-3.5" />
                Mendukung cetak langsung printer Bluetooth ESC/POS
              </span>
              <button
                type="button"
                onClick={onGoToHardwareSettings}
                className="font-medium text-stone-700 hover:underline whitespace-nowrap"
              >
                Atur Printer
              </button>
            </div>
          </div>
        </section>
      </form>

      {/* Recent Transactions with Instant Receipt Reprint */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex items-center justify-between border-b border-stone-100 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Transaksi Terkini {targetBranch ? `— ${targetBranch.name}` : '(Semua Cabang)'}
            </h3>
            <p className="text-xs text-stone-500">
              Sinkronisasi langsung antar-cabang · Klik Cetak Nota untuk kirim ulang ke printer Bluetooth
            </p>
          </div>
        </div>

        {recentBranchTransactions.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-500">
            Belum ada transaksi pada cabang ini. Gunakan formulir kasir di atas untuk mencatat transaksi pertama.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">No. Nota & Waktu</th>
                  <th className="py-2.5 px-3 font-medium">Jenis · Pelanggan</th>
                  <th className="py-2.5 px-3 font-medium">Barang & Kadar</th>
                  <th className="py-2.5 px-3 text-right font-medium">Berat</th>
                  <th className="py-2.5 px-3 text-right font-medium">Total Aktual</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {recentBranchTransactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-stone-50 ${tx.status === 'voided' ? 'opacity-50 line-through' : ''}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="font-mono font-medium text-stone-900">{tx.invoiceNumber}</div>
                      <div className="text-[11px] text-stone-500">
                        {formatTimestampId(tx.createdAt)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-stone-700">
                      <span className={tx.txType === 'sale' ? 'font-semibold text-emerald-800' : 'font-semibold text-amber-800'}>
                        {tx.txType === 'sale' ? 'Penjualan' : 'Buyback'}
                      </span>
                      {' · '}
                      <span>{tx.customerName}</span>
                    </td>
                    <td className="py-2.5 px-3 text-stone-700">
                      {tx.itemName} · <span className="font-mono font-medium">{tx.karat}</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-medium text-stone-900">
                      {formatGrams(tx.weightGrams)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-stone-900">
                      {formatRupiah(tx.totalAmount)}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenReceipt(tx)}
                        className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                      >
                        <Printer className="h-3 w-3" />
                        <span>Cetak Nota</span>
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

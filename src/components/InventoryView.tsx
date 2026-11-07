import { ArrowRightLeft, Plus, Scale, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  createInventoryItem,
  deleteInventoryItem,
  transferInventoryBetweenBranches,
} from '../services/firestoreService';
import type {
  Branch,
  CategoryCode,
  InventoryItem,
  KaratCode,
  KaratPriceRow,
  ScaleState,
  StockTransfer,
} from '../types';
import {
  CATEGORY_LABELS,
  formatGrams,
  formatRupiah,
  formatTimestampId,
  KARAT_SPECS,
} from '../utils/goldMath';

interface InventoryViewProps {
  uid: string;
  activeBranch: Branch | null;
  branches: Branch[];
  inventory: InventoryItem[];
  transfers: StockTransfer[];
  karatMatrix: KaratPriceRow[];
  scaleState: ScaleState;
}

export function InventoryView({
  uid,
  activeBranch,
  branches,
  inventory,
  transfers,
  karatMatrix,
  scaleState,
}: InventoryViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'sold' | 'melting'>(
    'available'
  );
  const [karatFilter, setKaratFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Item Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [formBranchId, setFormBranchId] = useState(activeBranch?.id ?? branches[0]?.id ?? '');
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CategoryCode>('cincin');
  const [karat, setKarat] = useState<KaratCode>('17K');
  const [weightGrams, setWeightGrams] = useState<number>(5.0);
  const [costPerGram, setCostPerGram] = useState<number>(980000);
  const [makingCharge, setMakingCharge] = useState<number>(150000);
  const [saving, setSaving] = useState(false);

  // Transfer Modal State
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [toBranchId, setToBranchId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferring, setTransferring] = useState(false);

  const branchMap = useMemo(() => {
    const map = new Map<string, Branch>();
    branches.forEach((b) => map.set(b.id, b));
    return map;
  }, [branches]);

  const scopedInventory = useMemo(() => {
    return inventory.filter((item) => {
      if (activeBranch && item.branchId !== activeBranch.id) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (karatFilter !== 'all' && item.karat !== karatFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        if (!item.sku.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [inventory, activeBranch, statusFilter, karatFilter, searchQuery]);

  const metrics = useMemo(() => {
    const availableItems = inventory.filter(
      (i) => (!activeBranch || i.branchId === activeBranch.id) && i.status === 'available'
    );
    let totalWeight = 0;
    let totalCostValue = 0;
    let estimatedRetailValue = 0;

    for (const item of availableItems) {
      totalWeight += item.weightGrams;
      totalCostValue += item.weightGrams * item.costPerGram;
      const row = karatMatrix.find((r) => r.karat === item.karat);
      const sellRate = row ? row.sellPerGram : item.costPerGram;
      estimatedRetailValue += item.weightGrams * sellRate + item.makingCharge;
    }

    return {
      skuCount: availableItems.length,
      totalWeight,
      totalCostValue,
      estimatedRetailValue,
    };
  }, [inventory, activeBranch, karatMatrix]);

  const openAddModal = () => {
    const defaultBr = activeBranch?.id ?? branches[0]?.id ?? '';
    setFormBranchId(defaultBr);
    setSku(`AU-${Date.now().toString().slice(-5)}`);
    setName('');
    const row17 = karatMatrix.find((r) => r.karat === '17K');
    if (row17) setCostPerGram(row17.buybackPerGram);
    if (scaleState.netGrams > 0) setWeightGrams(scaleState.netGrams);
    setShowAddModal(true);
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formBranchId) return;
    setSaving(true);
    try {
      await createInventoryItem(uid, {
        branchId: formBranchId,
        sku,
        name,
        category,
        karat,
        weightGrams,
        costPerGram,
        makingCharge,
      });
      setShowAddModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenTransfer = (item: InventoryItem) => {
    const otherBranch = branches.find((b) => b.id !== item.branchId);
    setTransferItem(item);
    setToBranchId(otherBranch?.id ?? '');
    setTransferNotes('Distribusi stok etalase antar-cabang');
  };

  const handleConfirmTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferItem || !toBranchId) return;
    const fromBranch = branchMap.get(transferItem.branchId);
    const toBranch = branchMap.get(toBranchId);
    if (!fromBranch || !toBranch || fromBranch.id === toBranch.id) return;

    setTransferring(true);
    try {
      await transferInventoryBetweenBranches({
        uid,
        item: transferItem,
        fromBranch,
        toBranch,
        notes: transferNotes,
      });
      setTransferItem(null);
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Valuation Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-xs text-stone-500">Total Berat Emas Tersedia</div>
          <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatGrams(metrics.totalWeight)}
          </div>
          <div className="mt-1 text-xs text-stone-500">
            {metrics.skuCount} unit aktif · {activeBranch ? activeBranch.name : 'Seluruh Cabang'}
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-xs text-stone-500">Nilai Pokok Modal (HPP)</div>
          <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-stone-900">
            {formatRupiah(metrics.totalCostValue)}
          </div>
          <div className="mt-1 text-xs text-stone-500">Basis perhitungan laba kotor</div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-xs text-stone-500">Estimasi Nilai Jual Pasar</div>
          <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-amber-800">
            {formatRupiah(metrics.estimatedRetailValue)}
          </div>
          <div className="mt-1 text-xs text-stone-500">Mengikuti harga emas real-time hari ini</div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-5">
          <div className="text-xs text-stone-500">Potensi Margin Bruto Stok</div>
          <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-emerald-800">
            {formatRupiah(Math.max(0, metrics.estimatedRetailValue - metrics.totalCostValue))}
          </div>
          <div className="mt-1 text-xs text-stone-500">Termasuk ongkos bikin perhiasan</div>
        </div>
      </div>

      {/* Main Inventory Table */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
              <input
                type="text"
                placeholder="Cari SKU atau nama barang..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-60 rounded-lg border border-stone-300 bg-stone-50 py-1.5 pl-8 pr-3 text-xs text-stone-900 focus:border-amber-700 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
              {(
                [
                  ['available', 'Tersedia'],
                  ['sold', 'Terjual'],
                  ['melting', 'Leburan'],
                  ['all', 'Semua'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    statusFilter === key
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={karatFilter}
              onChange={(e) => setKaratFilter(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs text-stone-700 focus:border-amber-700 focus:outline-none"
            >
              <option value="all">Semua Kadar</option>
              {KARAT_SPECS.map((k) => (
                <option key={k.karat} value={k.karat}>
                  Kadar {k.karat}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah Stok Emas</span>
          </button>
        </div>

        {scopedInventory.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-stone-600">
              Tidak ada stok emas yang sesuai dengan filter saat ini.
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Catat Stok Baru</span>
            </button>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">SKU & Nama Perhiasan</th>
                  <th className="py-2.5 px-3 font-medium">Cabang · Status</th>
                  <th className="py-2.5 px-3 font-medium">Kategori · Kadar</th>
                  <th className="py-2.5 px-3 text-right font-medium">Berat</th>
                  <th className="py-2.5 px-3 text-right font-medium">HPP / gr</th>
                  <th className="py-2.5 px-3 text-right font-medium">Ongkos</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {scopedInventory.map((item) => {
                  const br = branchMap.get(item.branchId);
                  return (
                    <tr key={item.id} className="hover:bg-stone-50">
                      <td className="py-3 pr-3">
                        <div className="font-mono font-semibold text-stone-900">{item.sku}</div>
                        <div className="text-stone-700">{item.name}</div>
                      </td>
                      <td className="py-3 px-3 text-stone-600">
                        <span>{br ? br.name : 'Cabang'}</span>
                        {' · '}
                        <span
                          className={
                            item.status === 'available'
                              ? 'font-medium text-emerald-800'
                              : item.status === 'sold'
                                ? 'text-stone-400'
                                : 'font-medium text-amber-800'
                          }
                        >
                          {item.status === 'available'
                            ? 'Tersedia'
                            : item.status === 'sold'
                              ? 'Terjual'
                              : 'Leburan'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-stone-600">
                        {CATEGORY_LABELS[item.category]} ·{' '}
                        <span className="font-mono font-semibold text-stone-900">{item.karat}</span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-stone-900">
                        {formatGrams(item.weightGrams)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-stone-700">
                        {formatRupiah(item.costPerGram)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-stone-600">
                        {formatRupiah(item.makingCharge)}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        {item.status !== 'sold' ? (
                          <div className="inline-flex items-center gap-1.5">
                            {branches.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => handleOpenTransfer(item)}
                                className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                              >
                                <ArrowRightLeft className="h-3 w-3" />
                                <span>Mutasi Cabang</span>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void deleteInventoryItem(item.id)}
                              className="rounded-md p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-700"
                              title="Hapus stok"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-stone-400">Terkunci</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Inter-Branch Transfer Audit Log */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-stone-900">
          Riwayat Mutasi Stok Antar-Cabang (Sinkronisasi Multi-Toko)
        </h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Setiap perpindahan barang tercatat secara atomik pada cabang asal dan cabang tujuan
        </p>

        {transfers.length === 0 ? (
          <p className="mt-4 text-xs text-stone-500">
            Belum ada riwayat mutasi antar-cabang. Gunakan tombol "Mutasi Cabang" pada baris stok di atas untuk memindahkan emas ke toko lain.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2 pr-3 font-medium">Waktu</th>
                  <th className="py-2 px-3 font-medium">SKU · Barang</th>
                  <th className="py-2 px-3 text-right font-medium">Berat</th>
                  <th className="py-2 px-3 font-medium">Rute Cabang</th>
                  <th className="py-2 pl-3 font-medium">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {transfers.slice(0, 8).map((tr) => (
                  <tr key={tr.id}>
                    <td className="py-2.5 pr-3 text-stone-500">{formatTimestampId(tr.createdAt)}</td>
                    <td className="py-2.5 px-3 font-medium text-stone-900">
                      <span className="font-mono">{tr.sku}</span> — {tr.itemName} ({tr.karat})
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-stone-900">
                      {formatGrams(tr.weightGrams)}
                    </td>
                    <td className="py-2.5 px-3 text-stone-700">
                      {tr.fromBranchName} → <strong>{tr.toBranchName}</strong>
                    </td>
                    <td className="py-2.5 pl-3 text-stone-500">{tr.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add Inventory Modal */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleCreateItem}
            className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-semibold text-stone-900">Tambah Stok Emas Baru</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-700">Lokasi Cabang</label>
                <select
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700">Kode SKU</label>
                <input
                  type="text"
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700">Kategori</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as CategoryCode)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-stone-700">
                  Nama Perhiasan / Logam Mulia
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Kalung Rantai Nori 22K"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700">Kadar Emas</label>
                <select
                  value={karat}
                  onChange={(e) => {
                    const nextKarat = e.target.value as KaratCode;
                    setKarat(nextKarat);
                    const row = karatMatrix.find((r) => r.karat === nextKarat);
                    if (row) setCostPerGram(row.buybackPerGram);
                  }}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {KARAT_SPECS.map((k) => (
                    <option key={k.karat} value={k.karat}>
                      {k.karat} ({k.purityPercent}%)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-stone-700">Berat (gram)</label>
                  <button
                    type="button"
                    onClick={() => {
                      if (scaleState.netGrams > 0) setWeightGrams(scaleState.netGrams);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:underline"
                  >
                    <Scale className="h-3 w-3" />
                    <span>Timbangan ({scaleState.netGrams.toFixed(2)}g)</span>
                  </button>
                </div>
                <input
                  type="number"
                  required
                  step="0.001"
                  min="0.01"
                  value={weightGrams}
                  onChange={(e) => setWeightGrams(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700">
                  Harga Pokok / HPP per gram (Rp)
                </label>
                <input
                  type="number"
                  required
                  min="1000"
                  step="500"
                  value={costPerGram}
                  onChange={(e) => setCostPerGram(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-700">
                  Ongkos Bikin Standar (Rp)
                </label>
                <input
                  type="number"
                  min="0"
                  step="5000"
                  value={makingCharge}
                  onChange={(e) => setMakingCharge(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {saving ? 'Menyimpan...' : 'Simpan ke Stok'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Inter-Branch Transfer Modal */}
      {transferItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleConfirmTransfer}
            className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-semibold text-stone-900">Mutasi Stok Antar-Cabang</h3>
              <button
                type="button"
                onClick={() => setTransferItem(null)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="rounded-lg bg-stone-50 p-3 text-stone-700">
                <div className="font-mono font-semibold text-stone-900">{transferItem.sku}</div>
                <div>
                  {transferItem.name} · {transferItem.karat} · {formatGrams(transferItem.weightGrams)}
                </div>
                <div className="mt-1 text-stone-500">
                  Cabang Asal: <strong>{branchMap.get(transferItem.branchId)?.name}</strong>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700">Cabang Tujuan</label>
                <select
                  required
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {branches
                    .filter((b) => b.id !== transferItem.branchId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-stone-700">Catatan Pengiriman</label>
                <input
                  type="text"
                  maxLength={200}
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTransferItem(null)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={transferring || !toBranchId}
                className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {transferring ? 'Memindahkan...' : 'Konfirmasi Mutasi'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

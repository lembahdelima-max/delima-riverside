import { Bell, Check, Copy, ExternalLink, Plus, UserPlus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  createCustomer,
  createPriceAlert,
  markPriceAlertStatus,
} from '../services/firestoreService';
import type {
  Branch,
  Customer,
  KaratCode,
  KaratPriceRow,
  PriceAlert,
  StoreSetting,
} from '../types';
import { formatGrams, formatRupiah, KARAT_SPECS } from '../utils/goldMath';

interface CustomersAlertsViewProps {
  uid: string;
  activeBranch: Branch | null;
  branches: Branch[];
  customers: Customer[];
  alerts: PriceAlert[];
  karatMatrix: KaratPriceRow[];
  storeSetting: StoreSetting;
}

export function CustomersAlertsView({
  uid,
  activeBranch,
  branches,
  customers,
  alerts,
  karatMatrix,
  storeSetting,
}: CustomersAlertsViewProps) {
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('62812');
  const [custTier, setCustTier] = useState<'reguler' | 'prioritas' | 'vip'>('reguler');
  const [custHasNpwp, setCustHasNpwp] = useState(false);
  const [custNpwpNum, setCustNpwpNum] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertCustomerId, setAlertCustomerId] = useState('');
  const [alertKarat, setAlertKarat] = useState<KaratCode>('24K');
  const [alertType, setAlertType] = useState<'buy_below' | 'sell_above'>('buy_below');
  const [targetPrice, setTargetPrice] = useState<number>(1450000);
  const [alertNotes, setAlertNotes] = useState('');
  const [savingAlert, setSavingAlert] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const evaluatedAlerts = useMemo(() => {
    return alerts
      .filter((a) => a.status !== 'cancelled')
      .map((alert) => {
        const row = karatMatrix.find((r) => r.karat === alert.karat);
        const currentRelevantPrice = row
          ? alert.alertType === 'buy_below'
            ? row.sellPerGram
            : row.buybackPerGram
          : 0;
        const isTriggered =
          currentRelevantPrice > 0 &&
          (alert.alertType === 'buy_below'
            ? currentRelevantPrice <= alert.targetPricePerGram
            : currentRelevantPrice >= alert.targetPricePerGram);

        const message =
          alert.alertType === 'buy_below'
            ? `Halo ${alert.customerName}, info harga spesial dari ${storeSetting.storeName}: Harga jual emas ${alert.karat} saat ini ${formatRupiah(currentRelevantPrice)}/gr (telah mencapai target beli Anda <= ${formatRupiah(alert.targetPricePerGram)}/gr). Silakan kunjungi cabang kami atau balas pesan ini untuk kunci harga.`
            : `Halo ${alert.customerName}, info harga buyback dari ${storeSetting.storeName}: Harga terima buyback emas ${alert.karat} hari ini naik ke ${formatRupiah(currentRelevantPrice)}/gr (melampaui target jual Anda >= ${formatRupiah(alert.targetPricePerGram)}/gr).`;

        const digitsOnly = alert.customerPhone.replace(/[^0-9]/g, '');
        const waPhone = digitsOnly.startsWith('0') ? `62${digitsOnly.slice(1)}` : digitsOnly;
        const waLink = `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;

        return {
          ...alert,
          currentRelevantPrice,
          isTriggered,
          message,
          waLink,
        };
      })
      .sort((a, b) => Number(b.isTriggered) - Number(a.isTriggered));
  }, [alerts, karatMatrix, storeSetting.storeName]);

  const triggeredCount = evaluatedAlerts.filter(
    (a) => a.isTriggered && a.status === 'active'
  ).length;

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const branchId = activeBranch?.id ?? branches[0]?.id;
    if (!branchId) return;
    setSavingCustomer(true);
    try {
      await createCustomer(uid, {
        branchId,
        name: custName,
        phone: custPhone,
        hasNpwp: custHasNpwp,
        npwpNumber: custNpwpNum,
        tier: custTier,
      });
      setCustName('');
      setCustPhone('62812');
      setCustNpwpNum('');
      setShowCustomerModal(false);
    } finally {
      setSavingCustomer(false);
    }
  };

  const openNewAlertModal = (preselectedCustomer?: Customer) => {
    const chosen = preselectedCustomer ?? customers[0];
    if (chosen) setAlertCustomerId(chosen.id);
    const row24 = karatMatrix.find((r) => r.karat === '24K');
    if (row24) setTargetPrice(row24.sellPerGram);
    setShowAlertModal(true);
  };

  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    const cust = customers.find((c) => c.id === alertCustomerId);
    if (!cust) return;
    setSavingAlert(true);
    try {
      await createPriceAlert(uid, {
        customer: cust,
        karat: alertKarat,
        alertType,
        targetPricePerGram: targetPrice,
        notes: alertNotes,
      });
      setAlertNotes('');
      setShowAlertModal(false);
    } finally {
      setSavingAlert(false);
    }
  };

  const handleCopyAlertMessage = async (id: string, message: string) => {
    await navigator.clipboard.writeText(message);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Price Alert Watchlist Section */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">
              Notifikasi Target Harga Pelanggan Setia ({triggeredCount} Target Tercapai)
            </h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Memantau pergerakan harga jual & buyback real-time secara otomatis untuk member VIP dan prioritas
            </p>
          </div>
          <button
            type="button"
            disabled={customers.length === 0}
            onClick={() => openNewAlertModal()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Bell className="h-3.5 w-3.5" />
            <span>Buat Pengingat Harga</span>
          </button>
        </div>

        {evaluatedAlerts.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-500">
            Belum ada pengingat target harga aktif. Tambahkan pelanggan lalu atur target harga beli/jual emas mereka.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">Pelanggan & Kontak</th>
                  <th className="py-2.5 px-3 font-medium">Kondisi Target</th>
                  <th className="py-2.5 px-3 text-right font-medium">Target / gr</th>
                  <th className="py-2.5 px-3 text-right font-medium">Harga Saat Ini</th>
                  <th className="py-2.5 px-3 font-medium">Status</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Kirim Notifikasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {evaluatedAlerts.map((item) => (
                  <tr
                    key={item.id}
                    className={
                      item.isTriggered && item.status === 'active'
                        ? 'bg-amber-50/60'
                        : 'hover:bg-stone-50'
                    }
                  >
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-stone-900">{item.customerName}</div>
                      <div className="font-mono text-[11px] text-stone-500">
                        {item.customerPhone}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      <div>
                        <span className="font-mono font-semibold">{item.karat}</span> ·{' '}
                        {item.alertType === 'buy_below'
                          ? 'Beli saat Harga Jual <='
                          : 'Buyback saat Harga >='}
                      </div>
                      {item.notes ? (
                        <div className="text-[11px] text-stone-500">{item.notes}</div>
                      ) : null}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-stone-900">
                      {formatRupiah(item.targetPricePerGram)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-stone-700">
                      {formatRupiah(item.currentRelevantPrice)}
                    </td>
                    <td className="py-3 px-3">
                      {item.status === 'notified' ? (
                        <span className="text-stone-500">Sudah Dikabari</span>
                      ) : item.isTriggered ? (
                        <span className="font-semibold text-emerald-800">Target Tercapai</span>
                      ) : (
                        <span className="text-stone-600">Memantau Pasar</span>
                      )}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <a
                          href={item.waLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => void markPriceAlertStatus(item.id, 'notified')}
                          className="inline-flex items-center gap-1 rounded-md bg-stone-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-stone-800 whitespace-nowrap"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>WhatsApp</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleCopyAlertMessage(item.id, item.message)}
                          className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                        >
                          {copiedId === item.id ? (
                            <Check className="h-3 w-3 text-emerald-700" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          <span>{copiedId === item.id ? 'Tersalin' : 'Salin'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void markPriceAlertStatus(item.id, 'cancelled')}
                          className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                          title="Hentikan pengingat"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Loyal Customers Directory */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-900">
              Buku Pelanggan Setia & Member Multi-Cabang
            </h3>
            <p className="mt-0.5 text-xs text-stone-500">
              Data poin loyalitas, status NPWP (tarif PPh 22 lebih ringan), dan akumulasi gramasi emas
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCustomerModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-50 whitespace-nowrap shrink-0"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Tambah Pelanggan</span>
          </button>
        </div>

        {customers.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-500">
            Belum ada data pelanggan setia terdaftar.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">Nama Pelanggan</th>
                  <th className="py-2.5 px-3 font-medium">WhatsApp · Status Pajak</th>
                  <th className="py-2.5 px-3 font-medium">Tingkat Member</th>
                  <th className="py-2.5 px-3 text-right font-medium">Transaksi</th>
                  <th className="py-2.5 px-3 text-right font-medium">Akumulasi Emas</th>
                  <th className="py-2.5 px-3 text-right font-medium">Poin</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Pengingat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="py-3 pr-3 font-semibold text-stone-900">{c.name}</td>
                    <td className="py-3 px-3 text-stone-600">
                      <span className="font-mono">{c.phone}</span> ·{' '}
                      <span>{c.hasNpwp ? `NPWP (${c.npwpNumber || 'Terdaftar'})` : 'Non-NPWP'}</span>
                    </td>
                    <td className="py-3 px-3 uppercase font-medium text-amber-800">{c.tier}</td>
                    <td className="py-3 px-3 text-right font-mono text-stone-700">
                      {c.totalTransactionsCount}x
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-stone-900">
                      {formatGrams(c.totalWeightGrams)}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-stone-700">
                      {c.loyaltyPoints}
                    </td>
                    <td className="py-3 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => openNewAlertModal(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 whitespace-nowrap"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Set Target Harga</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add Customer Modal */}
      {showCustomerModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleAddCustomer}
            className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-semibold text-stone-900">Registrasi Pelanggan Setia</h3>
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-stone-700">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700">
                  Nomor WhatsApp (Format 628...)
                </label>
                <input
                  type="text"
                  required
                  maxLength={30}
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700">Tingkat Member Awal</label>
                <select
                  value={custTier}
                  onChange={(e) => setCustTier(e.target.value as 'reguler' | 'prioritas' | 'vip')}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  <option value="reguler">Reguler</option>
                  <option value="prioritas">Prioritas</option>
                  <option value="vip">VIP</option>
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 font-medium text-stone-700">
                  <input
                    type="checkbox"
                    checked={custHasNpwp}
                    onChange={(e) => setCustHasNpwp(e.target.checked)}
                    className="rounded border-stone-300 text-amber-700"
                  />
                  <span>Memiliki NPWP (Tarif PPh 22 Logam Mulia 0,25%)</span>
                </label>
                {custHasNpwp ? (
                  <input
                    type="text"
                    placeholder="Nomor NPWP Pelanggan"
                    maxLength={32}
                    value={custNpwpNum}
                    onChange={(e) => setCustNpwpNum(e.target.value)}
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm"
                  />
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingCustomer}
                className="rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
              >
                {savingCustomer ? 'Menyimpan...' : 'Simpan Pelanggan'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Create Price Alert Modal */}
      {showAlertModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleAddAlert}
            className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <h3 className="text-base font-semibold text-stone-900">
                Buat Notifikasi Target Harga Emas
              </h3>
              <button
                type="button"
                onClick={() => setShowAlertModal(false)}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-stone-700">Pilih Pelanggan Setia</label>
                <select
                  required
                  value={alertCustomerId}
                  onChange={(e) => setAlertCustomerId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-stone-700">Kadar Pantauan</label>
                  <select
                    value={alertKarat}
                    onChange={(e) => {
                      const nextK = e.target.value as KaratCode;
                      setAlertKarat(nextK);
                      const row = karatMatrix.find((r) => r.karat === nextK);
                      if (row) {
                        setTargetPrice(
                          alertType === 'buy_below' ? row.sellPerGram : row.buybackPerGram
                        );
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    {KARAT_SPECS.map((k) => (
                      <option key={k.karat} value={k.karat}>
                        {k.karat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-stone-700">Arah Target</label>
                  <select
                    value={alertType}
                    onChange={(e) => {
                      const nextType = e.target.value as 'buy_below' | 'sell_above';
                      setAlertType(nextType);
                      const row = karatMatrix.find((r) => r.karat === alertKarat);
                      if (row) {
                        setTargetPrice(
                          nextType === 'buy_below' ? row.sellPerGram : row.buybackPerGram
                        );
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  >
                    <option value="buy_below">Ingin Beli (Saat Harga Turun &lt;=)</option>
                    <option value="sell_above">Ingin Jual/Buyback (Saat Naik &gt;=)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-stone-700">
                  Target Harga per Gram (Rp)
                </label>
                <input
                  type="number"
                  required
                  min="10000"
                  step="1000"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(Number.parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 font-mono text-sm tabular-nums"
                />
              </div>

              <div>
                <label className="block font-medium text-stone-700">Catatan Kebutuhan</label>
                <input
                  type="text"
                  maxLength={200}
                  placeholder="Misal: Pesan LM 50g jika harga menyentuh target"
                  value={alertNotes}
                  onChange={(e) => setAlertNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAlertModal(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingAlert}
                className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {savingAlert ? 'Menyimpan...' : 'Aktifkan Notifikasi'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

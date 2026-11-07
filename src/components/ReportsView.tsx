import { Ban, Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { voidTransactionRecord } from '../services/firestoreService';
import type { Branch, GoldTransaction, StoreSetting } from '../types';
import { formatGrams, formatRupiah, formatTimestampId } from '../utils/goldMath';

interface ReportsViewProps {
  activeBranch: Branch | null;
  branches: Branch[];
  transactions: GoldTransaction[];
  storeSetting: StoreSetting;
  onOpenReceipt: (tx: GoldTransaction) => void;
}

export function ReportsView({
  activeBranch,
  branches,
  transactions,
  storeSetting,
  onOpenReceipt,
}: ReportsViewProps) {
  const [reportTab, setReportTab] = useState<'operational_pnl' | 'official_tax'>('operational_pnl');

  const validTransactions = useMemo(() => {
    return transactions.filter(
      (t) => t.status === 'completed' && (!activeBranch || t.branchId === activeBranch.id)
    );
  }, [transactions, activeBranch]);

  const pnlSummary = useMemo(() => {
    let grossSalesDpp = 0;
    let totalCogs = 0;
    let makingChargeIncome = 0;
    let totalSoldWeight = 0;
    let totalBuybackPayout = 0;
    let totalBuybackWeight = 0;
    let totalPpnCollected = 0;
    let totalPph22Collected = 0;

    for (const tx of validTransactions) {
      if (tx.txType === 'sale') {
        grossSalesDpp += tx.dppAmount;
        totalCogs += Math.round(tx.weightGrams * tx.costPerGram);
        makingChargeIncome += tx.makingCharge;
        totalSoldWeight += tx.weightGrams;
        totalPpnCollected += tx.ppnAmount;
        totalPph22Collected += tx.pph22Amount;
      } else {
        totalBuybackPayout += tx.totalAmount;
        totalBuybackWeight += tx.weightGrams;
      }
    }

    const grossProfit = grossSalesDpp - totalCogs;
    const relevantBranches = activeBranch ? [activeBranch] : branches.filter((b) => b.isActive);
    const monthlyOpCost = relevantBranches.reduce(
      (acc, b) => acc + (b.monthlyOperationalCost || 0),
      0
    );
    const netOperatingProfit = grossProfit - monthlyOpCost;

    return {
      grossSalesDpp,
      totalCogs,
      makingChargeIncome,
      grossProfit,
      monthlyOpCost,
      netOperatingProfit,
      totalSoldWeight,
      totalBuybackPayout,
      totalBuybackWeight,
      totalPpnCollected,
      totalPph22Collected,
    };
  }, [validTransactions, activeBranch, branches]);

  const perBranchBreakdown = useMemo(() => {
    return branches.map((b) => {
      const bTxs = transactions.filter((t) => t.status === 'completed' && t.branchId === b.id);
      let sales = 0;
      let cogs = 0;
      let buybacks = 0;
      for (const tx of bTxs) {
        if (tx.txType === 'sale') {
          sales += tx.dppAmount;
          cogs += Math.round(tx.weightGrams * tx.costPerGram);
        } else {
          buybacks += tx.totalAmount;
        }
      }
      const grossProfit = sales - cogs;
      const netProfit = grossProfit - b.monthlyOperationalCost;
      return {
        branch: b,
        txCount: bTxs.length,
        sales,
        cogs,
        buybacks,
        grossProfit,
        netProfit,
      };
    });
  }, [branches, transactions]);

  const handleExportCsv = () => {
    const headers =
      reportTab === 'operational_pnl'
        ? [
            'No_Nota',
            'Waktu',
            'Cabang',
            'Jenis',
            'Pelanggan',
            'SKU',
            'Kadar',
            'Berat_Gram',
            'DPP_Aktual_IDR',
            'HPP_Modal_IDR',
            'Ongkos_IDR',
            'Estimasi_Laba_Kotor_IDR',
          ]
        : [
            'No_Nota',
            'Waktu',
            'Cabang',
            'NPWP_Pelanggan',
            'Kategori',
            'Kadar',
            'Berat_Gram',
            'DPP_Aktual_100Persen_IDR',
            'PPN_Perhiasan_PMK48_IDR',
            'PPh22_LM_PMK48_IDR',
            'Total_Tagihan_IDR',
          ];

    const rows = validTransactions.map((tx) => {
      const cogs = Math.round(tx.weightGrams * tx.costPerGram);
      const gp = tx.txType === 'sale' ? tx.dppAmount - cogs : 0;
      return reportTab === 'operational_pnl'
        ? [
            tx.invoiceNumber,
            formatTimestampId(tx.createdAt),
            tx.branchName,
            tx.txType,
            `"${tx.customerName}"`,
            tx.sku,
            tx.karat,
            tx.weightGrams,
            tx.dppAmount,
            cogs,
            tx.makingCharge,
            gp,
          ].join(',')
        : [
            tx.invoiceNumber,
            formatTimestampId(tx.createdAt),
            tx.branchName,
            tx.customerHasNpwp ? 'Ya' : 'Tidak',
            tx.category,
            tx.karat,
            tx.weightGrams,
            tx.dppAmount,
            tx.ppnAmount,
            tx.pph22Amount,
            tx.totalAmount,
          ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AurumPOS_${reportTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Report Mode Switcher & Export Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-center gap-1 rounded-lg bg-stone-100 p-1">
          <button
            type="button"
            onClick={() => setReportTab('operational_pnl')}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              reportTab === 'operational_pnl'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Laporan Laba Rugi Operasional
          </button>
          <button
            type="button"
            onClick={() => setReportTab('official_tax')}
            className={`rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
              reportTab === 'official_tax'
                ? 'bg-white text-stone-900 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            Rekapitulasi Pajak Resmi (PMK 48/2023)
          </button>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-xs font-semibold text-white hover:bg-stone-800 whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Unduh CSV</span>
        </button>
      </div>

      {reportTab === 'operational_pnl' ? (
        <>
          {/* Operational Profit & Loss Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Omzet Penjualan Bersih (DPP)</div>
              <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-stone-900">
                {formatRupiah(pnlSummary.grossSalesDpp)}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                Terjual {formatGrams(pnlSummary.totalSoldWeight)}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Harga Pokok Emas Terjual (HPP)</div>
              <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-stone-700">
                {formatRupiah(pnlSummary.totalCogs)}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                Ongkos bikin: {formatRupiah(pnlSummary.makingChargeIncome)}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Laba Kotor Penjualan</div>
              <div className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-emerald-800">
                {formatRupiah(pnlSummary.grossProfit)}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                Buyback masuk: {formatGrams(pnlSummary.totalBuybackWeight)} (
                {formatRupiah(pnlSummary.totalBuybackPayout)})
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="text-xs text-stone-500">Laba Bersih (Setelah Beban Cabang)</div>
              <div
                className={`mt-1.5 font-mono text-2xl font-bold tabular-nums ${
                  pnlSummary.netOperatingProfit >= 0 ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {formatRupiah(pnlSummary.netOperatingProfit)}
              </div>
              <div className="mt-1 text-xs text-stone-500">
                Beban operasional: {formatRupiah(pnlSummary.monthlyOpCost)}/bln
              </div>
            </div>
          </div>

          {/* Multi-Branch Consolidation Table */}
          {!activeBranch ? (
            <section className="rounded-xl border border-stone-200 bg-white p-6">
              <h3 className="text-sm font-semibold text-stone-900">
                Perbandingan Kinerja Laba Rugi Antar-Cabang
              </h3>
              <p className="mt-0.5 text-xs text-stone-500">
                Konsolidasi otomatis seluruh cabang fisik {storeSetting.storeName}
              </p>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500">
                      <th className="py-2.5 pr-3 font-medium">Cabang Toko</th>
                      <th className="py-2.5 px-3 text-right font-medium">Transaksi</th>
                      <th className="py-2.5 px-3 text-right font-medium">Omzet Penjualan</th>
                      <th className="py-2.5 px-3 text-right font-medium">HPP Terjual</th>
                      <th className="py-2.5 px-3 text-right font-medium">Laba Kotor</th>
                      <th className="py-2.5 px-3 text-right font-medium">Beban Bulanan</th>
                      <th className="py-2.5 pl-3 text-right font-medium">Laba Bersih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 tabular-nums">
                    {perBranchBreakdown.map((row) => (
                      <tr key={row.branch.id} className="hover:bg-stone-50">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-stone-900">{row.branch.name}</div>
                          <div className="text-[11px] text-stone-500">
                            {row.branch.code} · {row.branch.city}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">{row.txCount}</td>
                        <td className="py-3 px-3 text-right font-mono font-medium text-stone-900">
                          {formatRupiah(row.sales)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-stone-600">
                          {formatRupiah(row.cogs)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-800">
                          {formatRupiah(row.grossProfit)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-stone-600">
                          {formatRupiah(row.branch.monthlyOperationalCost)}
                        </td>
                        <td
                          className={`py-3 pl-3 text-right font-mono font-semibold ${
                            row.netProfit >= 0 ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {formatRupiah(row.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        /* Official Transparent Tax Report (PMK 48/2023) */
        <section className="space-y-4">
          <div className="rounded-xl border border-stone-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
              <div>
                <h3 className="text-sm font-semibold text-stone-900">
                  Rekapitulasi Pajak Emas Transparan — Sesuai PMK No. 48 Tahun 2023
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-stone-600">
                  Laporan ini menyajikan 100% nilai transaksi aktual tanpa pengurangan buatan. Sesuai ketentuan perpajakan emas di Indonesia (PMK 48/2023), penyerahan Emas Perhiasan kepada konsumen akhir menggunakan tarif PPN Besaran Tertentu sebesar <strong>1,1% dari harga jual aktual</strong>, sedangkan penjualan Emas Batangan (Logam Mulia 24K) dibebaskan PPN (PP 49/2022) dan dikenakan PPh Pasal 22 sebesar <strong>0,25% (ber-NPWP)</strong> atau <strong>0,50% (non-NPWP)</strong>.
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-stone-100 pt-5 sm:grid-cols-3">
              <div>
                <div className="text-xs text-stone-500">Dasar Pengenaan Pajak (DPP Aktual 100%)</div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-stone-900">
                  {formatRupiah(pnlSummary.grossSalesDpp)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500">Total PPN Emas Perhiasan (1,1%)</div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-800">
                  {formatRupiah(pnlSummary.totalPpnCollected)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500">Total PPh Pasal 22 Logam Mulia</div>
                <div className="mt-1 font-mono text-xl font-bold tabular-nums text-stone-900">
                  {formatRupiah(pnlSummary.totalPph22Collected)}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Detailed Transaction Ledger */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h3 className="text-sm font-semibold text-stone-900">
          Buku Besar Transaksi ({activeBranch ? activeBranch.name : 'Konsolidasi Semua Cabang'})
        </h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Catatan permanen yang dilindungi aturan keamanan audit; transaksi hanya dapat dibatalkan (Void) tanpa mengubah angka historis
        </p>

        {transactions.length === 0 ? (
          <div className="py-8 text-center text-xs text-stone-500">
            Belum ada catatan transaksi.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-stone-500">
                  <th className="py-2.5 pr-3 font-medium">No. Nota & Cabang</th>
                  <th className="py-2.5 px-3 font-medium">Jenis · Barang</th>
                  <th className="py-2.5 px-3 text-right font-medium">Berat</th>
                  <th className="py-2.5 px-3 text-right font-medium">DPP Aktual</th>
                  <th className="py-2.5 px-3 text-right font-medium">
                    {reportTab === 'operational_pnl' ? 'Laba Kotor' : 'PPN + PPh 22'}
                  </th>
                  <th className="py-2.5 px-3 text-right font-medium">Total Kas</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 tabular-nums">
                {transactions
                  .filter((t) => !activeBranch || t.branchId === activeBranch.id)
                  .map((tx) => {
                    const cogs = Math.round(tx.weightGrams * tx.costPerGram);
                    const gp = tx.txType === 'sale' ? tx.dppAmount - cogs : 0;
                    const taxes = tx.ppnAmount + tx.pph22Amount;
                    return (
                      <tr
                        key={tx.id}
                        className={`hover:bg-stone-50 ${
                          tx.status === 'voided' ? 'opacity-50 line-through' : ''
                        }`}
                      >
                        <td className="py-3 pr-3">
                          <div className="font-mono font-semibold text-stone-900">
                            {tx.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-stone-500">
                            {tx.branchName} · {formatTimestampId(tx.createdAt)}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-stone-700">
                          <span
                            className={
                              tx.txType === 'sale'
                                ? 'font-semibold text-emerald-800'
                                : 'font-semibold text-amber-800'
                            }
                          >
                            {tx.txType === 'sale' ? 'Jual' : 'Buyback'}
                          </span>
                          {' · '}
                          <span>
                            {tx.itemName} ({tx.karat})
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {formatGrams(tx.weightGrams)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-stone-800">
                          {formatRupiah(tx.dppAmount)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-medium text-emerald-800">
                          {reportTab === 'operational_pnl'
                            ? tx.txType === 'sale'
                              ? formatRupiah(gp)
                              : '-'
                            : formatRupiah(taxes)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold text-stone-900">
                          {formatRupiah(tx.totalAmount)}
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onOpenReceipt(tx)}
                              className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700 hover:bg-stone-100"
                              title="Cetak Nota"
                            >
                              <Printer className="h-3 w-3" />
                              <span>Nota</span>
                            </button>
                            {tx.status === 'completed' ? (
                              <button
                                type="button"
                                onClick={() => void voidTransactionRecord(tx.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                title="Batalkan (Void)"
                              >
                                <Ban className="h-3 w-3" />
                                <span>Void</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

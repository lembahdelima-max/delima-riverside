import { Bluetooth, Check, Copy, Printer, X } from 'lucide-react';
import { useState } from 'react';
import { printerService } from '../services/hardwareService';
import type { GoldTransaction, PrinterState, StoreSetting } from '../types';
import { formatGrams, formatRupiah, formatTimestampId } from '../utils/goldMath';

interface ReceiptModalProps {
  transaction: GoldTransaction | null;
  storeSetting: StoreSetting;
  printerState: PrinterState;
  onClose: () => void;
}

export function ReceiptModal({
  transaction,
  storeSetting,
  printerState,
  onClose,
}: ReceiptModalProps) {
  const [printingBle, setPrintingBle] = useState(false);
  const [bleSuccess, setBleSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!transaction) return null;

  const handleBluetoothPrint = async () => {
    setPrintingBle(true);
    setBleSuccess(false);
    const ok = await printerService.printReceiptBluetooth(transaction, storeSetting);
    setPrintingBle(false);
    if (ok) {
      setBleSuccess(true);
      setTimeout(() => setBleSuccess(false), 3000);
    }
  };

  const handleSystemPrint = () => {
    window.print();
  };

  const handleCopyDigitalReceipt = async () => {
    const text = [
      `*${storeSetting.storeName.toUpperCase()}*`,
      `${transaction.branchName}`,
      `--------------------------------`,
      transaction.txType === 'sale' ? `*SURAT PEMBELIAN EMAS*` : `*NOTA BUYBACK EMAS*`,
      `No. Nota: ${transaction.invoiceNumber}`,
      `Tanggal : ${formatTimestampId(transaction.createdAt || new Date().toISOString())}`,
      `Pelanggan: ${transaction.customerName}`,
      `--------------------------------`,
      `Barang  : ${transaction.itemName} (${transaction.sku})`,
      `Kadar   : ${transaction.karat} (${transaction.purityPercent}%)`,
      `Berat   : ${formatGrams(transaction.weightGrams)}`,
      `Harga/gr: ${formatRupiah(transaction.pricePerGram)}`,
      transaction.makingCharge > 0 ? `Ongkos  : ${formatRupiah(transaction.makingCharge)}` : null,
      transaction.deductionAmount > 0
        ? `Potongan: -${formatRupiah(transaction.deductionAmount)}`
        : null,
      `DPP     : ${formatRupiah(transaction.dppAmount)}`,
      transaction.ppnAmount > 0 ? `PPN 1,1%: ${formatRupiah(transaction.ppnAmount)}` : null,
      transaction.pph22Amount > 0 ? `PPh 22  : ${formatRupiah(transaction.pph22Amount)}` : null,
      `*TOTAL  : ${formatRupiah(transaction.totalAmount)}*`,
      `Metode  : ${transaction.paymentMethod.toUpperCase()}`,
      `--------------------------------`,
      storeSetting.receiptFooterNote,
    ]
      .filter(Boolean)
      .join('\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-stone-900">
              Nota Digital & Surat Emas
            </h3>
            <p className="text-xs text-stone-500">
              Siap cetak ke printer thermal Bluetooth ({printerState.paperWidthMm}mm) atau PDF
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            aria-label="Tutup"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto bg-stone-50 p-5">
          {/* Printable Receipt Paper */}
          <div
            id="printable-gold-receipt"
            className="mx-auto w-full max-w-[320px] border border-stone-300 bg-white p-5 font-mono text-xs text-stone-900"
          >
            <div className="text-center">
              <div className="text-sm font-bold tracking-tight">
                {storeSetting.storeName.toUpperCase()}
              </div>
              <div className="mt-0.5 text-[11px] text-stone-600">{transaction.branchName}</div>
              {storeSetting.npwpStore ? (
                <div className="text-[10px] text-stone-500">NPWP: {storeSetting.npwpStore}</div>
              ) : null}
            </div>

            <div className="my-3 border-t border-dashed border-stone-300" />

            <div className="text-center font-semibold">
              {transaction.txType === 'sale'
                ? 'SURAT JAMINAN PEMBELIAN EMAS'
                : 'NOTA TERIMA BUYBACK EMAS'}
            </div>

            <div className="my-3 border-t border-dashed border-stone-300" />

            <div className="space-y-1 text-[11px] tabular-nums">
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">No. Nota</span>
                <span className="font-medium">{transaction.invoiceNumber}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Waktu</span>
                <span>{formatTimestampId(transaction.createdAt || new Date().toISOString())}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Pelanggan</span>
                <span className="text-right">{transaction.customerName}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-stone-500">Pembayaran</span>
                <span className="uppercase">{transaction.paymentMethod}</span>
              </div>
            </div>

            <div className="my-3 border-t border-dashed border-stone-300" />

            <div className="space-y-1.5 text-[11px] tabular-nums">
              <div className="font-semibold text-stone-900">
                {transaction.itemName} ({transaction.sku})
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Kadar / Kemurnian</span>
                <span>
                  {transaction.karat} ({transaction.purityPercent}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Berat Timbang</span>
                <span className="font-semibold">{formatGrams(transaction.weightGrams)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Sumber Timbangan</span>
                <span className="truncate max-w-[160px] text-right">{transaction.scaleSource}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Harga / gram</span>
                <span>{formatRupiah(transaction.pricePerGram)}</span>
              </div>
              {transaction.makingCharge > 0 ? (
                <div className="flex justify-between">
                  <span className="text-stone-500">Ongkos Bikin</span>
                  <span>{formatRupiah(transaction.makingCharge)}</span>
                </div>
              ) : null}
              {transaction.deductionAmount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-stone-500">Potongan / Diskon</span>
                  <span>-{formatRupiah(transaction.deductionAmount)}</span>
                </div>
              ) : null}
            </div>

            <div className="my-3 border-t border-dashed border-stone-300" />

            <div className="space-y-1 text-[11px] tabular-nums">
              <div className="flex justify-between">
                <span className="text-stone-500">Nilai Dasar (DPP)</span>
                <span>{formatRupiah(transaction.dppAmount)}</span>
              </div>
              {transaction.ppnAmount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-stone-500">PPN Perhiasan (1,1%)</span>
                  <span>{formatRupiah(transaction.ppnAmount)}</span>
                </div>
              ) : null}
              {transaction.pph22Amount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-stone-500">PPh Pasal 22</span>
                  <span>{formatRupiah(transaction.pph22Amount)}</span>
                </div>
              ) : null}
              <div className="mt-2 flex justify-between border-t border-stone-900 pt-2 text-sm font-bold">
                <span>TOTAL</span>
                <span>{formatRupiah(transaction.totalAmount)}</span>
              </div>
            </div>

            <div className="my-3 border-t border-dashed border-stone-300" />

            <p className="text-center text-[10px] leading-relaxed text-stone-600">
              {storeSetting.receiptFooterNote}
            </p>
          </div>

          {printerState.errorMessage ? (
            <p className="mt-3 text-center text-xs text-amber-800">{printerState.errorMessage}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t border-stone-200 p-4 sm:flex-row">
          <button
            type="button"
            onClick={handleBluetoothPrint}
            disabled={printingBle}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-60 whitespace-nowrap"
          >
            {bleSuccess ? <Check className="h-4 w-4" /> : <Bluetooth className="h-4 w-4" />}
            <span>
              {printingBle
                ? 'Mengirim ESC/POS...'
                : bleSuccess
                  ? 'Tercetak via Bluetooth'
                  : 'Cetak Bluetooth'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleSystemPrint}
            className="flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-xs font-medium text-stone-800 transition-colors hover:bg-stone-50 whitespace-nowrap"
          >
            <Printer className="h-4 w-4" />
            <span>Cetak Sistem / PDF</span>
          </button>

          <button
            type="button"
            onClick={handleCopyDigitalReceipt}
            className="flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-xs font-medium text-stone-800 transition-colors hover:bg-stone-50 whitespace-nowrap"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}
            <span>{copied ? 'Tersalin' : 'Salin Teks'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

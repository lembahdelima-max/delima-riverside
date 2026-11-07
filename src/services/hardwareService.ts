import type {
  GoldTransaction,
  PrinterState,
  ScaleSerialConfig,
  ScaleState,
  StoreSetting,
} from '../types';
import { formatGrams, formatRupiah, formatTimestampId } from '../utils/goldMath';

export interface ScaleBrandPreset {
  id: string;
  label: string;
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  sampleFrame: string;
}

export const SCALE_BRAND_PRESETS: ScaleBrandPreset[] = [
  {
    id: 'vibra_aj',
    label: 'Vibra AJ / SJ Jewelry Balance (RS-232 / USB)',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    sampleFrame: 'ST,+00012.450 g',
  },
  {
    id: 'mettler_sics',
    label: 'Mettler Toledo JS / ME Series (MT-SICS)',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    sampleFrame: 'S S      8.750 g',
  },
  {
    id: 'sartorius',
    label: 'Sartorius Entris / Practum Analytical',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'odd',
    sampleFrame: 'N +   15.200 g',
  },
  {
    id: 'and_fx',
    label: 'A&D (AND) FX-i / FZ-i Precision Scale',
    baudRate: 2400,
    dataBits: 7,
    stopBits: 1,
    parity: 'even',
    sampleFrame: 'ST,+00005.125 g',
  },
  {
    id: 'shimadzu_ohaus',
    label: 'Shimadzu UX / Ohaus Pioneer / Kern',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    sampleFrame: '     10.000 g',
  },
  {
    id: 'generic_auto',
    label: 'Universal Auto-Detect (Segala Merk ASCII)',
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    sampleFrame: '+  4.35 g',
  },
];

/**
 * Parses ASCII frames from Mettler Toledo, Vibra, Sartorius, A&D, Shimadzu, Ohaus, Kern, Camry, etc.
 * Automatically converts carat (ct), kilogram (kg), troy ounce (ozt/oz), and milligram (mg) to grams.
 */
export function parseUniversalScaleFrame(frame: string): {
  grams: number;
  isStable: boolean;
} | null {
  const cleaned = frame.trim();
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  const isUnstable =
    upper.startsWith('US') ||
    upper.startsWith('S D') ||
    upper.includes('UNSTABLE') ||
    upper.includes('?');
  const isStable = !isUnstable;

  const match = cleaned.match(/([+-]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|gr|gram|ct|ozt|oz|mg)?/i);
  if (!match) return null;

  const numStr = match[1].replace(/\s+/g, '').replace(',', '.');
  const rawVal = Number.parseFloat(numStr);
  if (!Number.isFinite(rawVal)) return null;

  const unit = (match[2] || 'g').toLowerCase();
  let grams = rawVal;
  if (unit === 'kg') grams = rawVal * 1000;
  else if (unit === 'ct') grams = rawVal * 0.2;
  else if (unit === 'ozt' || unit === 'oz') grams = rawVal * 31.1034768;
  else if (unit === 'mg') grams = rawVal / 1000;

  return {
    grams: Math.max(0, Number(grams.toFixed(3))),
    isStable,
  };
}

type ScaleListener = (state: ScaleState) => void;

class UniversalScaleService {
  private state: ScaleState = {
    mode: 'disconnected',
    deviceName: 'Belum Terhubung',
    rawGrossGrams: 0,
    tareGrams: 0,
    netGrams: 0,
    isStable: true,
    lastRawFrame: '',
    errorMessage: null,
  };

  private listeners = new Set<ScaleListener>();
  private serialPort: unknown = null;
  private serialReader: { cancel: () => Promise<void>; releaseLock: () => void } | null = null;
  private bleDevice: { gatt?: { connected?: boolean; disconnect: () => void } } | null = null;
  private hidDevice: { close: () => Promise<void> } | null = null;
  private wsClient: WebSocket | null = null;
  private wedgeHandler: ((e: KeyboardEvent) => void) | null = null;
  private wedgeBuffer = '';
  private wedgeTimer: number | null = null;

  subscribe(listener: ScaleListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): ScaleState {
    return this.state;
  }

  private emit(patch: Partial<ScaleState>) {
    const nextGross = patch.rawGrossGrams ?? this.state.rawGrossGrams;
    const nextTare = patch.tareGrams ?? this.state.tareGrams;
    const netGrams = Math.max(0, Number((nextGross - nextTare).toFixed(3)));
    this.state = {
      ...this.state,
      ...patch,
      netGrams,
    };
    this.listeners.forEach((fn) => fn(this.state));
  }

  tare() {
    this.emit({ tareGrams: this.state.rawGrossGrams, errorMessage: null });
  }

  zero() {
    this.emit({ rawGrossGrams: 0, tareGrams: 0, errorMessage: null });
  }

  async disconnectAll() {
    try {
      if (this.serialReader) {
        await this.serialReader.cancel();
        this.serialReader.releaseLock();
        this.serialReader = null;
      }
      if (this.serialPort && typeof (this.serialPort as { close?: () => Promise<void> }).close === 'function') {
        await (this.serialPort as { close: () => Promise<void> }).close();
      }
    } catch {
      // Ignore serial close errors
    }
    this.serialPort = null;

    try {
      if (this.bleDevice?.gatt?.connected) {
        this.bleDevice.gatt.disconnect();
      }
    } catch {
      // Ignore BLE disconnect errors
    }
    this.bleDevice = null;

    try {
      if (this.hidDevice) {
        await this.hidDevice.close();
      }
    } catch {
      // Ignore HID close errors
    }
    this.hidDevice = null;

    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }

    if (this.wedgeHandler) {
      window.removeEventListener('keydown', this.wedgeHandler);
      this.wedgeHandler = null;
    }

    this.emit({
      mode: 'disconnected',
      deviceName: 'Belum Terhubung',
      errorMessage: null,
      lastRawFrame: '',
    });
  }

  /**
   * 1. Web Serial API (USB-to-RS232 FTDI/CH340/PL2303, Direct USB Virtual COM)
   */
  async connectWebSerial(config: ScaleSerialConfig): Promise<void> {
    await this.disconnectAll();
    const nav = navigator as unknown as {
      serial?: {
        requestPort: () => Promise<{
          open: (opts: {
            baudRate: number;
            dataBits: number;
            stopBits: number;
            parity: string;
          }) => Promise<void>;
          readable?: ReadableStream<Uint8Array>;
          close: () => Promise<void>;
        }>;
      };
    };

    if (!nav.serial) {
      this.emit({
        errorMessage:
          'Browser ini tidak mengizinkan Web Serial API (gunakan Chrome/Edge desktop atau aktifkan Mode Kalibrasi Meja / Bridge).',
      });
      return;
    }

    try {
      const port = await nav.serial.requestPort();
      await port.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
      });
      this.serialPort = port;
      this.emit({
        mode: 'web_serial',
        deviceName: `RS-232/USB (${config.baudRate} bps · ${config.brandPreset})`,
        errorMessage: null,
      });

      if (port.readable) {
        const reader = port.readable.getReader();
        this.serialReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        void (async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) {
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split(/[\r\n]+/);
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                  const parsed = parseUniversalScaleFrame(line);
                  if (parsed) {
                    this.emit({
                      rawGrossGrams: parsed.grams,
                      isStable: parsed.isStable,
                      lastRawFrame: line.trim(),
                    });
                  }
                }
              }
            }
          } catch {
            // Stream closed
          }
        })();
      }
    } catch (err) {
      this.emit({
        errorMessage:
          err instanceof Error
            ? `Gagal menghubungkan port Serial: ${err.message}`
            : 'Koneksi Web Serial dibatalkan.',
      });
    }
  }

  /**
   * 2. Web Bluetooth BLE (GATT Weight Scale 0x181D & BLE Serial UART Scales)
   */
  async connectWebBluetooth(): Promise<void> {
    await this.disconnectAll();
    const nav = navigator as unknown as {
      bluetooth?: {
        requestDevice: (opts: Record<string, unknown>) => Promise<{
          name?: string;
          gatt?: {
            connected?: boolean;
            connect: () => Promise<{
              getPrimaryServices: () => Promise<
                Array<{
                  uuid: string;
                  getCharacteristics: () => Promise<
                    Array<{
                      uuid: string;
                      properties: { notify?: boolean };
                      startNotifications: () => Promise<void>;
                      addEventListener: (
                        type: string,
                        cb: (ev: { target: { value: DataView } }) => void
                      ) => void;
                    }>
                  >;
                }>
              >;
            }>;
            disconnect: () => void;
          };
        }>;
      };
    };

    if (!nav.bluetooth) {
      this.emit({
        errorMessage:
          'Web Bluetooth tidak tersedia pada browser/iframe saat ini. Buka aplikasi di tab penuh Chrome/Edge atau gunakan Mode Kalibrasi Meja.',
      });
      return;
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          0x181d, // Standard BLE Weight Scale Service
          '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / JDY BLE Serial Scales
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART BLE Scales
        ],
      });

      this.bleDevice = device;
      const server = await device.gatt!.connect();
      this.emit({
        mode: 'web_bluetooth',
        deviceName: device.name || 'Timbangan Bluetooth BLE',
        errorMessage: null,
      });

      const services = await server.getPrimaryServices();
      const decoder = new TextDecoder();

      for (const service of services) {
        const chars = await service.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.notify) {
            await ch.startNotifications();
            ch.addEventListener('characteristicvaluechanged', (ev) => {
              const dv = ev.target.value;
              // Standard GATT Weight Measurement 0x2A9D
              if (ch.uuid.includes('2a9d') && dv.byteLength >= 3) {
                const raw = dv.getUint16(1, true);
                const grams = Number((raw * 5).toFixed(2));
                this.emit({
                  rawGrossGrams: grams,
                  isStable: true,
                  lastRawFrame: `BLE 0x2A9D: ${grams}g`,
                });
                return;
              }
              // ASCII UART over BLE
              const text = decoder.decode(new Uint8Array(dv.buffer));
              const parsed = parseUniversalScaleFrame(text);
              if (parsed) {
                this.emit({
                  rawGrossGrams: parsed.grams,
                  isStable: parsed.isStable,
                  lastRawFrame: text.trim(),
                });
              }
            });
          }
        }
      }
    } catch (err) {
      this.emit({
        errorMessage:
          err instanceof Error
            ? `Koneksi Bluetooth Timbangan gagal: ${err.message}`
            : 'Pemilihan perangkat Bluetooth dibatalkan.',
      });
    }
  }

  /**
   * 3. WebHID API (Direct USB Point-of-Sale Weigh Scales 0x008D)
   */
  async connectWebHid(): Promise<void> {
    await this.disconnectAll();
    const nav = navigator as unknown as {
      hid?: {
        requestDevice: (opts: { filters: unknown[] }) => Promise<
          Array<{
            productName?: string;
            opened?: boolean;
            open: () => Promise<void>;
            close: () => Promise<void>;
            addEventListener: (
              type: string,
              cb: (ev: { data: DataView }) => void
            ) => void;
          }>
        >;
      };
    };

    if (!nav.hid) {
      this.emit({
        errorMessage:
          'WebHID tidak diizinkan pada lingkungan browser ini. Gunakan Chrome/Edge desktop atau Mode Kalibrasi Meja.',
      });
      return;
    }

    try {
      const devices = await nav.hid.requestDevice({ filters: [] });
      const dev = devices[0];
      if (!dev) return;

      if (!dev.opened) {
        await dev.open();
      }
      this.hidDevice = dev;
      this.emit({
        mode: 'web_hid',
        deviceName: dev.productName || 'Timbangan USB HID POS',
        errorMessage: null,
      });

      dev.addEventListener('inputreport', (ev) => {
        const dv = ev.data;
        if (dv.byteLength >= 5) {
          const status = dv.getUint8(0);
          const unitCode = dv.getUint8(1);
          const exp = dv.getInt8(2);
          const rawWeight = dv.getUint16(3, true);
          const scaled = rawWeight * Math.pow(10, exp);
          // USB POS HID Unit 2 = Grams, 11 = Ounces, 3 = Kilograms
          let grams = scaled;
          if (unitCode === 3) grams = scaled * 1000;
          else if (unitCode === 11) grams = scaled * 28.3495;
          this.emit({
            rawGrossGrams: Math.max(0, Number(grams.toFixed(3))),
            isStable: status === 4 || status === 2,
            lastRawFrame: `HID [status=${status}, raw=${rawWeight}]`,
          });
        }
      });
    } catch (err) {
      this.emit({
        errorMessage:
          err instanceof Error ? `Gagal membuka USB HID: ${err.message}` : 'USB HID dibatalkan.',
      });
    }
  }

  /**
   * 4. USB Keyboard Wedge Scale Listener (Plug-and-Play HID Keyboard Emulation Scales)
   */
  async enableKeyboardWedge(): Promise<void> {
    await this.disconnectAll();
    this.wedgeHandler = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        return;
      }
      if (e.key === 'Enter') {
        const parsed = parseUniversalScaleFrame(this.wedgeBuffer);
        if (parsed) {
          this.emit({
            rawGrossGrams: parsed.grams,
            isStable: true,
            lastRawFrame: `WEDGE: ${this.wedgeBuffer}`,
          });
        }
        this.wedgeBuffer = '';
        return;
      }
      if (e.key.length === 1) {
        this.wedgeBuffer += e.key;
        if (this.wedgeTimer) window.clearTimeout(this.wedgeTimer);
        this.wedgeTimer = window.setTimeout(() => {
          this.wedgeBuffer = '';
        }, 600);
      }
    };
    window.addEventListener('keydown', this.wedgeHandler);
    this.emit({
      mode: 'keyboard_wedge',
      deviceName: 'USB Keyboard Wedge (Siap Terima Ketikan Timbangan)',
      errorMessage: null,
    });
  }

  /**
   * 5. Network / Local WebSocket Serial Bridge (Wi-Fi / LAN / RS-232 Agent)
   */
  async connectWebSocketBridge(url: string): Promise<void> {
    await this.disconnectAll();
    try {
      const ws = new WebSocket(url);
      this.wsClient = ws;
      ws.onopen = () => {
        this.emit({
          mode: 'websocket_bridge',
          deviceName: `LAN/Wi-Fi Bridge (${url})`,
          errorMessage: null,
        });
      };
      ws.onmessage = (ev) => {
        const text = String(ev.data || '');
        const parsed = parseUniversalScaleFrame(text);
        if (parsed) {
          this.emit({
            rawGrossGrams: parsed.grams,
            isStable: parsed.isStable,
            lastRawFrame: text.trim(),
          });
        }
      };
      ws.onerror = () => {
        this.emit({
          errorMessage: `Tidak dapat menjangkau jembatan timbangan di ${url}. Pastikan agen jembatan lokal aktif.`,
        });
      };
    } catch (err) {
      this.emit({
        errorMessage: err instanceof Error ? err.message : 'URL WebSocket tidak valid.',
      });
    }
  }

  /**
   * 6. Precision Bench Calibrator (Interactive 0.001g Desk Mode & Protocol Tester)
   */
  async activateBenchCalibrator(initialGrams = 5.25, presetLabel = 'Sartorius / Vibra 0.001g'): Promise<void> {
    await this.disconnectAll();
    const clean = Math.max(0, Number(initialGrams.toFixed(3)));
    this.emit({
      mode: 'bench_calibrator',
      deviceName: `Meja Timbang Presisi (${presetLabel})`,
      rawGrossGrams: clean,
      tareGrams: 0,
      isStable: true,
      lastRawFrame: `ST,+${clean.toFixed(3)} g`,
      errorMessage: null,
    });
  }

  setBenchWeight(grams: number) {
    const clean = Math.max(0, Number((grams || 0).toFixed(3)));
    if (this.state.mode === 'disconnected') {
      this.emit({
        mode: 'bench_calibrator',
        deviceName: 'Meja Timbang Presisi (0.001g)',
        rawGrossGrams: clean,
        isStable: true,
        lastRawFrame: `ST,+${clean.toFixed(3)} g`,
        errorMessage: null,
      });
      return;
    }
    this.emit({
      rawGrossGrams: clean,
      isStable: true,
      lastRawFrame: `ST,+${clean.toFixed(3)} g`,
    });
  }
}

export const scaleService = new UniversalScaleService();

// ============================================================================
// Bluetooth ESC/POS Thermal Receipt Printer Service (58mm & 80mm)
// ============================================================================

type PrinterListener = (state: PrinterState) => void;

const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard BLE POS Printer
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Epson / Star / Xprinter BLE
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC SPP-over-BLE (Codeshop/Eppos/Panda)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Generic BLE Thermal Printer
];

function buildEscPosBytes(lines: Array<{ text: string; align?: 'left' | 'center'; bold?: boolean }>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: number[] = [0x1b, 0x40]; // ESC @ Initialize

  for (const line of lines) {
    // ESC a n (0 = left, 1 = center)
    chunks.push(0x1b, 0x61, line.align === 'center' ? 0x01 : 0x00);
    // ESC E n (Bold on/off)
    chunks.push(0x1b, 0x45, line.bold ? 0x01 : 0x00);
    const sanitized = line.text.replace(/[^\x20-\x7E]/g, '?');
    const encoded = encoder.encode(`${sanitized}\r\n`);
    for (const b of encoded) chunks.push(b);
  }

  // Feed 4 lines & Partial Cut (GS V 66 0)
  chunks.push(0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00);
  return new Uint8Array(chunks);
}

class BluetoothThermalPrinterService {
  private state: PrinterState = {
    connected: false,
    deviceName: 'Belum Terhubung',
    paperWidthMm: 58,
    errorMessage: null,
  };

  private listeners = new Set<PrinterListener>();
  private bleDevice: { gatt?: { connected?: boolean; disconnect: () => void } } | null = null;
  private writeChar: {
    writeValue?: (data: BufferSource) => Promise<void>;
    writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  } | null = null;

  subscribe(listener: PrinterListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PrinterState {
    return this.state;
  }

  setPaperWidth(width: 58 | 80) {
    this.emit({ paperWidthMm: width });
  }

  private emit(patch: Partial<PrinterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  async connectBluetooth(): Promise<boolean> {
    const nav = navigator as unknown as {
      bluetooth?: {
        requestDevice: (opts: Record<string, unknown>) => Promise<{
          name?: string;
          gatt?: {
            connected?: boolean;
            connect: () => Promise<{
              getPrimaryServices: () => Promise<
                Array<{
                  getCharacteristics: () => Promise<
                    Array<{
                      properties: { write?: boolean; writeWithoutResponse?: boolean };
                      writeValue?: (data: BufferSource) => Promise<void>;
                      writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
                    }>
                  >;
                }>
              >;
            }>;
            disconnect: () => void;
          };
        }>;
      };
    };

    if (!nav.bluetooth) {
      this.emit({
        errorMessage:
          'Web Bluetooth dibatasi pada browser/iframe saat ini. Gunakan tombol "Cetak Nota Sistem / PDF" atau buka aplikasi di tab penuh Chrome.',
      });
      return false;
    }

    try {
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_PRINTER_SERVICES,
      });

      const server = await device.gatt!.connect();
      const services = await server.getPrimaryServices();

      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            this.bleDevice = device;
            this.writeChar = ch;
            this.emit({
              connected: true,
              deviceName: device.name || 'Printer Thermal Bluetooth',
              errorMessage: null,
            });
            return true;
          }
        }
      }

      this.emit({
        errorMessage: 'Perangkat Bluetooth ditemukan tetapi tidak memiliki karakteristik cetak ESC/POS.',
      });
      return false;
    } catch (err) {
      this.emit({
        errorMessage:
          err instanceof Error
            ? `Gagal menghubungkan printer Bluetooth: ${err.message}`
            : 'Penyambungan printer dibatalkan.',
      });
      return false;
    }
  }

  disconnect() {
    try {
      if (this.bleDevice?.gatt?.connected) {
        this.bleDevice.gatt.disconnect();
      }
    } catch {
      // Ignore disconnect errors
    }
    this.bleDevice = null;
    this.writeChar = null;
    this.emit({
      connected: false,
      deviceName: 'Belum Terhubung',
      errorMessage: null,
    });
  }

  private async writeRawBytes(bytes: Uint8Array): Promise<void> {
    if (!this.writeChar) {
      throw new Error('Printer Bluetooth belum terhubung.');
    }
    const chunkSize = 64;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const slice = bytes.slice(offset, offset + chunkSize);
      if (this.writeChar.writeValueWithoutResponse) {
        await this.writeChar.writeValueWithoutResponse(slice);
      } else if (this.writeChar.writeValue) {
        await this.writeChar.writeValue(slice);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async printReceiptBluetooth(tx: GoldTransaction, store: StoreSetting): Promise<boolean> {
    if (!this.state.connected || !this.writeChar) {
      const ok = await this.connectBluetooth();
      if (!ok) return false;
    }

    const widthChars = this.state.paperWidthMm === 80 ? 46 : 32;
    const divider = '-'.repeat(widthChars);

    const lines: Array<{ text: string; align?: 'left' | 'center'; bold?: boolean }> = [
      { text: store.storeName.toUpperCase(), align: 'center', bold: true },
      { text: tx.branchName, align: 'center' },
      ...(store.npwpStore ? [{ text: `NPWP: ${store.npwpStore}`, align: 'center' as const }] : []),
      { text: divider },
      {
        text: tx.txType === 'sale' ? 'SURAT PEMBELIAN EMAS' : 'NOTA TERIMA BUYBACK EMAS',
        align: 'center',
        bold: true,
      },
      { text: divider },
      { text: `No. Nota : ${tx.invoiceNumber}` },
      { text: `Tanggal  : ${formatTimestampId(tx.createdAt || new Date().toISOString())}` },
      { text: `Pelanggan: ${tx.customerName}` },
      { text: `Metode   : ${tx.paymentMethod.toUpperCase()}` },
      { text: divider },
      { text: `${tx.itemName} (${tx.sku})`, bold: true },
      { text: `Kadar    : ${tx.karat} (${tx.purityPercent}%)` },
      { text: `Berat    : ${formatGrams(tx.weightGrams)}` },
      { text: `Harga/gr : ${formatRupiah(tx.pricePerGram)}` },
      ...(tx.makingCharge > 0 ? [{ text: `Ongkos   : ${formatRupiah(tx.makingCharge)}` }] : []),
      ...(tx.deductionAmount > 0
        ? [{ text: `Potongan : -${formatRupiah(tx.deductionAmount)}` }]
        : []),
      { text: `DPP      : ${formatRupiah(tx.dppAmount)}` },
      ...(tx.ppnAmount > 0 ? [{ text: `PPN 1.1% : ${formatRupiah(tx.ppnAmount)}` }] : []),
      ...(tx.pph22Amount > 0 ? [{ text: `PPh 22   : ${formatRupiah(tx.pph22Amount)}` }] : []),
      { text: divider },
      { text: `TOTAL    : ${formatRupiah(tx.totalAmount)}`, bold: true },
      { text: divider },
      {
        text: store.receiptFooterNote || 'Simpan surat emas ini sebagai bukti keaslian kadar & buyback.',
        align: 'center',
      },
    ];

    try {
      const payload = buildEscPosBytes(lines);
      await this.writeRawBytes(payload);
      this.emit({ errorMessage: null });
      return true;
    } catch (err) {
      this.emit({
        errorMessage: err instanceof Error ? err.message : 'Gagal mengirim data ke printer Bluetooth.',
      });
      return false;
    }
  }

  async printTestTicket(storeName: string): Promise<boolean> {
    if (!this.state.connected || !this.writeChar) {
      const ok = await this.connectBluetooth();
      if (!ok) return false;
    }
    try {
      const payload = buildEscPosBytes([
        { text: storeName.toUpperCase(), align: 'center', bold: true },
        { text: 'TES KONEKSI PRINTER BLUETOOTH', align: 'center' },
        { text: '--------------------------------', align: 'center' },
        { text: `Lebar Kertas: ${this.state.paperWidthMm}mm`, align: 'center' },
        { text: 'Status ESC/POS: SIAP CETAK NOTA', align: 'center', bold: true },
      ]);
      await this.writeRawBytes(payload);
      return true;
    } catch (err) {
      this.emit({
        errorMessage: err instanceof Error ? err.message : 'Gagal mencetak tiket uji.',
      });
      return false;
    }
  }
}

export const printerService = new BluetoothThermalPrinterService();

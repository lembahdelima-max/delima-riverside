import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  Branch,
  CategoryCode,
  Customer,
  GoldTransaction,
  InventoryItem,
  KaratCode,
  PaymentMethod,
  PriceAlert,
  StockTransfer,
  StoreSetting,
} from '../types';
import {
  clampNumber,
  clampText,
  getPurityForKarat,
  makeSafeDocId,
  sanitizePhone,
  sanitizeUpperCode,
  VALIDATION_MAX_LEN,
} from '../utils/goldMath';

export function subscribeOwnerData(
  uid: string,
  callbacks: {
    onSettings: (s: StoreSetting | null) => void;
    onBranches: (b: Branch[]) => void;
    onInventory: (i: InventoryItem[]) => void;
    onCustomers: (c: Customer[]) => void;
    onAlerts: (a: PriceAlert[]) => void;
    onTransactions: (t: GoldTransaction[]) => void;
    onTransfers: (tr: StockTransfer[]) => void;
    onReady: () => void;
  }
): () => void {
  const unsubs: Array<() => void> = [];
  let loadedCount = 0;
  const markLoaded = () => {
    loadedCount += 1;
    if (loadedCount >= 2) {
      callbacks.onReady();
    }
  };

  // 1. Store Settings (single doc by ownerId)
  const settingsPath = `storeSettings/${uid}`;
  unsubs.push(
    onSnapshot(
      doc(db, 'storeSettings', uid),
      (snap) => {
        if (snap.exists()) {
          callbacks.onSettings(snap.data() as StoreSetting);
        } else {
          callbacks.onSettings(null);
        }
        markLoaded();
      },
      (err) => handleFirestoreError(err, OperationType.GET, settingsPath)
    )
  );

  // 2. Branches
  unsubs.push(
    onSnapshot(
      query(collection(db, 'branches'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Branch, 'id'>) }));
        list.sort((a, b) => a.code.localeCompare(b.code));
        callbacks.onBranches(list);
        markLoaded();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    )
  );

  // 3. Inventory
  unsubs.push(
    onSnapshot(
      query(collection(db, 'inventory'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InventoryItem, 'id'>),
        }));
        list.sort((a, b) => a.sku.localeCompare(b.sku));
        callbacks.onInventory(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'inventory')
    )
  );

  // 4. Customers
  unsubs.push(
    onSnapshot(
      query(collection(db, 'customers'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Customer, 'id'>) }));
        list.sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
        callbacks.onCustomers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
    )
  );

  // 5. Price Alerts
  unsubs.push(
    onSnapshot(
      query(collection(db, 'priceAlerts'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriceAlert, 'id'>) }));
        callbacks.onAlerts(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'priceAlerts')
    )
  );

  // 6. Transactions
  unsubs.push(
    onSnapshot(
      query(collection(db, 'transactions'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<GoldTransaction, 'id'>),
        }));
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        callbacks.onTransactions(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    )
  );

  // 7. Stock Transfers
  unsubs.push(
    onSnapshot(
      query(collection(db, 'stockTransfers'), where('ownerId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StockTransfer, 'id'>),
        }));
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        callbacks.onTransfers(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'stockTransfers')
    )
  );

  return () => {
    unsubs.forEach((fn) => fn());
  };
}

export async function upsertStoreSettings(
  uid: string,
  input: Omit<StoreSetting, 'ownerId' | 'createdAt' | 'updatedAt'>,
  isExisting: boolean
): Promise<void> {
  const path = `storeSettings/${uid}`;
  const ref = doc(db, 'storeSettings', uid);
  const cleanPayload = {
    storeName: clampText(input.storeName, VALIDATION_MAX_LEN.STORE_NAME, 'Toko Emas Aurum Jaya'),
    npwpStore: clampText(input.npwpStore, VALIDATION_MAX_LEN.NPWP),
    sellMarginPercent: clampNumber(input.sellMarginPercent, 0, 50),
    buybackSpreadPerGram: Math.round(clampNumber(input.buybackSpreadPerGram, 0, 500000)),
    manualSpot24kOverride: Math.round(clampNumber(input.manualSpot24kOverride, 0, 50000000)),
    receiptFooterNote: clampText(input.receiptFooterNote, VALIDATION_MAX_LEN.FOOTER_NOTE),
    updatedAt: serverTimestamp(),
  };

  try {
    if (isExisting) {
      await updateDoc(ref, cleanPayload);
    } else {
      await setDoc(ref, {
        ownerId: uid,
        ...cleanPayload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, isExisting ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function createBranch(
  uid: string,
  input: {
    code: string;
    name: string;
    city: string;
    address: string;
    phone: string;
    managerName: string;
    monthlyOperationalCost: number;
  }
): Promise<string> {
  const branchId = makeSafeDocId('br');
  const path = `branches/${branchId}`;
  try {
    await setDoc(doc(db, 'branches', branchId), {
      ownerId: uid,
      code: sanitizeUpperCode(input.code, VALIDATION_MAX_LEN.BRANCH_CODE, 'CBG-01'),
      name: clampText(input.name, VALIDATION_MAX_LEN.BRANCH_NAME, 'Cabang Baru'),
      city: clampText(input.city, VALIDATION_MAX_LEN.CITY, 'Jakarta'),
      address: clampText(input.address, VALIDATION_MAX_LEN.ADDRESS, 'Jl. Utama No. 1'),
      phone: sanitizePhone(input.phone),
      managerName: clampText(input.managerName, VALIDATION_MAX_LEN.BRANCH_NAME, 'Kepala Toko'),
      monthlyOperationalCost: Math.round(clampNumber(input.monthlyOperationalCost, 0, 5000000000)),
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return branchId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateBranchDetails(
  branchId: string,
  input: {
    name: string;
    city: string;
    address: string;
    phone: string;
    managerName: string;
    monthlyOperationalCost: number;
    isActive: boolean;
  }
): Promise<void> {
  const path = `branches/${branchId}`;
  try {
    await updateDoc(doc(db, 'branches', branchId), {
      name: clampText(input.name, VALIDATION_MAX_LEN.BRANCH_NAME, 'Cabang'),
      city: clampText(input.city, VALIDATION_MAX_LEN.CITY, 'Jakarta'),
      address: clampText(input.address, VALIDATION_MAX_LEN.ADDRESS, '-'),
      phone: sanitizePhone(input.phone),
      managerName: clampText(input.managerName, VALIDATION_MAX_LEN.BRANCH_NAME, 'Kepala Toko'),
      monthlyOperationalCost: Math.round(clampNumber(input.monthlyOperationalCost, 0, 5000000000)),
      isActive: Boolean(input.isActive),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function createInventoryItem(
  uid: string,
  input: {
    branchId: string;
    sku: string;
    name: string;
    category: CategoryCode;
    karat: KaratCode;
    weightGrams: number;
    costPerGram: number;
    makingCharge: number;
    status?: 'available' | 'melting';
  }
): Promise<string> {
  const itemId = makeSafeDocId('inv');
  const path = `inventory/${itemId}`;
  try {
    await setDoc(doc(db, 'inventory', itemId), {
      ownerId: uid,
      branchId: input.branchId,
      sku: sanitizeUpperCode(input.sku, VALIDATION_MAX_LEN.SKU, `AU-${Date.now().toString().slice(-5)}`),
      name: clampText(input.name, VALIDATION_MAX_LEN.ITEM_NAME, 'Perhiasan Emas'),
      category: input.category,
      karat: input.karat,
      purityPercent: getPurityForKarat(input.karat),
      weightGrams: Number(clampNumber(input.weightGrams, 0.01, 100000).toFixed(3)),
      costPerGram: Math.round(clampNumber(input.costPerGram, 1000, 50000000)),
      makingCharge: Math.round(clampNumber(input.makingCharge, 0, 100000000)),
      status: input.status ?? 'available',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return itemId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateInventoryItemDetails(
  itemId: string,
  input: {
    name: string;
    category: CategoryCode;
    karat: KaratCode;
    weightGrams: number;
    costPerGram: number;
    makingCharge: number;
    status: 'available' | 'melting';
  }
): Promise<void> {
  const path = `inventory/${itemId}`;
  try {
    await updateDoc(doc(db, 'inventory', itemId), {
      name: clampText(input.name, VALIDATION_MAX_LEN.ITEM_NAME, 'Perhiasan Emas'),
      category: input.category,
      karat: input.karat,
      purityPercent: getPurityForKarat(input.karat),
      weightGrams: Number(clampNumber(input.weightGrams, 0.01, 100000).toFixed(3)),
      costPerGram: Math.round(clampNumber(input.costPerGram, 1000, 50000000)),
      makingCharge: Math.round(clampNumber(input.makingCharge, 0, 100000000)),
      status: input.status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteInventoryItem(itemId: string): Promise<void> {
  const path = `inventory/${itemId}`;
  try {
    await deleteDoc(doc(db, 'inventory', itemId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Atomic Inter-Branch Stock Transfer (enforced via Firestore getAfter rule)
 */
export async function transferInventoryBetweenBranches(params: {
  uid: string;
  item: InventoryItem;
  fromBranch: Branch;
  toBranch: Branch;
  notes: string;
}): Promise<void> {
  const { uid, item, fromBranch, toBranch, notes } = params;
  const transferId = makeSafeDocId('trf');
  const batch = writeBatch(db);

  batch.update(doc(db, 'inventory', item.id), {
    branchId: toBranch.id,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'stockTransfers', transferId), {
    ownerId: uid,
    inventoryItemId: item.id,
    sku: item.sku,
    itemName: item.name,
    karat: item.karat,
    weightGrams: item.weightGrams,
    fromBranchId: fromBranch.id,
    fromBranchName: fromBranch.name,
    toBranchId: toBranch.id,
    toBranchName: toBranch.name,
    notes: clampText(notes, VALIDATION_MAX_LEN.NOTES),
    status: 'completed',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `stockTransfers/${transferId}`);
  }
}

export async function createCustomer(
  uid: string,
  input: {
    branchId: string;
    name: string;
    phone: string;
    hasNpwp: boolean;
    npwpNumber: string;
    tier: 'reguler' | 'prioritas' | 'vip';
  }
): Promise<string> {
  const customerId = makeSafeDocId('cust');
  const path = `customers/${customerId}`;
  try {
    await setDoc(doc(db, 'customers', customerId), {
      ownerId: uid,
      branchId: input.branchId,
      name: clampText(input.name, VALIDATION_MAX_LEN.STORE_NAME, 'Pelanggan'),
      phone: sanitizePhone(input.phone),
      hasNpwp: Boolean(input.hasNpwp),
      npwpNumber: input.hasNpwp ? clampText(input.npwpNumber, VALIDATION_MAX_LEN.NPWP) : '',
      tier: input.tier,
      totalTransactionsCount: 0,
      totalWeightGrams: 0,
      loyaltyPoints: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return customerId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function createPriceAlert(
  uid: string,
  input: {
    customer: Customer;
    karat: KaratCode;
    alertType: 'buy_below' | 'sell_above';
    targetPricePerGram: number;
    notes: string;
  }
): Promise<string> {
  const alertId = makeSafeDocId('alrt');
  const path = `priceAlerts/${alertId}`;
  try {
    await setDoc(doc(db, 'priceAlerts', alertId), {
      ownerId: uid,
      customerId: input.customer.id,
      customerName: clampText(input.customer.name, VALIDATION_MAX_LEN.STORE_NAME, 'Pelanggan'),
      customerPhone: sanitizePhone(input.customer.phone),
      karat: input.karat,
      alertType: input.alertType,
      targetPricePerGram: Math.round(clampNumber(input.targetPricePerGram, 1000, 50000000)),
      status: 'active',
      notes: clampText(input.notes, VALIDATION_MAX_LEN.NOTES),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return alertId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function markPriceAlertStatus(
  alertId: string,
  status: 'notified' | 'cancelled' | 'active'
): Promise<void> {
  const path = `priceAlerts/${alertId}`;
  try {
    await updateDoc(doc(db, 'priceAlerts', alertId), {
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function recordPosTransaction(params: {
  uid: string;
  branch: Branch;
  txType: 'sale' | 'buyback';
  customer: Customer | null;
  walkInCustomerName: string;
  walkInHasNpwp: boolean;
  selectedInventoryItem: InventoryItem | null;
  sku: string;
  itemName: string;
  category: CategoryCode;
  karat: KaratCode;
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
  addBuybackToStock: boolean;
}): Promise<GoldTransaction> {
  const txId = makeSafeDocId('tx');
  const invoiceNumber = sanitizeUpperCode(
    `${params.txType === 'sale' ? 'INV' : 'BBK'}-${params.branch.code}-${Date.now().toString().slice(-6)}`,
    VALIDATION_MAX_LEN.SKU,
    'INV-0001'
  );

  const cleanSku = sanitizeUpperCode(
    params.selectedInventoryItem?.sku || params.sku,
    VALIDATION_MAX_LEN.SKU,
    `AU-${Date.now().toString().slice(-5)}`
  );
  const cleanItemName = clampText(
    params.selectedInventoryItem?.name || params.itemName,
    VALIDATION_MAX_LEN.ITEM_NAME,
    'Perhiasan Emas'
  );
  const cleanWeight = Number(clampNumber(params.weightGrams, 0.01, 100000).toFixed(3));
  const purityPercent = getPurityForKarat(params.karat);
  const customerName = params.customer
    ? clampText(params.customer.name, VALIDATION_MAX_LEN.STORE_NAME, 'Pelanggan')
    : clampText(params.walkInCustomerName, VALIDATION_MAX_LEN.STORE_NAME, 'Pelanggan Umum');
  const customerHasNpwp = params.customer ? params.customer.hasNpwp : Boolean(params.walkInHasNpwp);

  const txPayload = {
    ownerId: params.uid,
    branchId: params.branch.id,
    branchName: clampText(params.branch.name, VALIDATION_MAX_LEN.BRANCH_NAME, 'Cabang'),
    invoiceNumber,
    txType: params.txType,
    customerId: params.customer?.id ?? '',
    customerName,
    customerHasNpwp,
    inventoryItemId: params.selectedInventoryItem?.id ?? '',
    sku: cleanSku,
    itemName: cleanItemName,
    category: params.category,
    karat: params.karat,
    purityPercent,
    weightGrams: cleanWeight,
    scaleSource: clampText(params.scaleSource, VALIDATION_MAX_LEN.SCALE_SOURCE, 'Input Presisi'),
    pricePerGram: Math.round(clampNumber(params.pricePerGram, 1000, 50000000)),
    costPerGram: Math.round(clampNumber(params.costPerGram, 1000, 50000000)),
    makingCharge: Math.round(clampNumber(params.makingCharge, 0, 100000000)),
    deductionAmount: Math.round(clampNumber(params.deductionAmount, 0, 100000000)),
    dppAmount: Math.round(clampNumber(params.dppAmount, 0, 50000000000)),
    ppnAmount: Math.round(clampNumber(params.ppnAmount, 0, 5000000000)),
    pph22Amount: Math.round(clampNumber(params.pph22Amount, 0, 5000000000)),
    totalAmount: Math.round(clampNumber(params.totalAmount, 0, 55000000000)),
    paymentMethod: params.paymentMethod,
    status: 'completed' as const,
  };

  const batch = writeBatch(db);

  batch.set(doc(db, 'transactions', txId), {
    ...txPayload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Deduct sold item from branch inventory
  if (params.txType === 'sale' && params.selectedInventoryItem) {
    batch.update(doc(db, 'inventory', params.selectedInventoryItem.id), {
      status: 'sold',
      updatedAt: serverTimestamp(),
    });
  }

  // Add bought-back gold into branch inventory automatically
  if (params.txType === 'buyback' && params.addBuybackToStock) {
    const newInvId = makeSafeDocId('inv');
    const netEffectiveCostPerGram = Math.max(
      1000,
      Math.round(txPayload.totalAmount / cleanWeight)
    );
    batch.set(doc(db, 'inventory', newInvId), {
      ownerId: params.uid,
      branchId: params.branch.id,
      sku: sanitizeUpperCode(`BB-${Date.now().toString().slice(-6)}`, VALIDATION_MAX_LEN.SKU, 'BB-01'),
      name: clampText(`${cleanItemName} (Buyback)`, VALIDATION_MAX_LEN.ITEM_NAME, 'Emas Buyback'),
      category: params.category,
      karat: params.karat,
      purityPercent,
      weightGrams: cleanWeight,
      costPerGram: clampNumber(netEffectiveCostPerGram, 1000, 50000000),
      makingCharge: 0,
      status: params.category === 'leburan' ? 'melting' : 'available',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Update loyal customer points & cumulative weight
  if (params.customer) {
    const newCount = params.customer.totalTransactionsCount + 1;
    const newWeight = Number((params.customer.totalWeightGrams + cleanWeight).toFixed(3));
    const earnedPoints = Math.max(1, Math.floor(txPayload.totalAmount / 1_000_000));
    const newPoints = params.customer.loyaltyPoints + earnedPoints;
    const upgradedTier: 'reguler' | 'prioritas' | 'vip' =
      newWeight >= 50 || params.customer.tier === 'vip'
        ? 'vip'
        : newWeight >= 15 || params.customer.tier === 'prioritas'
          ? 'prioritas'
          : 'reguler';

    batch.update(doc(db, 'customers', params.customer.id), {
      tier: upgradedTier,
      totalTransactionsCount: newCount,
      totalWeightGrams: newWeight,
      loyaltyPoints: newPoints,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return {
      id: txId,
      ...txPayload,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `transactions/${txId}`);
  }
}

export async function voidTransactionRecord(txId: string): Promise<void> {
  const path = `transactions/${txId}`;
  try {
    await updateDoc(doc(db, 'transactions', txId), {
      status: 'voided',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

const inflightWorkspaceSeeds = new Map<string, Promise<void>>();

/**
 * Seeds initial multi-branch gold store workspace in 3 sequential batches
 * so parent relational exists() rules succeed deterministically.
 */
export async function seedInitialStoreWorkspace(uid: string, spot24k: number): Promise<void> {
  const existingTask = inflightWorkspaceSeeds.get(uid);
  if (existingTask) {
    return existingTask;
  }

  const task = runSeedInitialStoreWorkspace(uid, spot24k).finally(() => {
    inflightWorkspaceSeeds.delete(uid);
  });
  inflightWorkspaceSeeds.set(uid, task);
  return task;
}

async function runSeedInitialStoreWorkspace(uid: string, spot24k: number): Promise<void> {
  const settingsRef = doc(db, 'storeSettings', uid);
  try {
    const existing = await getDoc(settingsRef);
    if (existing.exists()) return;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `storeSettings/${uid}`);
  }

  const base24 = spot24k > 500000 ? spot24k : 1420000;
  const b1Id = `br_pusat_${uid.slice(0, 8)}`;
  const b2Id = `br_gading_${uid.slice(0, 8)}`;
  const b3Id = `br_sby_${uid.slice(0, 8)}`;

  // Step 1: Commit StoreSettings & 3 Physical Branches
  const batch1 = writeBatch(db);
  batch1.set(settingsRef, {
    ownerId: uid,
    storeName: 'Toko Emas Aurum Mulia',
    npwpStore: '01.384.920.4-021.000',
    sellMarginPercent: 3.5,
    buybackSpreadPerGram: 45000,
    manualSpot24kOverride: 0,
    receiptFooterNote:
      'Barang telah ditimbang di hadapan pembeli. Simpan Surat Emas ini untuk jaminan buyback di seluruh cabang.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'branches', b1Id), {
    ownerId: uid,
    code: 'JKT-PSB',
    name: 'Cabang Utama Pasar Baru',
    city: 'Jakarta Pusat',
    address: 'Jl. Pasar Baru Selatan No. 28, Sawah Besar',
    phone: '021-3849210',
    managerName: 'Hendra Gunawan',
    monthlyOperationalCost: 18500000,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'branches', b2Id), {
    ownerId: uid,
    code: 'JKT-MKG',
    name: 'Cabang Kelapa Gading',
    city: 'Jakarta Utara',
    address: 'Boulevard Raya Blok QJ-3 No. 14, Kelapa Gading',
    phone: '021-45841120',
    managerName: 'Dewi Kartika',
    monthlyOperationalCost: 22000000,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch1.set(doc(db, 'branches', b3Id), {
    ownerId: uid,
    code: 'SBY-TP',
    name: 'Cabang Tunjungan',
    city: 'Surabaya',
    address: 'Jl. Basuki Rahmat No. 82, Tegalsari',
    phone: '031-5318840',
    managerName: 'Arif Budiman',
    monthlyOperationalCost: 16000000,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'branches');
  }

  // Step 2: Commit Inventory & Loyal Customers
  const c1Id = `cust_1_${uid.slice(0, 8)}`;
  const c2Id = `cust_2_${uid.slice(0, 8)}`;
  const c3Id = `cust_3_${uid.slice(0, 8)}`;

  const batch2 = writeBatch(db);
  const sampleInventory: Array<{
    id: string;
    branchId: string;
    sku: string;
    name: string;
    category: CategoryCode;
    karat: KaratCode;
    weightGrams: number;
    costFactor: number;
    makingCharge: number;
  }> = [
    {
      id: `inv_1_${uid.slice(0, 8)}`,
      branchId: b1Id,
      sku: 'LM-ANT-10G',
      name: 'Logam Mulia Antam CertiEye 10g',
      category: 'logam_mulia',
      karat: '24K',
      weightGrams: 10.0,
      costFactor: 0.97,
      makingCharge: 0,
    },
    {
      id: `inv_2_${uid.slice(0, 8)}`,
      branchId: b1Id,
      sku: 'KLG-ITL-22K',
      name: 'Kalung Rantai Milano 22K',
      category: 'kalung',
      karat: '22K',
      weightGrams: 14.55,
      costFactor: 0.88,
      makingCharge: 350000,
    },
    {
      id: `inv_3_${uid.slice(0, 8)}`,
      branchId: b1Id,
      sku: 'CNC-KWN-18K',
      name: 'Cincin Kawin Klasik Sepasang 18K',
      category: 'cincin',
      karat: '18K',
      weightGrams: 6.8,
      costFactor: 0.72,
      makingCharge: 280000,
    },
    {
      id: `inv_4_${uid.slice(0, 8)}`,
      branchId: b2Id,
      sku: 'GLG-BGL-17K',
      name: 'Gelang Bangle Oval Ukir 17K',
      category: 'gelang',
      karat: '17K',
      weightGrams: 12.25,
      costFactor: 0.67,
      makingCharge: 300000,
    },
    {
      id: `inv_5_${uid.slice(0, 8)}`,
      branchId: b2Id,
      sku: 'LM-UBS-25G',
      name: 'Logam Mulia UBS 25g',
      category: 'logam_mulia',
      karat: '24K',
      weightGrams: 25.0,
      costFactor: 0.965,
      makingCharge: 0,
    },
    {
      id: `inv_6_${uid.slice(0, 8)}`,
      branchId: b3Id,
      sku: 'LNT-SLR-17K',
      name: 'Liontin Mahkota 17K',
      category: 'liontin',
      karat: '17K',
      weightGrams: 4.15,
      costFactor: 0.67,
      makingCharge: 175000,
    },
  ];

  for (const item of sampleInventory) {
    batch2.set(doc(db, 'inventory', item.id), {
      ownerId: uid,
      branchId: item.branchId,
      sku: item.sku,
      name: item.name,
      category: item.category,
      karat: item.karat,
      purityPercent: getPurityForKarat(item.karat),
      weightGrams: item.weightGrams,
      costPerGram: Math.round((base24 * item.costFactor) / 1000) * 1000,
      makingCharge: item.makingCharge,
      status: 'available',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch2.set(doc(db, 'customers', c1Id), {
    ownerId: uid,
    branchId: b1Id,
    name: 'Hj. Ratna Sari',
    phone: '6281288901122',
    hasNpwp: true,
    npwpNumber: '09.214.551.2-043.000',
    tier: 'vip',
    totalTransactionsCount: 8,
    totalWeightGrams: 84.5,
    loyaltyPoints: 120,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch2.set(doc(db, 'customers', c2Id), {
    ownerId: uid,
    branchId: b2Id,
    name: 'Bpk. Hendra Wijaya',
    phone: '628119402311',
    hasNpwp: true,
    npwpNumber: '07.881.320.1-045.000',
    tier: 'prioritas',
    totalTransactionsCount: 4,
    totalWeightGrams: 30.0,
    loyaltyPoints: 45,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch2.set(doc(db, 'customers', c3Id), {
    ownerId: uid,
    branchId: b3Id,
    name: 'Ibu Clarissa Tan',
    phone: '6281331098877',
    hasNpwp: false,
    npwpNumber: '',
    tier: 'reguler',
    totalTransactionsCount: 2,
    totalWeightGrams: 9.25,
    loyaltyPoints: 14,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'inventory_customers_seed');
  }

  // Step 3: Commit Price Alerts & Sample Transactions
  const batch3 = writeBatch(db);
  const sell24 = Math.round((base24 * 1.035) / 1000) * 1000;
  const sell17 = Math.round((base24 * (70 / 99.99) * 1.035) / 1000) * 1000;
  const buyback24 = Math.round((base24 - 45000) / 1000) * 1000;

  batch3.set(doc(db, 'priceAlerts', `alrt_1_${uid.slice(0, 8)}`), {
    ownerId: uid,
    customerId: c1Id,
    customerName: 'Hj. Ratna Sari',
    customerPhone: '6281288901122',
    karat: '24K',
    alertType: 'buy_below',
    targetPricePerGram: sell24 + 15000, // Triggered right away so user can test notification!
    status: 'active',
    notes: 'Ingin borong LM 25g saat harga jual di bawah batas target.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch3.set(doc(db, 'priceAlerts', `alrt_2_${uid.slice(0, 8)}`), {
    ownerId: uid,
    customerId: c2Id,
    customerName: 'Bpk. Hendra Wijaya',
    customerPhone: '628119402311',
    karat: '24K',
    alertType: 'sell_above',
    targetPricePerGram: buyback24 + 35000,
    status: 'active',
    notes: 'Siap buyback 50g koleksi lama jika harga buyback naik.',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Sample Sale 1 (Jewelry 17K at Branch 1)
  const dpp1 = Math.round(8.5 * sell17 + 250000);
  const ppn1 = Math.round(dpp1 * 0.011);
  batch3.set(doc(db, 'transactions', `tx_1_${uid.slice(0, 8)}`), {
    ownerId: uid,
    branchId: b1Id,
    branchName: 'Cabang Utama Pasar Baru',
    invoiceNumber: 'INV-JKT-PSB-1001',
    txType: 'sale',
    customerId: c1Id,
    customerName: 'Hj. Ratna Sari',
    customerHasNpwp: true,
    inventoryItemId: '',
    sku: 'GLG-RANTAI-17K',
    itemName: 'Gelang Rantai Sisik Naga 17K',
    category: 'gelang',
    karat: '17K',
    purityPercent: 70.0,
    weightGrams: 8.5,
    scaleSource: 'Vibra AJ RS-232 (9600 bps)',
    pricePerGram: sell17,
    costPerGram: Math.round((base24 * 0.67) / 1000) * 1000,
    makingCharge: 250000,
    deductionAmount: 0,
    dppAmount: dpp1,
    ppnAmount: ppn1,
    pph22Amount: 0,
    totalAmount: dpp1 + ppn1,
    paymentMethod: 'transfer',
    status: 'completed',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Sample Sale 2 (24K Bullion at Branch 2)
  const dpp2 = Math.round(10.0 * sell24);
  const pph2 = Math.round(dpp2 * 0.0025);
  batch3.set(doc(db, 'transactions', `tx_2_${uid.slice(0, 8)}`), {
    ownerId: uid,
    branchId: b2Id,
    branchName: 'Cabang Kelapa Gading',
    invoiceNumber: 'INV-JKT-MKG-1002',
    txType: 'sale',
    customerId: c2Id,
    customerName: 'Bpk. Hendra Wijaya',
    customerHasNpwp: true,
    inventoryItemId: '',
    sku: 'LM-ANT-10G-A',
    itemName: 'Logam Mulia Antam 10g',
    category: 'logam_mulia',
    karat: '24K',
    purityPercent: 99.99,
    weightGrams: 10.0,
    scaleSource: 'Sartorius Entris USB',
    pricePerGram: sell24,
    costPerGram: Math.round((base24 * 0.97) / 1000) * 1000,
    makingCharge: 0,
    deductionAmount: 0,
    dppAmount: dpp2,
    ppnAmount: 0,
    pph22Amount: pph2,
    totalAmount: dpp2 + pph2,
    paymentMethod: 'debit',
    status: 'completed',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Sample Buyback (Branch 3)
  const dpp3 = Math.round(5.0 * buyback24 - 50000);
  batch3.set(doc(db, 'transactions', `tx_3_${uid.slice(0, 8)}`), {
    ownerId: uid,
    branchId: b3Id,
    branchName: 'Cabang Tunjungan',
    invoiceNumber: 'BBK-SBY-TP-2001',
    txType: 'buyback',
    customerId: c3Id,
    customerName: 'Ibu Clarissa Tan',
    customerHasNpwp: false,
    inventoryItemId: '',
    sku: 'BB-LM-5G',
    itemName: 'Buyback Emas Batangan 5g',
    category: 'logam_mulia',
    karat: '24K',
    purityPercent: 99.99,
    weightGrams: 5.0,
    scaleSource: 'Mettler Toledo SICS',
    pricePerGram: buyback24,
    costPerGram: buyback24,
    makingCharge: 0,
    deductionAmount: 50000,
    dppAmount: dpp3,
    ppnAmount: 0,
    pph22Amount: 0,
    totalAmount: dpp3,
    paymentMethod: 'tunai',
    status: 'completed',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch3.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'alerts_transactions_seed');
  }
}

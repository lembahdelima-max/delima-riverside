export interface DirtyDozenAssertion {
  id: number;
  name: string;
  collection: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authUid: string | null;
  emailVerified: boolean;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenAssertion[] = [
  { id: 1, name: 'Identity Spoofing on Branch Create', collection: 'branches/b1', operation: 'create', authUid: 'attacker', emailVerified: true, payload: { ownerId: 'victim' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 2, name: 'Unverified Email Write Spoof', collection: 'branches/b1', operation: 'create', authUid: 'u1', emailVerified: false, payload: { ownerId: 'u1' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 3, name: 'Shadow Field Injection', collection: 'storeSettings/u1', operation: 'update', authUid: 'u1', emailVerified: true, payload: { ownerId: 'u1', ghostField: true }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 4, name: 'PII Cross-Tenant Scrape', collection: 'customers/c1', operation: 'get', authUid: 'attacker', emailVerified: true, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 5, name: 'Orphaned Inventory Creation', collection: 'inventory/i1', operation: 'create', authUid: 'u1', emailVerified: true, payload: { ownerId: 'u1', branchId: 'missing' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 6, name: 'Transaction Retroactive Amount Tampering', collection: 'transactions/t1', operation: 'update', authUid: 'u1', emailVerified: true, payload: { dppAmount: 100 }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 7, name: 'Voided Transaction Resurrection', collection: 'transactions/t_void', operation: 'update', authUid: 'u1', emailVerified: true, payload: { status: 'completed' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 8, name: 'Sold Inventory Mutation', collection: 'inventory/i_sold', operation: 'update', authUid: 'u1', emailVerified: true, payload: { weightGrams: 99 }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 9, name: 'Non-Atomic Stock Transfer', collection: 'stockTransfers/tr1', operation: 'create', authUid: 'u1', emailVerified: true, payload: { inventoryItemId: 'i1', toBranchId: 'b2' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 10, name: 'ID Poisoning Characters', collection: 'branches/bad$id', operation: 'create', authUid: 'u1', emailVerified: true, payload: { ownerId: 'u1' }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 11, name: 'Value Poisoning Negative Margin', collection: 'storeSettings/u1', operation: 'update', authUid: 'u1', emailVerified: true, payload: { sellMarginPercent: -50 }, expectedOutcome: 'PERMISSION_DENIED' },
  { id: 12, name: 'Forged Client Timestamp', collection: 'transactions/t2', operation: 'create', authUid: 'u1', emailVerified: true, payload: { createdAt: '2020-01-01T00:00:00Z' }, expectedOutcome: 'PERMISSION_DENIED' },
];

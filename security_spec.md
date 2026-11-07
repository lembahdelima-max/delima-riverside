# AurumPOS Firestore Security Specification (Phase 0 & Red Team Audit)

## 1. Data Invariants

1. **Tenant & Identity Ownership**: Every document in `storeSettings`, `branches`, `inventory`, `customers`, `priceAlerts`, `transactions`, and `stockTransfers` belongs exclusively to a verified authenticated user (`request.auth.uid == ownerId` and `request.auth.token.email_verified == true` for writes).
2. **Path & Size Hardening**: Every single-document path parameter (`ownerId`, `branchId`, `itemId`, `customerId`, `alertId`, `txId`, `transferId`) must match `^[a-zA-Z0-9_\-]+$` with length `1..128`. Every string field has an explicit `.size() <= MAX` bound.
3. **Relational Integrity**:
   - An `inventory`, `customers`, or `transactions` document cannot be created unless its `branchId` exists in `/branches/{branchId}` and belongs to `request.auth.uid`.
   - A `priceAlerts` document cannot be created unless its `customerId` exists in `/customers/{customerId}` and belongs to `request.auth.uid`.
   - A `stockTransfers` document requires both `fromBranchId` and `toBranchId` (distinct) plus `inventoryItemId` to belong to `request.auth.uid`, AND enforces atomic batch completion via `getAfter(/databases/$(database)/documents/inventory/$(incoming().inventoryItemId)).data.branchId == incoming().toBranchId`.
4. **PII Isolation**: Customer phone numbers and NPWP records in `/customers` and `/priceAlerts` are strictly isolated to `resource.data.ownerId == request.auth.uid` on both `get` and `list`.
5. **Financial Immutability & Terminal State Locking**:
   - `transactions` cannot be deleted (`allow delete: if false`). Once `status == 'completed'`, the only permitted mutation is `voidTransaction` (`status: 'voided'`). Once `status == 'voided'`, all updates are permanently rejected. Transaction financial figures (`dppAmount`, `totalAmount`, `weightGrams`) can never be altered after creation.
   - `inventory` items with `status == 'sold'` are terminal and cannot be modified.
   - `priceAlerts` with `status == 'cancelled'` are terminal and cannot be modified.
   - `stockTransfers` are append-only (`allow update, delete: if false`).
6. **Temporal Integrity**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on every write.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Identity Spoofing on Branch Create**: `{ "ownerId": "victim_uid_99", "code": "JKT-01", ... }` -> `PERMISSION_DENIED` (`data.ownerId == request.auth.uid` fails).
2. **Unverified Email Write Spoof**: Authenticated token with `email_verified: false` creating `/branches/b1` -> `PERMISSION_DENIED` (`isVerified()` fails).
3. **Shadow / Ghost Field Injection**: Updating `/storeSettings/{uid}` with valid keys plus `"isTaxExempt": true` -> `PERMISSION_DENIED` (`hasOnly` in `isValidStoreSetting` and `affectedKeys().hasOnly(...)` reject extra keys).
4. **PII Cross-Tenant Scrape (`get` & `list`)**: User B querying `/customers` without filtering or reading `/customers/cust_user_a` -> `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid` fails).
5. **Orphaned Inventory Creation**: Creating `/inventory/item1` with `branchId: "non_existent_branch"` or a `branchId` owned by another user -> `PERMISSION_DENIED` (`exists()` + `get().data.ownerId` check fails).
6. **Transaction Retroactive Amount Tampering**: Updating `dppAmount` or `totalAmount` on `/transactions/tx1` -> `PERMISSION_DENIED` (`affectedKeys().hasOnly(['status', 'updatedAt'])` blocks financial field changes).
7. **Voided Transaction Resurrection (Terminal State Bypass)**: Updating `/transactions/tx1` from `status: 'voided'` back to `status: 'completed'` -> `PERMISSION_DENIED` (`existing().status == 'completed'` gate blocks updates on terminal `'voided'` state).
8. **Sold Inventory Re-Sale Mutation**: Updating `weightGrams` on an `/inventory/item1` whose `status` is `'sold'` -> `PERMISSION_DENIED` (`existing().status != 'sold'` gate fails).
9. **Non-Atomic Stock Transfer**: Creating `/stockTransfers/tr1` moving `item1` to `branch2` without updating `/inventory/item1.branchId` in the same batch -> `PERMISSION_DENIED` (`getAfter(...).data.branchId == incoming().toBranchId` fails).
10. **ID Poisoning / Denial of Wallet**: Creating `/branches/` with a 500-character ID or special characters `branch$1` -> `PERMISSION_DENIED` (`isValidId()` regex & 128-char cap fails).
11. **Value Poisoning on Whitelisted Update Key**: Updating `sellMarginPercent` on `/storeSettings/{uid}` with `"999999"` (string) or `-25` (negative number) -> `PERMISSION_DENIED` (`isValidStoreSetting(incoming())` wraps the entire `update` rule and rejects invalid type/bounds).
12. **Forged Client Timestamp**: Creating `/transactions/tx1` with backdated `createdAt: Timestamp(2020-01-01)` -> `PERMISSION_DENIED` (`incoming().createdAt == request.time` fails).

## 3. Red Team Audit Conflict Report

- `storeSettings`: Identity Spoofing (Blocked via `ownerId == uid` & `docId == uid`), Shadow Update (Blocked via `hasOnly` + `affectedKeys`), Value Poisoning (Blocked via `isValidStoreSetting`). **PASS**.
- `branches`: Identity Spoofing (Blocked), Resource Poisoning (Blocked via `isValidId` + string caps), Immutable `code`/`ownerId`/`createdAt` enforced. **PASS**.
- `inventory`: Orphaned Branch (Blocked via `exists` + `get`), Terminal `sold` state locked, Cross-tenant branch transfer blocked via `get(...toBranchId).data.ownerId == request.auth.uid`. **PASS**.
- `customers`: PII Blanket Read (Blocked via strict `ownerId == request.auth.uid` on both `get` and `list`), Regex phone guard enforced. **PASS**.
- `priceAlerts`: Orphaned Customer (Blocked via `exists` + `get`), Terminal `cancelled` state locked. **PASS**.
- `transactions`: Amount tampering blocked, Deletion blocked, Terminal `voided` state locked, Timestamp forgery blocked. **PASS**.
- `stockTransfers`: Non-atomic transfer blocked via `getAfter`, Self-transfer (`fromBranchId == toBranchId`) blocked, Updates/Deletes blocked. **PASS**.

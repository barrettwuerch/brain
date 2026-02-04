# Wedge Customer Service Knowledge Base (seed)

Source: Bear message 2026-02-04. This is a seed KB used for local search until Freshdesk Solutions sync / vector DB is implemented.

## Product
Wedge is a payment app that allows dispensary customers to pay via linked bank account (Plaid).

## Team communication
Recommendation: shared Slack channel (e.g., #wedge-verano-cs) for escalations/collaboration.

## Support tiers
- Tier 1: Verano CS — first-line support; basic troubleshooting; resolves most issues using this KB.
- Tier 2: Wedge CS — escalation support; handles failed/returned transactions and reversals for confirmed double charges.

## Escalation ownership
- Failed/Returned Transactions → Escalate to Wedge CS
- IDV Failures → Verano CS
- Bank Linking Failures → Verano CS
- Double Transactions investigation → Verano CS
- Double Transactions (confirmed reversal) → Escalate to Wedge CS
- Account Deletion Requests → Verano CS
- Update Payment Information → Verano CS

## SLAs
- Initial response: 1 hour (all issue types)
- Resolution times:
  - IDV failures: immediate (upon first response)
  - Bank linking failures: immediate (upon first response)
  - Account deletion requests: immediate (upon first response)
  - Update payment information: immediate (upon first response)
  - Failed/returned transactions: variable (resolved when transaction clears)
  - Double transactions (confirmed): variable (resolved when payment reversed)

---

## 1) Returned / Failed Transactions (ESCALATE TO WEDGE CS)
**Description:** Transaction fails to process, typically due to insufficient funds. User may be locked out until resolved.

**How to identify:**
- "Account Issue" tag in Admin Portal
- User reports being locked out

**System behavior:**
- Automatically retries failed transactions daily if funds become available.

**Admin Portal steps:**
1. Check transaction status
   - Account Issues view → search user
   - Review Issue Type (ACH_RETURN), Status (UNRESOLVED or PENDING_RESOLUTION), Funding Transfer Resolutions columns
2. Check bank balance
   - External Bank Account view → search by email
   - Action → Fetch Real-time balance from Plaid
   - Check Available Balance (shown in cents)
3. Rerun transaction (if funds available)
   - Back to Account Issues view
   - Action → Rerun Funding Transfer → Go
   - Status updates to PENDING_RESOLUTION

---

## 2) Identity Verification (IDV) Failures (VERANO CS)
**Type A: User error** (blurry photo, incorrect doc, typo)
- Plaid Identity Verification view → search user
- Confirm Status=failed
- Action → Reset Identity Verification → Go
- Instruct user to retry in app with correct info

**Type B: Suspicious account** (flagged)
- Do not reset.
- Required response: inform user there’s nothing we can do. Do not disclose details.

---

## 3) Bank Account Linking Failures (VERANO CS)
Common cause: bank account name does not exactly match name used during IDV.

Resolution:
- Explain name must exactly match.
- Advise using an account where they are primary holder and name matches.

---

## 4) Double Transactions
**Verano CS investigates; only escalate to Wedge CS if confirmed**.

Steps:
1. Verify in Straddle Portal: check history, confirm true duplicate.
   - Common false alarm: failed + successful retry appears as two entries; not a true double charge.
2. Corroborate with store: confirm whether one or multiple orders fulfilled.
3. If confirmed by portal + store: escalate to Wedge CS for reversal.
   Include: customer email/account info, transaction IDs, store confirmation, preferred resolution (store credit or refund).

---

## 5) Account Deletion Requests (VERANO CS)
User can delete account in-app:
- Wedge app → Settings → Delete Account → Confirm.

---

## 6) Update Payment Information (VERANO CS)
User can update in-app:
- Add new bank account via Plaid
- After new account linked, delete old bank account
- Confirm new account is primary
Important: add new first before deleting old; name must match verified identity.

---

## Removed: ZenPay FAQ
This bot is scoped to **Wedge customers only** (not ZenPay). ZenPay-specific guidance should live in a separate KB + prompt if needed.

# Payment incident audit — 2026-10-16

Scope: orders and POS sales with paid_at from 2026-09-22T20:01:01Z (first AustPay attempt) through audit execution. Older sales are outside this audit. This is provider payment-status reconciliation, not settlement or bank-deposit certification.

## Immediate corrections

- Four known AustPay sandbox successes changed to invalidated with original status and reason retained.
- Zorma and Soila restored to awaiting_payment. Their POS sales cancelled through existing stage-reversal handling; paid timestamps and gateway labels cleared. Expedition UI checked under authenticated Pérola session; Zorma absent.
- Márcia's separate AppMax order remains paid. Production AppMax API returned integrado for its order.
- Production Rinne API returned HTTP 200 with total=0 transactions.
- Zorma's October 16 15:57 UTC processing attempt reached the duplicate guard; this does not establish a new link was issued or a new card charge occurred.
- Earlier attribution to gateway-payment-lookup was incorrect: it is read-only. Actual restoration happened in pagarme-create-charge's cached-success branch.

## Verified protections

- Successful cached attempt now blocks duplicate charge with pending response and does not restore order/sale paid state.
- AustPay webhook requires a successful production re-query, APPROVED (not AUTHORIZED), exact transaction/reference/amount and an atomic unpaid/noncancelled update. Invalidated transactions cannot approve.
- Replaying Zorma's old sandbox transaction through deployed webhook returned 503 transaction_unverified; no order became paid.
- 13 selective tests passed; preview build OK.

## Reconciliation results

- 612 paid-marked CRM orders inspected, fifty per page.
- 595 had live approved Mercado Pago or paid/integrated AppMax/Pagar.me evidence. Five additional orders verified through exact payment_split transaction references and charge amounts: @solgu (two orders), @domingosjanilce, @brancabbarbosa, @1979ana_. Total with provider approval located: 600.
- Remaining 12: eight refunded payments; one charged_back; @netasateles has one real approved split of R$341.99 and a pending R$359.99 part, though order was manually marked paid; two manual orders require receipts (@jozildagomesdaconceicao and @tejnvieira).
- 697 paid/completed POS sales inspected: 601 linked to CRM orders, 56 direct provider confirmations, one additional split sale (Soraya Valentim) verified through both production Pix transactions. Remaining direct entries: 33 zero/general exchange records, three exchange differences requiring original payment reconciliation, two Shopify-imported sales (Cíntia Lima Viana and Claudia Mariante), one refunded completed sale (Adriane Egg).
- Refunded/charged-back records were NOT treated as never-paid customers and were NOT mass reverted. Several already have cancelled POS sales or concluded shipment history.
- All 19 initial apparent rejected-payment mismatches were resolved by checking alternative Pagar.me/AppMax approvals; they were not falsely reversed.

## Limitations / next evidence

- Do not certify every buyer paid in full: manual receipts, imported Shopify payments, exchange differences, and Neta's balance remain unresolved.
- Provider approval does not establish settlement/deposit into the bank.
- Do not send customer collection messages based solely on this report; inspect receipts and actual refunds first.
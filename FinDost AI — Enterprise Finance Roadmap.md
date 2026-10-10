# FinDost AI — Enterprise Finance Roadmap

Oct 10, 2026 · @Night Byte

To move FinDost from a cash-flow tool to enterprise finance, add an **accounting core** first, then build **tax, purchasing and tenders, payroll and controls** on top of it. The order matters, because each step needs the one before it.

## 1. Foundation: double-entry general ledger

Build this first: tax, payroll and tenders all end up as accounting entries.

- **Chart of accounts:** assets, liabilities, equity, income and expenses, with a ready-made template for Pakistani businesses.
- **Journal entries:** every sale, bill, payment and import posts balanced debits and credits. Existing transaction types map cleanly; a credit sale is "Dr Receivables / Cr Sales".
- **Accrual accounting:** stock goes to inventory, not straight to expenses. This fixes the −94% margin seen in testing.
- **Financial statements:** trial balance, profit and loss, balance sheet and cash-flow statement.
- **Period close:** a month-end lock, so a closed month can't be edited.

## 2. Tax compliance (Pakistan)

FinDost has no tax features today; this closes the biggest compliance gap.

- Store the company's **NTN and STRN**, and each customer's and supplier's.
- **Sales tax on each invoice line:** output tax on sales, input tax on purchases, and the net payable each month. Provincial sales tax on services (PRA, SRB, KPRA, BRA) needs its own handling.
- **Withholding tax** deducted when paying suppliers and salaries, recorded by tax-law section, with certificates.
- **Tax rates in an editable table by tax year,** not written into the code, because rates change in every budget.
- **Return working papers:** export files ready to upload to FBR's IRIS portal. A person files them; no auto-filing.
- **Tax calendar** fed into the existing alerts, for example "Sales tax return due in 5 days, Rs. X payable".
- Later, for large retailers: integration with FBR's point-of-sale system.

## 3. Purchasing and tenders

Each stage feeds the next, and every award keeps a record of why it was made.

1. **Purchase request.**
2. **Approval,** routed by amount.
3. **Request for quotation, or a full tender:** publish, receive bids, a sealed bid-opening date, and scored evaluation.
4. **Purchase order.**
5. **Goods received note.**
6. **Supplier invoice.**
7. **Three-way match** of order, goods received and invoice.
8. **Payment run.**

Each award records the bids received and the reasons for the choice. For government-linked organisations, follow PPRA procurement rules.

## 4. Payroll

A monthly run that calculates, checks and posts salaries.

- Employee records, salary structure, allowances, deductions and loans/advances.
- Monthly payroll run: income tax on salary from the yearly tax slabs, EOBI and provincial social security, then payslips.
- A bank transfer file for salaries, with automatic journal posting.
- Salary checks: compare this month against last month, catch staff on the payroll with no attendance record, and catch duplicate bank accounts.

## 5. Full receivables and payables

- Issue invoices as PDFs or by email, with credit notes and statements.
- Ageing reports for money owed, plus collection steps that build on the existing WhatsApp reminders.
- Supplier payment scheduling that feeds the existing forecast.

## 6. Banking

Bank statement import (CSV and PDF) with **automatic matching to ledger entries**. This is real reconciliation, not just the consistency checks FinDost runs today.

## 7. Enterprise controls

- An **approval matrix by amount and type,** for example over Rs. 1M needs both the finance manager and the CEO.
- **Maker-checker:** the person who creates a record can't approve it.
- New roles: accountant, payroll officer, procurement officer, auditor (read-only).
- Fixed assets with depreciation; cost centres and departments; multi-company and multi-currency later.

## Suggested order

| Phase | Build | Why |
| --- | --- | --- |
| 1 | General ledger + statements | Everything else posts into it |
| 2 | Sales tax and withholding on existing invoices/bills | Biggest compliance gap |
| 3 | Bank reconciliation | Removes manual entry |
| 4 | Payroll | Recurring, high value |
| 5 | Purchasing and tenders | Most workflow-heavy |
| 6 | Approval matrix, roles, fixed assets, multi-company | Enterprise-grade |

## Next step

Build phase 1's journal posting first. It keeps the existing engine intact and gives every later module somewhere to post.

- [ ] Add `accounts` and `journal_lines` tables.
- [ ] Make every existing transaction type post balanced entries.
- [ ] Test that the trial balance always nets to zero.
- [ ] Test that the new ledger's cash total equals the Rs. 358,800 the dashboard already shows for the test data.

For AICON'26, don't promise all of this. Present phases 1–2 as "in progress" only if they are built; keep the rest as roadmap.

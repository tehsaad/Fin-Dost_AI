"""Reproducible, clearly labelled DEMO data for the four account types.

All names and amounts are fictional. Data is generated from a fixed random
seed relative to "today", and every row is flagged ``is_demo``. While a demo
business is in use its dates are rebased daily (``rebase_demo_dates``) so the
story - including the projected cash crunch - stays the same whenever a judge
signs in.
"""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import today as get_today
from ..models import (
    Business,
    Customer,
    FinancialScenario,
    ForecastRun,
    ImportBatch,
    InventoryMovement,
    Payable,
    Product,
    Receivable,
    RiskAlert,
    Supplier,
    Transaction,
)
from ..money import rupees

DEMO_PROFILES = {
    "sme": {"name": "Bilal General Store", "city": "Lahore", "reserve": 50_000},
    "enterprise": {"name": "Indus Textiles Ltd.", "city": "Faisalabad", "reserve": 5_000_000},
    "household": {"name": "Khan Family Household", "city": "Lahore", "reserve": 25_000},
    "student": {"name": "Ayesha's Student Budget", "city": "Islamabad", "reserve": 3_000},
}
HISTORY_DAYS = 84


@dataclass
class Builder:
    db: Session
    business: Business
    today: date
    rng: random.Random
    customers: dict[str, Customer] = field(default_factory=dict)
    suppliers: dict[str, Supplier] = field(default_factory=dict)
    counter: int = 0

    def d(self, offset: int) -> date:
        return self.today + timedelta(days=offset)

    def customer(self, name: str) -> Customer:
        if name not in self.customers:
            c = Customer(business_id=self.business.id, name=name, is_demo=True)
            self.db.add(c)
            self.customers[name] = c
        return self.customers[name]

    def supplier(self, name: str, category: str | None = None) -> Supplier:
        if name not in self.suppliers:
            s = Supplier(business_id=self.business.id, name=name, category=category, is_demo=True)
            self.db.add(s)
            self.suppliers[name] = s
        return self.suppliers[name]

    def tx(self, offset: int, kind: str, amount_rs: float, category: str, description: str, account: str | None = "cash",
           **links) -> Transaction:
        t = Transaction(
            business_id=self.business.id, occurred_on=self.d(offset), kind=kind, amount_paisa=rupees(round(amount_rs)),
            account=account if kind not in ("credit_sale", "credit_purchase") else None, category=category,
            description=description, source="demo", is_demo=True, **links,
        )
        self.db.add(t)
        return t

    def ref(self, prefix: str) -> str:
        self.counter += 1
        return f"{prefix}-{self.counter:04d}"

    def receivable(self, customer: str, issued: int, due: int, amount_rs: float, description: str,
                   payments: list[tuple[int, float]] = (), account: str = "cash", opening: bool = False) -> Receivable:
        c = self.customer(customer)
        self.db.flush()
        ref = self.ref("INV")
        r = Receivable(business_id=self.business.id, customer_id=c.id, reference=ref, description=description,
                       issued_on=self.d(issued), due_on=self.d(due), amount_paisa=rupees(round(amount_rs)), is_demo=True)
        self.db.add(r)
        self.db.flush()
        if not opening:
            self.tx(issued, "credit_sale", amount_rs, "Sales", f"Credit sale - {customer} ({ref})", customer_id=c.id,
                    receivable_id=r.id)
        for off, amt in payments:
            self.tx(off, "customer_payment", amt, "Customer payment", f"Payment from {customer} ({ref})",
                    account=account, customer_id=c.id, receivable_id=r.id)
        return r

    def payable(self, supplier: str | None, issued: int, due: int, amount_rs: float, category: str, description: str,
                payments: list[tuple[int, float]] = (), account: str = "bank", credit_purchase: bool = True,
                essential: bool = True) -> Payable:
        s = self.supplier(supplier, category) if supplier else None
        self.db.flush()
        ref = self.ref("BILL")
        p = Payable(business_id=self.business.id, supplier_id=s.id if s else None, reference=ref, description=description,
                    category=category, issued_on=self.d(issued), due_on=self.d(due), amount_paisa=rupees(round(amount_rs)),
                    is_essential=essential, is_demo=True)
        self.db.add(p)
        self.db.flush()
        if credit_purchase:
            self.tx(issued, "credit_purchase", amount_rs, category, f"{description} ({ref})", supplier_id=s.id if s else None,
                    payable_id=p.id)
        for off, amt in payments:
            self.tx(off, "supplier_payment", amt, category, f"Payment to {supplier or description} ({ref})",
                    account=account, supplier_id=s.id if s else None, payable_id=p.id)
        return p

    def noisy(self, value: float, spread: float = 0.12) -> float:
        return value * self.rng.uniform(1 - spread, 1 + spread)

    def product(self, sku: str, name: str, unit: str, cost: float, price: float, reorder: int, lead: int = 2) -> Product:
        p = Product(business_id=self.business.id, sku=sku, name=name, unit=unit, unit_cost_paisa=rupees(cost),
                    sale_price_paisa=rupees(price), reorder_level=reorder, lead_time_days=lead, is_demo=True)
        self.db.add(p)
        self.db.flush()
        return p

    def move(self, product: Product, offset: int, mtype: str, qty: int, unit_value_paisa: int, note: str = "") -> None:
        if qty == 0:
            return
        self.db.add(InventoryMovement(business_id=self.business.id, product_id=product.id, occurred_on=self.d(offset),
                                      movement_type=mtype, quantity=qty, unit_value_paisa=unit_value_paisa,
                                      note=note or None, is_demo=True))


def _finalize_accounts(b: Builder, opening_rs: dict[str, float], target_total_rs: float,
                       rules: list[tuple[str, str, str, tuple[int, ...], float]]) -> None:
    """Add realistic transfers between accounts, then set opening balances.

    rules: (mode, from_acct, to_acct, weekdays, level_rs)
      sweep - move everything above `level` from `from_acct` to `to_acct`
      topup - move money so `to_acct` is back up to `level`
    Cash and wallet openings are as given; the bank opening is solved so the
    total balance today equals `target_total_rs`.
    """
    from collections import defaultdict as _dd

    from .ledger import account_deltas
    from .snapshot import Tx

    b.db.flush()
    per_day: dict[date, dict[str, int]] = _dd(lambda: _dd(int))
    for t in b.db.scalars(select(Transaction).where(Transaction.business_id == b.business.id)):
        for acct, delta in account_deltas(Tx(id=t.id, occurred_on=t.occurred_on, kind=t.kind, amount=int(t.amount_paisa),
                                             account=t.account, to_account=t.to_account)).items():
            per_day[t.occurred_on][acct] += delta
    bal = {k: rupees(v) for k, v in opening_rs.items()}
    start = b.business.opening_date
    day = start
    while day < b.today:
        for acct, delta in per_day.get(day, {}).items():
            bal[acct] += delta
        for mode, src, dst, weekdays, level_rs in rules:
            if day.weekday() not in weekdays:
                continue
            level = rupees(level_rs)
            amount = bal[src] - level if mode == "sweep" else level - bal[dst]
            amount = (amount // 100_000) * 100_000  # whole thousands of rupees
            if amount > 0:
                desc = {"cash": "Cash", "bank": "Bank", "wallet": "Wallet"}
                b.tx((day - b.today).days, "transfer", amount / 100, "Transfer",
                     f"{desc[src]} to {desc[dst].lower()} transfer", account=src, to_account=dst)
                bal[src] -= amount
                bal[dst] += amount
        day += timedelta(days=1)
    bank_today = rupees(target_total_rs) - bal["cash"] - bal["wallet"]
    b.business.opening_cash_paisa = rupees(opening_rs["cash"])
    b.business.opening_wallet_paisa = rupees(opening_rs["wallet"])
    b.business.opening_bank_paisa = rupees(opening_rs["bank"]) + (bank_today - bal["bank"])


# ----------------------------------------------------------------------------- personas

def _seed_sme(b: Builder) -> None:
    rng = b.rng
    weekday_sales = [34_000, 32_000, 33_000, 35_000, 38_000, 44_000, 47_000]
    akbari = b.supplier("Akbari Mandi Wholesale", "Inventory")
    b.db.flush()
    for off in range(-HISTORY_DAYS, 0):
        day = b.d(off)
        slowdown = 0.85 if off >= -14 else 1.0  # sales slowed after the wedding rush
        total = b.noisy(weekday_sales[day.weekday()] * slowdown)
        b.tx(off, "income", total * 0.72, "Sales", "Counter cash sales", account="cash")
        b.tx(off, "income", total * 0.28, "Sales", "Easypaisa/JazzCash QR sales", account="wallet")
        b.tx(off, "expense", rng.uniform(400, 700), "Dining & Leisure", "Staff tea and meals", account="cash")
        if day.weekday() in (0, 3):
            b.tx(off, "expense", b.noisy(45_000), "Inventory Purchase", "Akbari Mandi wholesale (cash)",
                 supplier_id=akbari.id)
            b.tx(off, "expense", b.noisy(1_500, 0.1), "Transport & Fuel", "Loader rickshaw (mandi)")
        if day.weekday() == 5:
            b.tx(off, "expense", 2_500, "Packaging", "Packaging - shopper bags")

    # Monthly obligations (history) - detected as recurring by the forecast engine.
    for off in (-83, -53, -23):
        b.tx(off, "expense", 65_000, "Rent", "Shop rent - Main Market", account="bank")
    for off in (-80, -50, -20):
        b.tx(off, "expense", 52_000, "Salaries & Wages", "Staff salaries (2 helpers)", account="cash")
    for off, amt in ((-72, 24_200), (-42, 26_900), (-12, 28_700)):
        b.tx(off, "expense", amt, "Utilities", "LESCO electricity bill", account="bank")
    for off in (-70, -40, -10):
        b.tx(off, "expense", 3_499, "Mobile & Internet", "PTCL internet", account="bank")
    for off in (-65, -35, -5):
        b.tx(off, "expense", 20_000, "Committee (ROSCA)", "Bazaar committee installment", account="cash")
    b.tx(-33, "expense", 12_000, "Repairs & Maintenance", "Freezer compressor repair")
    for off in (-76, -46, -16):
        b.tx(off, "owner_withdrawal", 110_000, "Owner drawings", "Owner household drawings", account="bank")
    b.tx(-58, "expense", 185_000, "Equipment", "Display chiller for dairy section", account="bank")
    b.tx(-44, "loan_repayment", 230_000, "Loan repayment", "Repaid family loan (taken for Eid stock)", account="bank")
    # One unusual amount and one likely duplicate, for the anomaly detector.
    b.tx(-3, "expense", 14_500, "Transport & Fuel", "Loader rickshaw (mandi) + generator diesel")
    b.tx(-2, "expense", 2_500, "Packaging", "Packaging - shopper bags")

    # Supplier credit (distributors), mostly paid on 14-day terms.
    distributors = [
        ("Lahore Unilever Distributor", 1, 46_000, 14),
        ("Nestle & Engro Dairy Distributor", 4, 31_000, 10),
        ("Shan & National Foods Agency", 2, 21_000, 14),
    ]
    for name, weekday, avg, terms in distributors:
        for off in range(-HISTORY_DAYS, 0):
            if b.d(off).weekday() != weekday:
                continue
            if name.startswith("Shan") and (off // 7) % 2:
                continue
            amount = round(b.noisy(avg, 0.1))
            due = off + terms
            pay_off = due + rng.choice([0, 0, 1, 2])
            payments = [(pay_off, amount)] if pay_off < 0 else []
            b.payable(name, off, due, amount, "Inventory Purchase", f"Stock on credit - {name}", payments)
    b.payable("Lahore Unilever Distributor", -4, 9, 165_000, "Inventory Purchase",
              "Season bulk order - ghee, cooking oil, basmati")
    b.payable("Property owner (shop)", -1, 7, 65_000, "Rent", "Shop rent - this month", credit_purchase=False)

    # Customer udhaar (credit sales) with a realistic payment history.
    b.receivable("Haji Usman Tea Stall", -125, -95, 35_000, "Opening udhaar balance (old khata page)", opening=True)
    b.receivable("Al-Madina Caterers", -80, -65, 60_000, "Wedding catering order", [(-41, 60_000)])
    b.receivable("Al-Madina Caterers", -62, -47, 85_000, "Wedding ghee and rice order")
    b.receivable("Butt Sweets", -40, -25, 65_000, "Milk and sugar supply", [(-10, 20_000)])
    b.receivable("Chaudhry Farm Supplies", -30, -8, 50_000, "Monthly ration for farm workers")
    b.receivable("Dr. Farooq Clinic (staff ration)", -78, -48, 37_000, "Staff ration account", [(-46, 37_000)])
    b.receivable("Dr. Farooq Clinic (staff ration)", -48, -18, 38_000, "Staff ration account", [(-16, 38_000)])
    b.receivable("Dr. Farooq Clinic (staff ration)", -18, 12, 42_000, "Staff ration account")
    b.receivable("Model School Canteen", -45, -15, 30_000, "Biscuits and juices", [(-12, 30_000)])
    b.receivable("Model School Canteen", -10, 20, 38_000, "Biscuits and juices")
    b.receivable("Rehman Hostel Mess", -55, -40, 28_000, "Hostel mess supplies", [(-30, 28_000)])
    b.receivable("Rehman Hostel Mess", -20, -5, 26_000, "Hostel mess supplies", [(-3, 26_000)])
    b.receivable("Rehman Hostel Mess", -6, 9, 27_000, "Hostel mess supplies")

    _finalize_accounts(b, {"cash": 55_000, "bank": 240_000, "wallet": 12_000}, 118_000,
                       [("sweep", "cash", "bank", (2, 6), 45_000), ("sweep", "wallet", "bank", (6,), 10_000)])

    # Products (a partial catalogue) with weekly stock movements.
    catalogue = [
        ("OIL-5L", "Dalda Cooking Oil 5L", "tin", 2_650, 2_850, 6, 20),
        ("TEA-950", "Tapal Danedar Tea 950g", "pack", 1_480, 1_620, 4, 15),
        ("MILK-1L", "Olpers Milk 1L", "pack", 270, 300, 25, 80),
        ("SUGAR-1", "Sugar 1kg", "kg", 140, 155, 30, 100),
        ("ATTA-10", "Chakki Atta 10kg", "bag", 1_150, 1_250, 8, 25),
        ("RICE-5P", "Premium Basmati Rice 5kg", "bag", 1_900, 2_150, 0.3, 10),
        ("SHAN-BM", "Shan Biryani Masala", "pack", 115, 135, 10, 30),
        ("KETCH-8", "National Ketchup 800g", "bottle", 330, 380, 3, 10),
        ("SURF-1", "Surf Excel 1kg", "pack", 520, 590, 5, 15),
        ("LUX-SP", "Lux Soap", "bar", 135, 160, 12, 40),
        ("WATER-15", "Nestle Pure Life 1.5L", "bottle", 85, 110, 20, 60),
        ("LIPTON-190", "Lipton Yellow Label 190g", "pack", 610, 680, 2, 8),
        ("OLIVE-1L", "Imported Olive Oil 1L", "bottle", 2_900, 3_300, 0.1, 5),
        ("BISC-FP", "Sooper Biscuits Family Pack", "pack", 70, 85, 18, 50),
        ("COLG-150", "Colgate Toothpaste 150g", "tube", 230, 265, 3, 15),
    ]
    for sku, name, unit, cost, price, demand, reorder in catalogue:
        p = b.product(sku, name, unit, cost, price, reorder)
        slow = demand < 1
        stock = 120 if sku == "RICE-5P" else 40 if sku == "OLIVE-1L" else int(demand * 21)
        b.move(p, -HISTORY_DAYS, "opening", stock, p.unit_cost_paisa, "Opening stock count")
        for week in range(12):
            off = -HISTORY_DAYS + 7 * (week + 1)
            sold = int(round(demand * 7 * rng.uniform(0.8, 1.2))) if not slow else (1 if rng.random() < demand * 7 else 0)
            sold = min(sold, stock)
            b.move(p, off - 1, "sale", -sold, p.sale_price_paisa, "Weekly sales total")
            stock -= sold
            restock = not slow and not (sku == "COLG-150" and week >= 9)
            if restock:
                target = int(demand * 21)
                buy = max(target - stock, 0)
                b.move(p, off, "purchase", buy, p.unit_cost_paisa, "Restock")
                stock += buy


def _seed_enterprise(b: Builder) -> None:
    rng = b.rng
    for off in range(-HISTORY_DAYS, 0):
        day = b.d(off)
        if day.weekday() < 6:
            b.tx(off, "income", b.noisy(1_900_000), "Sales", "Local yarn sales (cash/cheque)", account="bank")
            b.tx(off, "expense", b.noisy(240_000), "Transport & Fuel", "Freight and diesel", account="bank")
            b.tx(off, "expense", b.noisy(380_000), "Raw Material", "Polyester and dyes (spot purchase)", account="bank")
        b.tx(off, "expense", b.noisy(45_000), "Dining & Leisure", "Staff canteen and guest hospitality", account="cash")
    for off in (-77, -47, -17):
        b.tx(off, "expense", 8_900_000, "Salaries & Wages", "Factory payroll (420 staff)", account="bank")
    for off, amt in ((-70, 6_100_000), (-40, 6_300_000), (-10, 6_450_000)):
        b.tx(off, "expense", amt, "Utilities", "FESCO and SSGC industrial energy", account="bank")
    for off in (-84, -54, -24):
        b.tx(off, "expense", 1_200_000, "Rent", "Warehouse lease - Faisalabad", account="bank")

    for off in range(-HISTORY_DAYS, 0):
        if b.d(off).weekday() == 2:
            amount = round(b.noisy(4_200_000, 0.08))
            due = off + 21
            payments = [(due + rng.choice([0, 1, 3]), amount)] if due + 3 < 0 else []
            b.payable("Punjab Cotton Ginners", off, due, amount, "Raw Material", "Raw cotton bales on credit", payments)
    b.payable("Punjab Cotton Ginners", -6, 8, 14_500_000, "Raw Material", "Seasonal cotton stocking contract")
    b.payable(None, -2, 11, 3_800_000, "Taxes & Fees", "Quarterly advance tax instalment", credit_purchase=False)

    b.receivable("Gulberg Garments Export Unit", -95, -65, 6_800_000, "Yarn batch - export garments")
    b.receivable("Mehran Apparel Karachi", -60, -30, 5_400_000, "Spinning unit delivery", [(-12, 1_500_000)], account="bank")
    b.receivable("Ravi Home Textiles", -70, -40, 6_000_000, "Grey fabric", [(-38, 6_000_000)], account="bank")
    b.receivable("Ravi Home Textiles", -25, 5, 6_200_000, "Grey fabric")
    b.receivable("UK Buyer LC (Northline Ltd.)", -50, 15, 18_500_000, "Export LC - knitted yarn")
    b.receivable("Sialkot Sportswear", -40, -10, 3_100_000, "Dyed yarn", [(-6, 3_100_000)], account="bank")
    b.receivable("Sialkot Sportswear", -9, 21, 3_300_000, "Dyed yarn")

    _finalize_accounts(b, {"cash": 1_200_000, "bank": 30_000_000, "wallet": 0}, 17_000_000,
                       [("topup", "bank", "cash", (0,), 1_200_000)])

    for sku, name, unit, cost, price, demand, reorder in [
        ("YRN-30S", "Cotton Yarn 30s (bag)", "bag", 38_000, 43_500, 22, 300),
        ("YRN-20S", "Cotton Yarn 20s (bag)", "bag", 33_000, 37_000, 15, 200),
        ("PC-6535", "PC Blend 65/35 (bag)", "bag", 36_500, 41_000, 9, 120),
        ("GREY-FAB", "Grey Fabric (roll)", "roll", 52_000, 60_000, 6, 60),
        ("DYED-SLB", "Dyed Slub Yarn (bag)", "bag", 47_000, 54_000, 0.4, 20),
    ]:
        p = b.product(sku, name, unit, cost, price, reorder, lead=10)
        stock = 600 if sku == "DYED-SLB" else int(demand * 30)
        b.move(p, -HISTORY_DAYS, "opening", stock, p.unit_cost_paisa, "Opening stock count")
        for week in range(12):
            off = -HISTORY_DAYS + 7 * (week + 1)
            sold = min(int(round(demand * 7 * rng.uniform(0.8, 1.2))), stock)
            b.move(p, off - 1, "sale", -sold, p.sale_price_paisa, "Weekly dispatches")
            stock -= sold
            if demand >= 1:
                buy = max(int(demand * 30) - stock, 0)
                b.move(p, off, "purchase", buy, p.unit_cost_paisa, "Production output")
                stock += buy


def _seed_household(b: Builder) -> None:
    rng = b.rng
    for off in (-69, -39, -9):
        b.tx(off, "income", 350_000, "Salary", "Monthly salary - Habib Bank credit", account="bank")
    for off in range(-HISTORY_DAYS, 0):
        day = b.d(off)
        if day.weekday() == 6:
            b.tx(off, "expense", b.noisy(15_500), "Groceries", "Weekly groceries - Imtiaz", account="bank")
            b.tx(off, "expense", b.noisy(6_000, 0.4), "Dining & Leisure", "Family dinner out", account="wallet")
        if day.weekday() == 2:
            b.tx(off, "expense", b.noisy(7_000), "Transport & Fuel", "Petrol - PSO", account="cash")
            b.tx(off, "expense", b.noisy(3_500, 0.3), "Groceries", "Sabzi and fruit (market)", account="cash")
        if rng.random() < 0.12:
            b.tx(off, "expense", b.noisy(4_500, 0.5), "Shopping", "Clothes and household items (Daraz)", account="bank")
    for off in (-67, -37, -7):
        b.tx(off, "expense", 85_000, "Rent", "House rent", account="bank")
        b.tx(off, "expense", 25_000, "Committee (ROSCA)", "Family committee installment", account="bank")
    for off, amt in ((-60, 31_000), (-30, 38_500), (-1, 41_200)):
        b.tx(off, "expense", amt, "Utilities", "LESCO electricity bill", account="bank")
    for off in (-58, -28):
        b.tx(off, "expense", 6_200, "Utilities", "SNGPL gas bill", account="bank")
        b.tx(off, "expense", 4_299, "Mobile & Internet", "PTCL Flash Fiber", account="bank")
    for off in (-63, -33):
        b.tx(off, "expense", 74_000, "Education", "School fee - 2 children", account="bank")
    b.tx(-15, "expense", 32_000, "Repairs & Maintenance", "Car AC compressor repair", account="bank")
    b.tx(-20, "expense", 9_800, "Medical", "Clinic visit and medicines", account="cash")

    b.payable("The City School", -5, 6, 74_000, "Education", "School fee - 2 children (this month)", credit_purchase=False)
    b.payable("Landlord", -2, 23, 85_000, "Rent", "House rent (next month)", credit_purchase=False)
    b.payable(None, 0, 14, 18_000, "Medical", "Dental treatment - second session", credit_purchase=False, essential=False)

    _finalize_accounts(b, {"cash": 12_000, "bank": 160_000, "wallet": 6_000}, 175_000,
                       [("topup", "bank", "cash", (0,), 15_000), ("topup", "bank", "wallet", (6,), 8_000)])


def _seed_student(b: Builder) -> None:
    rng = b.rng
    for off in (-49, -19):
        b.tx(off, "income", 35_000, "Family Allowance", "Monthly allowance from family", account="bank")
    for off in range(-HISTORY_DAYS + 30, 0):
        day = b.d(off)
        b.tx(off, "expense", b.noisy(420, 0.35), "Groceries", "Cafeteria and snacks", account="cash")
        if day.weekday() == 5:
            b.tx(off, "income", 2_500, "Freelance Income", "Tutoring - O-level maths", account="wallet")
            b.tx(off, "expense", b.noisy(1_200, 0.4), "Dining & Leisure", "Weekend outing with friends", account="wallet")
        if day.weekday() in (0, 3):
            b.tx(off, "expense", b.noisy(350, 0.2), "Transport & Fuel", "Careem / bus fare", account="wallet")
    for off in (-46, -16):
        b.tx(off, "expense", 18_000, "Rent", "Hostel mess fee", account="bank")
        b.tx(off, "expense", 1_200, "Mobile & Internet", "Jazz monthly bundle", account="wallet")
    b.tx(-18, "expense", 4_500, "Education", "Textbooks and printouts (Urdu Bazaar)", account="cash")
    b.tx(-9, "expense", 2_800, "Shopping", "Winter jacket", account="cash")
    b.payable("Hostel administration", -3, 8, 18_000, "Rent", "Hostel mess fee (this month)", credit_purchase=False)
    b.payable("University accounts office", -6, 12, 6_000, "Education", "Mid-term exam and lab fee", credit_purchase=False)
    b.business.opening_date = b.d(-HISTORY_DAYS + 30)
    _finalize_accounts(b, {"cash": 2_000, "bank": 30_000, "wallet": 1_500}, 13_500,
                       [("topup", "bank", "cash", (1,), 2_500)])


SEEDERS = {"sme": _seed_sme, "enterprise": _seed_enterprise, "household": _seed_household, "student": _seed_student}

DEMO_SCENARIOS = {
    "sme": [
        ("Sudden sales decline (20% for 3 weeks)", "Wedding season ends early and footfall drops.",
         [{"type": "sales_decline", "percent": 20, "start_day": 1, "duration_days": 21}]),
        ("Al-Madina Caterers pays 30 days late", "Largest overdue customer delays again.",
         [{"type": "delayed_payment", "top_n": 2, "delay_days": 30}]),
    ],
    "enterprise": [
        ("Export LC delayed 45 days", "Port inspection hold on the UK buyer's LC.",
         [{"type": "delayed_payment", "top_n": 1, "delay_days": 45}]),
        ("Cotton price +18%", "Raw cotton price spike.", [{"type": "supplier_price_increase", "percent": 18}]),
    ],
    "household": [
        ("Salary delayed 10 days", "Employer pays late this month.",
         [{"type": "sales_decline", "percent": 100, "start_day": 15, "duration_days": 10}]),
        ("Summer electricity spike", "LESCO bill up 40%.", [{"type": "utility_increase", "percent": 40}]),
    ],
    "student": [
        ("Laptop repair", "Unexpected Rs. 9,000 repair.",
         [{"type": "unexpected_expense", "amount_paisa": 900_000, "day": 4, "label": "Laptop repair"}]),
        ("Tutoring income stops", "Student pauses tutoring for exams.",
         [{"type": "sales_decline", "percent": 100, "start_day": 1, "duration_days": 21}]),
    ],
}


def clear_business_data(db: Session, business: Business) -> None:
    bid = business.id
    for model in (RiskAlert, ForecastRun, ImportBatch, FinancialScenario, InventoryMovement, Product, Transaction,
                  Receivable, Payable, Customer, Supplier):
        db.execute(delete(model).where(model.business_id == bid))
    db.flush()


def seed_demo(db: Session, business: Business, today: date | None = None) -> None:
    """Replace the business's data with the demo dataset for its account type."""
    today = today or get_today()
    clear_business_data(db, business)
    profile = DEMO_PROFILES[business.kind]
    business.is_demo = True
    business.demo_anchor = today
    business.opening_date = today - timedelta(days=HISTORY_DAYS)
    business.cash_reserve_paisa = rupees(profile["reserve"])
    if not business.city:
        business.city = profile["city"]
    builder = Builder(db=db, business=business, today=today, rng=random.Random(f"findost-{business.kind}-v1"))
    SEEDERS[business.kind](builder)
    for name, desc, adjustments in DEMO_SCENARIOS[business.kind]:
        db.add(FinancialScenario(business_id=business.id, name=name, description=desc, kind="shock",
                                 adjustments=adjustments, is_demo=True))
    db.commit()


def rebase_demo_dates(db: Session, business: Business) -> None:
    """Shift demo rows forward so the demo story is always relative to today."""
    if not business.is_demo or business.demo_anchor is None:
        return
    today = get_today()
    delta = today - business.demo_anchor
    if delta.days == 0:
        return
    bid = business.id
    for t in db.scalars(select(Transaction).where(Transaction.business_id == bid, Transaction.is_demo.is_(True))):
        t.occurred_on = t.occurred_on + delta
    for r in db.scalars(select(Receivable).where(Receivable.business_id == bid, Receivable.is_demo.is_(True))):
        r.issued_on, r.due_on = r.issued_on + delta, r.due_on + delta
        if r.expected_on:
            r.expected_on = r.expected_on + delta
    for p in db.scalars(select(Payable).where(Payable.business_id == bid, Payable.is_demo.is_(True))):
        p.issued_on, p.due_on = p.issued_on + delta, p.due_on + delta
    for m in db.scalars(select(InventoryMovement).where(InventoryMovement.business_id == bid,
                                                        InventoryMovement.is_demo.is_(True))):
        m.occurred_on = m.occurred_on + delta
    business.opening_date = business.opening_date + delta
    business.demo_anchor = today
    db.commit()

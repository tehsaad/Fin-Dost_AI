"""Seed each persona into an in-memory DB and print the forecast story (dev tool)."""
import os, sys, time
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date
from app.db import get_sessionmaker, init_db
from app.models import Business
from app.services.seed import seed_demo
from app.services.snapshot import load_snapshot
from app.services.forecast import run_forecast
from app.services.risk import compute_alerts
from app.services.inventory import inventory_analytics
from app.services.ledger import account_balances
from app.money import fmt_pkr

today = date.fromisoformat(os.getenv("FINDOST_TODAY", "2026-10-10"))
init_db()
db = get_sessionmaker()()
kinds = sys.argv[1:] or ["sme", "enterprise", "household", "student"]
for kind in kinds:
    b = Business(owner_id=f"u-{kind}", name=kind, kind=kind, opening_date=today)
    db.add(b); db.flush()
    t0 = time.time(); seed_demo(db, b, today)
    snap = load_snapshot(db, b)
    f = run_forecast(snap, today, 30)
    inv = inventory_analytics(snap, today)
    al = compute_alerts(snap, today, f, inv)
    s = f["summary"]
    print(f"== {kind}: {len(snap.txs)} tx, balances {[fmt_pkr(v) for v in account_balances(snap, today).values()]}, opening accts {[fmt_pkr(v) for v in snap.opening.values()]}")
    print(f"   d7 {fmt_pkr(s['balance_d7_paisa'])} d14 {fmt_pkr(s['balance_d14_paisa'])} end {fmt_pkr(s['balance_end_paisa'])} min {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']} shortage {s['shortage_date']} risk {s['shortage_risk']}")
    print(f"   model {f['model'].get('name')} imp {f['model'].get('improvement_pct')}% wape {f['model'].get('wape_pct')} conf {f['confidence']['level']} trend {f['trend']['direction']}")
    print("   flows", {k: fmt_pkr(v) for k, v in s['flows_by_source_paisa'].items()})
    print("   alerts", [(a['rule'], a['level'], a['title'][:60]) for a in al])
    print(f"   seed+calc {time.time()-t0:.2f}s")
    for p in f["points"][:31:3]:
        print("    ", p["date"], fmt_pkr(p["balance_paisa"]), fmt_pkr(p["low_paisa"]), fmt_pkr(p["high_paisa"]))

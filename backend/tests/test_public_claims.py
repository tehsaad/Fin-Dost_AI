"""The public landing page quotes figures from the fictional demo shop and the stored benchmark.
These tests fail if the engine or demo data change so that those figures are no longer true."""
from app.money import rupees
from conftest import onboard


def test_landing_hero_figures_match_the_demo_shop(client):
    h = onboard(client, "claims-sme", "sme", demo=True)
    k = client.get("/api/v1/dashboard", headers=h).json()["kpis"]
    assert k["cash_balance"]["value_paisa"] == rupees(118_000)               # "Rs. 118,000 today"
    assert k["shortage_risk"]["level"] == "high"                             # "High risk"
    assert round(k["shortage_risk"]["min_balance_paisa"] / 100) == -128_782  # "Lowest point -Rs. 128,782"
    assert k["receivables"]["overdue_paisa"] == rupees(215_000)              # "Rs. 215,000 udhaar overdue"
    alerts = client.get("/api/v1/alerts", headers=h).json()
    alerts = alerts if isinstance(alerts, list) else alerts.get("alerts", alerts.get("items", []))
    titles = " | ".join(a["title"] for a in alerts)
    assert "(in 9 days)" in titles                                           # "Shortage in 9 days"
    assert "4 customer invoice(s)" in titles                                 # "4 customers"
    rec = client.post("/api/v1/recovery/recommendations", headers=h, json={}).json()
    titles_by_id = {s["id"]: s["title"] for s in rec["strategies"]}
    plan = rec["combined_plan"]
    assert plan["result"]["shortage_date"] is None                           # "Recovery option removes the shortage"
    assert [titles_by_id[i] for i in plan["action_ids"]] == ["Negotiate 14 more days with suppliers"]


def test_public_benchmark_reports_band_coverage_split(client):
    b = client.get("/api/v1/public/benchmark").json()
    assert b["band_coverage_day14_with_invoices_pct"] is not None
    assert b["band_coverage_day14_without_invoices_pct"] is not None
    assert "synthetic" in b["note"].lower()

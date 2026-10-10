"""Dashboard, forecast, alerts, reports, copilot and impact."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_business, require_feature
from ..config import get_settings
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError, not_found
from ..models import Business, FinancialScenario, ForecastRun, RiskAlert
from ..money import fmt_pkr
from ..schemas import CopilotIn
from ..services import copilot as copilot_svc
from ..services import llm
from ..services.i18n import isolate_ltr
from ..services.impact import SDG_TARGETS, run_benchmark
from ..services.insights import dashboard as build_dashboard
from ..services.insights import data_quality, report_insights
from ..services.inventory import inventory_analytics
from ..services.recovery import recommend
from ..services.risk import compute_alerts
from ..services.simulation import simulate
from .common import context, features, forecast_and_store

router = APIRouter(tags=["analytics"])


def _alerts_with_state(db: Session, business: Business, alerts: list[dict], today: date) -> list[dict]:
    """Persist alert state: new alerts are opened, missing ones resolved, acknowledgements kept."""
    existing = {(a.rule, a.entity_key): a for a in db.scalars(select(RiskAlert).where(RiskAlert.business_id == business.id))}
    seen = set()
    out = []
    for a in alerts:
        key = (a["rule"], a["entity_key"][:80])
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = RiskAlert(business_id=business.id, rule=key[0], entity_key=key[1], first_detected_on=today,
                            last_detected_on=today, status="open", level=a["level"], score=a["score"],
                            title=a["title"][:200], payload={})
            db.add(row)
            db.flush()
        elif row.status == "resolved":
            row.status = "open"
        row.level, row.score, row.title, row.last_detected_on = a["level"], a["score"], a["title"][:200], today
        row.payload = {"explanation": a["explanation"], "amounts": a["amounts"], "dates": a["dates"]}
        out.append({**a, "id": row.id, "status": row.status, "first_detected_on": row.first_detected_on.isoformat()})
    for key, row in existing.items():
        if key not in seen and row.status != "resolved":
            row.status = "resolved"
    db.commit()
    return out


def _full_alerts(db: Session, business: Business, snap, today, forecast) -> list[dict]:
    inv = inventory_analytics(snap, today) if "inventory" in features(business) else None
    return _alerts_with_state(db, business, compute_alerts(snap, today, forecast, inv), today)


@router.get("/dashboard")
def dashboard(date_from: date | None = Query(default=None, alias="from"),
              date_to: date | None = Query(default=None, alias="to"),
              business: Business = Depends(get_business), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    end = date_to or today
    start = date_from or (end - timedelta(days=29))
    if start > end:
        raise ApiError(422, "validation_error", "'from' must be on or before 'to'")
    forecast = forecast_and_store(db, business, snap, today, 30)
    alerts = _full_alerts(db, business, snap, today, forecast)
    rec = recommend(snap, today, [], 30, business.recovery_weights) if forecast["summary"]["shortage_date"] else None
    data = build_dashboard(snap, today, forecast, [a for a in alerts if a["status"] != "acknowledged"] or alerts,
                           start, end, features(business), rec)
    data["recent_transactions"] = [
        {"id": t.id, "occurred_on": t.occurred_on.isoformat(), "kind": t.kind, "amount_paisa": t.amount,
         "category": t.category, "description": t.description, "account": t.account}
        for t in sorted(snap.txs, key=lambda t: t.occurred_on, reverse=True)[:8]
    ]
    data["business"] = {"name": business.name, "kind": business.kind, "is_demo": business.is_demo}
    return data


@router.get("/forecast")
def forecast(horizon: int = Query(default=30, ge=7, le=90), business: Business = Depends(require_feature("forecast")),
             db: Session = Depends(get_db)):
    snap, today = context(db, business)
    result = forecast_and_store(db, business, snap, today, horizon)
    history = db.scalars(select(ForecastRun).where(ForecastRun.business_id == business.id)
                         .order_by(ForecastRun.run_date.desc()).limit(14)).all()
    result["previous_runs"] = [{"date": r.run_date.isoformat(), "min_balance_paisa": r.min_balance_paisa,
                                "shortage_date": r.shortage_date.isoformat() if r.shortage_date else None,
                                "model": r.model_name} for r in history]
    return result


@router.get("/alerts")
def alerts(business: Business = Depends(require_feature("alerts")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    fc = forecast_and_store(db, business, snap, today, 30)
    items = _full_alerts(db, business, snap, today, fc)
    resolved = db.scalars(select(RiskAlert).where(RiskAlert.business_id == business.id, RiskAlert.status == "resolved")
                          .order_by(RiskAlert.last_detected_on.desc()).limit(10)).all()
    return {
        "items": items,
        "counts": {lvl: sum(1 for a in items if a["level"] == lvl) for lvl in ("critical", "high", "medium", "low")},
        "recently_resolved": [{"id": r.id, "title": r.title, "rule": r.rule,
                               "last_detected_on": r.last_detected_on.isoformat()} for r in resolved],
        "score_note": "Scores rank urgency using explicit rule thresholds. They are not probabilities.",
    }


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: str, business: Business = Depends(require_feature("alerts")), db: Session = Depends(get_db)):
    row = db.get(RiskAlert, alert_id)
    if row is None or row.business_id != business.id:
        raise not_found("Alert")
    row.status = "acknowledged" if row.status != "acknowledged" else "open"
    db.commit()
    return {"id": row.id, "status": row.status}


def _scenario_summaries(db: Session, business: Business, snap, today) -> list[dict]:
    out = []
    for sc in db.scalars(select(FinancialScenario).where(FinancialScenario.business_id == business.id)
                         .order_by(FinancialScenario.created_at)):
        try:
            res = simulate(snap, today, list(sc.adjustments) + [a.params for a in sc.actions])
        except ValueError:
            continue
        out.append({"id": sc.id, "name": sc.name, "kind": sc.kind, "comparison": res["comparison"],
                    "notes": res["notes"], "min_balance_paisa": res["scenario"]["summary"]["min_balance_paisa"],
                    "shortage_date": res["scenario"]["summary"]["shortage_date"]})
    return out


@router.get("/reports/financial")
def financial_report(business: Business = Depends(require_feature("reports")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    fc = forecast_and_store(db, business, snap, today, 30)
    alert_list = _full_alerts(db, business, snap, today, fc)
    inv = inventory_analytics(snap, today) if "inventory" in features(business) else None
    rec = recommend(snap, today, [], 30, business.recovery_weights)
    scenarios = _scenario_summaries(db, business, snap, today)
    dash = build_dashboard(snap, today, fc, alert_list, today - timedelta(days=29), today, features(business), rec)
    s = fc["summary"]
    k = dash["kpis"]
    summary = [
        f"{business.name} holds {fmt_pkr(k['cash_balance']['value_paisa'])} today across cash, bank and wallet.",
        f"Over the last 30 days revenue was {fmt_pkr(k['revenue']['value_paisa'])} and expenses "
        f"{fmt_pkr(k['expenses']['value_paisa'])} (estimated profit {fmt_pkr(k['net_profit']['value_paisa'])}).",
        (f"The 30-day forecast shows a possible cash shortage from {s['shortage_date']}, with a low of "
         f"{fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}." if s["shortage_date"] else
         f"No cash shortage is projected in the next 30 days; the lowest point is {fmt_pkr(s['min_balance_paisa'])}."),
        f"Financial health index: {k['health']['score']}/100 ({k['health']['label']}).",
    ]
    if rec["strategies"]:
        summary.append(f"Top-ranked action: {rec['strategies'][0]['title']}.")
    limitations = list(fc["assumptions"]) + fc["warnings"] + [
        f"Forecast confidence: {fc['confidence']['level']} ({'; '.join(fc['confidence']['reasons'])}).",
        "All figures come from the records in FinDost. Missing or wrong entries change the results.",
        "FinDost is decision support and does not replace a qualified accountant or financial adviser.",
    ]
    return {
        "generated_at": today.isoformat(),
        "business": {"name": business.name, "kind": business.kind, "city": business.city, "is_demo": business.is_demo},
        "executive_summary": summary,
        "kpis": k,
        "risk_indicators": alert_list[:8],
        "forecast": {"history": fc["history"], "points": fc["points"], "summary": s, "model": fc["model"]},
        "insights": report_insights(snap, today, fc, inv, rec, scenarios),
        "recommendations": [{"id": st["id"], "title": st["title"], "action": st["action"], "timing": st["timing"],
                             "reasoning": st["numerical_reasoning"], "tradeoffs": st["tradeoffs"],
                             "evidence_quality": st["evidence_quality"], "score": st["score"]}
                            for st in rec["strategies"][:5]],
        "scenario_comparison": scenarios,
        "data_quality": dash["data_quality"],
        "limitations": limitations,
        "disclaimer": "Decision support only. Forecasts and simulations are estimates, not guarantees.",
    }


@router.get("/reports/financial.csv")
def financial_report_csv(business: Business = Depends(require_feature("reports")), db: Session = Depends(get_db)):
    rep = financial_report(business, db)
    k = rep["kpis"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "metric", "value_pkr_or_text", "type"])
    rows = [
        ("kpi", "Cash balance", k["cash_balance"]["value_paisa"] / 100, "actual"),
        ("kpi", "Revenue (30d)", k["revenue"]["value_paisa"] / 100, "actual"),
        ("kpi", "Expenses (30d)", k["expenses"]["value_paisa"] / 100, "actual"),
        ("kpi", "Estimated profit (30d)", k["net_profit"]["value_paisa"] / 100, "estimated"),
        ("kpi", "Receivables outstanding", k["receivables"]["value_paisa"] / 100, "actual"),
        ("kpi", "Payables due in 14 days", k["upcoming_payables"]["value_paisa"] / 100, "actual"),
        ("kpi", "Expected cash in 7 days", k["expected_cash_7d"]["value_paisa"] / 100, "forecast"),
        ("kpi", "Expected cash in 14 days", k["expected_cash_14d"]["value_paisa"] / 100, "forecast"),
        ("kpi", "Health index", k["health"]["score"], "index"),
        ("forecast", "Shortage date", rep["forecast"]["summary"]["shortage_date"] or "none", "forecast"),
        ("forecast", "Minimum balance", rep["forecast"]["summary"]["min_balance_paisa"] / 100, "forecast"),
    ]
    for r in rows:
        w.writerow(r)
    for p in rep["forecast"]["points"]:
        w.writerow(("forecast_point", p["date"], p["balance_paisa"] / 100, "forecast"))
    for a in rep["risk_indicators"]:
        w.writerow(("alert", a["title"], a["level"], f"severity {a['score']}"))
    for r in rep["recommendations"]:
        w.writerow(("recommendation", r["title"], r["reasoning"], f"score {r['score']}"))
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="findost-report-{get_today()}.csv"'})


@router.post("/copilot/query")
def copilot(body: CopilotIn, business: Business = Depends(require_feature("copilot")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    result = copilot_svc.answer(snap, today, body.question, body.language or business.language, features(business))
    result["llm_available"] = bool(get_settings().gemini_api_key)
    result["llm_consent"] = business.ai_consent
    if body.use_llm and business.ai_consent and result["intent"] not in ("unknown", "out_of_scope"):
        names = list(snap.customers.values()) + list(snap.suppliers.values()) + [business.name]
        text = llm.rephrase(body.question, result["answer"], result["evidence"], result["language"], names)
        if text:
            result["answer"] = isolate_ltr(text.replace("\u2066", "").replace("\u2069", "")) if result["language"] == "ur" else text
            result["used_llm"] = True
    return result


@router.get("/public/benchmark", tags=["meta"])
def public_benchmark():
    """Synthetic benchmark summary for the public landing page (no user data involved)."""
    b = run_benchmark()
    return {
        "businesses_evaluated": b["businesses_evaluated"],
        "labelled_shortage_rate_pct": b["labelled_shortage_rate_pct"],
        "accuracy_pct": b["model"]["accuracy"],
        "recall_pct": b["model"]["recall"],
        "precision_pct": b["model"]["precision"],
        "naive_accuracy_pct": b["naive_baseline"]["accuracy"],
        "avg_warning_lead_days": b["avg_warning_lead_days"],
        "recovery_scenarios_evaluated": b["recovery_scenarios_evaluated"],
        "note": "Measured on synthetic, held-out test businesses - not real-world outcomes.",
    }


@router.get("/impact")
def impact(business: Business = Depends(require_feature("impact")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    fc = forecast_and_store(db, business, snap, today, 30)
    bench = run_benchmark()
    runs = db.scalars(select(ForecastRun).where(ForecastRun.business_id == business.id)
                      .order_by(ForecastRun.run_date)).all()
    first_warning = next((r for r in runs if r.shortage_date), None)
    scenario_count = db.scalar(select(func.count()).select_from(FinancialScenario)
                               .where(FinancialScenario.business_id == business.id)) or 0
    alert_count = db.scalar(select(func.count()).select_from(RiskAlert).where(RiskAlert.business_id == business.id)) or 0
    rec = recommend(snap, today, [], 30, business.recovery_weights) if fc["summary"]["shortage_date"] else None
    return {
        "measured": {
            "benchmark": bench,
            "your_business": {
                "forecast_model": fc["model"].get("label"),
                "backtest_improvement_vs_baseline_pct": fc["model"].get("improvement_pct"),
                "backtest_weekly_error_pct": fc["model"].get("wape_pct"),
                "data_quality": data_quality(snap, today),
                "shortage_projected": fc["summary"]["shortage_date"],
                "warning_lead_days": fc["summary"]["days_to_shortage"],
                "first_warning_recorded_on": first_warning.run_date.isoformat() if first_warning else None,
                "alerts_generated": alert_count,
                "scenarios_saved": scenario_count,
                "recovery_options_evaluated": len(rec["strategies"]) if rec else 0,
                "best_plan_min_balance_gain_paisa": (rec["combined_plan"]["comparison"]["min_balance_change_paisa"]
                                                     if rec and rec["combined_plan"] else None),
            },
        },
        "hypothetical": {
            "pathway": [
                "Earlier warning of a cash shortage gives an owner time to act (collect, renegotiate, delay purchases).",
                "Acting earlier can reduce missed supplier payments, emergency borrowing at high cost, or forced closure days.",
                "Fewer disruptions can support business continuity and the jobs and household income that depend on it.",
            ],
            "caveat": "This is a plausible pathway, not a measured outcome. FinDost has not yet been evaluated with real "
                      "businesses, so no claim is made that it reduces poverty, saves businesses or creates jobs.",
        },
        "sdg_targets": SDG_TARGETS,
    }

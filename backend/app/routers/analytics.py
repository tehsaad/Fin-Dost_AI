"""Dashboard, forecast, alerts, reports, copilot and impact."""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import get_business, require_feature
from ..config import get_settings
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError, not_found
from ..models import Business, FinanceAction, FinancialScenario, ForecastRun, RiskAlert
from ..money import fmt_pkr
from ..schemas import CopilotIn
from ..services import copilot as copilot_svc
from ..services import ai
from ..services.ai import agent
from ..services.ai import tasks as ai_tasks
from ..services.llm import numbers_grounded
from ..services.i18n import isolate_ltr
from ..services.impact import SDG_TARGETS, stored_benchmark
from ..services.insights import dashboard as build_dashboard
from ..services.insights import data_quality, report_insights
from ..services.ledger import account_balances, period_summary
from ..services.inventory import inventory_analytics
from ..services.recovery import recommend
from ..services.controls import run_checks
from ..services.planning import budget_vs_actual
from ..services.risk import budget_overrun_alerts, compute_alerts
from ..services.simulation import simulate
from .common import context, csv_safe, features, forecast_and_store

log = logging.getLogger("findost.copilot")
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


def _budget_report(db: Session, business: Business, snap, today) -> dict | None:
    if "budget" not in features(business):
        return None
    from .planning import budget_lines

    lines = budget_lines(db, business)
    return budget_vs_actual(snap, lines, today) if lines else None


def _full_alerts(db: Session, business: Business, snap, today, forecast) -> list[dict]:
    inv = inventory_analytics(snap, today) if "inventory" in features(business) else None
    alerts = compute_alerts(snap, today, forecast, inv)
    budget = _budget_report(db, business, snap, today)
    if budget:
        alerts = sorted(alerts + budget_overrun_alerts(budget), key=lambda a: -a["score"])
    return _alerts_with_state(db, business, alerts, today)


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
    # Reporting period: the last 30 days, never earlier than the workspace's opening date.
    start = max(today - timedelta(days=29), snap.opening_date)
    p = period_summary(snap, start, today)
    period = {
        "from": start.isoformat(), "to": today.isoformat(), "days": (today - start).days + 1,
        "opening_cash_paisa": account_balances(snap, start - timedelta(days=1))["total"],
        "closing_cash_paisa": account_balances(snap, today)["total"],
        "cash_in_paisa": p.cash_in, "cash_out_paisa": p.cash_out,
        "revenue_paisa": p.revenue, "expenses_paisa": p.expenses, "profit_paisa": p.profit,
    }
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
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": today.isoformat(),
        "period": period,
        "forecast_horizon_days": fc["horizon_days"],
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
        "budget": _budget_report(db, business, snap, today),
        "actions": _action_summary(db, business),
        "controls": _controls_summary(snap, today) if "controls" in features(business) else None,
        "data_quality": dash["data_quality"],
        "limitations": limitations,
        "disclaimer": "Decision support only. Forecasts and simulations are estimates, not guarantees.",
    }


def _controls_summary(snap, today) -> dict:
    checks = run_checks(snap, today)
    return {"issue_count": checks["issue_count"], "records_flagged": checks["records_flagged"], "scope": checks["scope"],
            "issues": [{"title": c["title"], "count": c["count"], "severity": c["severity"]}
                       for c in checks["checks"] if c["status"] == "issue"]}


def _action_summary(db: Session, business: Business) -> dict | None:
    if "actions" not in features(business):
        return None
    rows = db.scalars(select(FinanceAction).where(FinanceAction.business_id == business.id)
                      .order_by(FinanceAction.created_at.desc())).all()
    counts: dict[str, int] = {}
    for a in rows:
        counts[a.status] = counts.get(a.status, 0) + 1
    open_items = [{"title": a.title, "status": a.status, "estimated_impact_paisa": a.estimated_impact_paisa}
                  for a in rows if a.status in ("proposed", "pending_approval", "approved")][:10]
    return {"counts": counts, "open": open_items,
            "note": "Approved means a person approved the plan; completed means a person recorded it as done. "
                    "FinDost does not move money."}


@router.get("/reports/financial.csv")
def financial_report_csv(business: Business = Depends(require_feature("reports")), db: Session = Depends(get_db)):
    rep = financial_report(business, db)
    k = rep["kpis"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "metric", "value_pkr_or_text", "type"])
    per = rep["period"]
    rows = [
        ("report", "Generated at (UTC)", rep["generated_at"], "meta"),
        ("report", "Reporting period", f"{per['from']} to {per['to']}", "meta"),
        ("report", "Forecast horizon (days)", rep["forecast_horizon_days"], "meta"),
        ("period", "Opening cash", per["opening_cash_paisa"] / 100, "actual"),
        ("period", "Cash in", per["cash_in_paisa"] / 100, "actual"),
        ("period", "Cash out", per["cash_out_paisa"] / 100, "actual"),
        ("period", "Closing cash", per["closing_cash_paisa"] / 100, "actual"),
        ("period", "Revenue", per["revenue_paisa"] / 100, "actual"),
        ("period", "Expenses", per["expenses_paisa"] / 100, "actual"),
        ("period", "Estimated profit", per["profit_paisa"] / 100, "estimated"),
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
        w.writerow([csv_safe(v) for v in r])
    for p in rep["forecast"]["points"]:
        w.writerow(("forecast_point", p["date"], p["balance_paisa"] / 100, "forecast"))
    for a in rep["risk_indicators"]:
        w.writerow([csv_safe(v) for v in ("alert", a["title"], a["level"], f"severity {a['score']}")])
    for r in rep["recommendations"]:
        w.writerow([csv_safe(v) for v in ("recommendation", r["title"], r["reasoning"], f"score {r['score']}")])
    for sc in rep["scenario_comparison"]:
        c = sc["comparison"]
        w.writerow([csv_safe(v) for v in ("scenario", sc["name"], c["min_balance_change_paisa"] / 100,
                    f"shortage {c['scenario_shortage_date'] or 'none'} (baseline {c['baseline_shortage_date'] or 'none'})")])
    if rep.get("budget"):
        for line in rep["budget"]["lines"]:
            w.writerow([csv_safe(v) for v in ("budget", line["category"], line["actual_paisa"] / 100,
                                              f"budget {line['budget_paisa'] / 100:.2f} ({line['used_pct']}% used, {line['status']})")])
    if rep.get("actions"):
        for st, n in sorted(rep["actions"]["counts"].items()):
            w.writerow(("actions", st, n, "count"))
    if rep.get("controls"):
        w.writerow(("controls", "Data checks with issues", rep["controls"]["issue_count"], "count"))
    for note in rep["limitations"]:
        w.writerow([csv_safe(v) for v in ("limitation", note, "", "text")])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="findost-report-{get_today()}.csv"'})


COPILOT_STAGES = {"understanding": "Understanding…", "calculating": "Calculating…", "writing": "Writing…"}
AI_OFF = ("unknown", "out_of_scope", "clarify", "error")


def _agent_extra_tools(db: Session, business: Business, snap, today) -> dict:
    """Database-backed tools for the Copilot agent; each returns engine-computed text and evidence lines."""
    def budget() -> dict:
        rep = _budget_report(db, business, snap, today)
        if not rep:
            return {"answer": "No budgets have been set yet, so budget vs actual cannot be calculated. Add them on the Budget page.",
                    "evidence": [], "links": ["/budget"]}
        t = rep["totals"]
        ev = [f"{x['category']}: {fmt_pkr(x['actual_paisa'])} of {fmt_pkr(x['budget_paisa'])} ({x['used_pct']}%, {x['status']})"
              for x in rep["lines"]]
        return {"answer": f"In {rep['month']} you have spent {fmt_pkr(t['actual_paisa'])} against budgets of "
                          f"{fmt_pkr(t['budget_paisa'])}.", "evidence": ev, "links": ["/budget"]}

    def approvals() -> dict:
        summary = _action_summary(db, business)
        if summary is None or not summary["counts"]:
            return {"answer": "There are no proposed actions or tasks yet.", "evidence": [], "links": ["/actions"]}
        ev = [f"{a['title']} — {a['status'].replace('_', ' ')}"
              + (f", estimated effect on lowest balance {fmt_pkr(a['estimated_impact_paisa'])}" if a["estimated_impact_paisa"] is not None else "")
              for a in summary["open"]]
        counts = ", ".join(f"{n} {st.replace('_', ' ')}" for st, n in sorted(summary["counts"].items()))
        return {"answer": f"Actions by status: {counts}. {summary['note']}", "evidence": ev, "links": ["/actions"]}

    def data_checks() -> dict:
        c = _controls_summary(snap, today)
        ev = [f"{i['title']}: {i['count']} record(s) ({i['severity']})" for i in c["issues"]]
        return {"answer": f"{c['issue_count']} data check(s) found issues covering {c['records_flagged']} record(s). {c['scope']}",
                "evidence": ev, "links": ["/controls"]}

    def goals() -> dict:
        from ..models import SavingsGoal
        from ..services.planning import goal_view

        rows = db.scalars(select(SavingsGoal).where(SavingsGoal.business_id == business.id)).all()
        if not rows:
            return {"answer": "No savings goals have been set yet. Add one on the Goals page.", "evidence": [], "links": ["/goals"]}
        views = [goal_view(g, snap, today) for g in rows]
        ev = [f"{v['name']}: {fmt_pkr(v['saved_paisa'])} of {fmt_pkr(v['target_paisa'])} by {v['target_date']}, "
              f"{fmt_pkr(v['monthly_needed_paisa'])} a month needed ({v['status'].replace('_', ' ')})" for v in views]
        return {"answer": " ".join(v["note"] for v in views[:2]), "evidence": ev, "links": ["/goals"]}

    feats = features(business)
    tools = {"budget": budget, "approvals": approvals, "data_checks": data_checks, "goals": goals}
    need = {"budget": "budget", "approvals": "actions", "data_checks": "controls", "goals": "goals"}
    return {k: v for k, v in tools.items() if need[k] in feats}


def _copilot_steps(body: CopilotIn, business: Business, db: Session):
    """The copilot pipeline as a sequence of ("status", stage) events ending in ("answer", result).

    Figures always come from FinDost's engine on this workspace's own records; AI only picks the tool for a
    question the rules can't place and rewords the computed answer. When AI is off, unavailable, failing or
    over today's limit, the rule-based answer is returned with `ai_fallback` saying why."""
    yield "status", "understanding"
    snap, today = context(db, business)
    language = body.language or business.language
    prev = body.context.model_dump() if body.context else None
    earlier = [t.text for t in body.history if t.role == "user"]
    status = ai.status()
    available = status["tasks"]["explain"]["available"]
    llm_ok = body.use_llm and business.ai_consent and available
    fallback = None if llm_ok else ("disabled" if not business.ai_consent or not body.use_llm else "unavailable")
    names = list(snap.customers.values()) + list(snap.suppliers.values()) + [business.name]

    yield "status", "calculating"
    result = copilot_svc.answer(snap, today, body.question, language, features(business), context=prev)
    if result["intent"] in ("unknown", "clarify"):
        # "hi", "salam", "thanks": answer in kind instead of "I couldn't match that" (no AI, no quota).
        greeting = agent.small_talk(body.question, result["language"])
        if greeting:
            result = greeting
    if llm_ok and result["intent"] in ("unknown", "clarify"):
        # The rules could not place the question: let the model map it to one of our tools (it sees only the
        # user's questions with names masked, never records). The tool then computes the answer from the user's data.
        try:
            ai.consume_quota(db, business, "explain", today)
            picked = ai_tasks.interpret(body.question, names, (prev or {}).get("intent"), earlier)
        except ApiError:
            picked, llm_ok, fallback = None, False, "quota"
        if picked:
            intent, params, provider = picked
            interpreted = copilot_svc.answer(snap, today, body.question, language, features(business),
                                             override={"intent": intent, "params": params})
            if interpreted["intent"] not in ("unknown", "error"):
                result = {**interpreted, "interpreted_by": provider}
    if llm_ok and result["intent"] in ("unknown", "clarify"):
        # Still unplaced (several tools needed, inventory/alerts, small talk or a clarification): let the agent
        # plan with the engine's tools and word the result; any figure it adds is rejected.
        try:
            ai.consume_quota(db, business, "explain", today)
        except ApiError:
            llm_ok, fallback = False, "quota"
        else:
            history = [agent.Turn(t.role, t.text) for t in body.history]
            planned = agent.answer(snap, today, body.question, history, features(business), names, business.kind,
                                   _agent_extra_tools(db, business, snap, today))
            if planned:
                result = planned
    ai_provider = result.get("ai_provider")
    result.update(llm_available=available, llm_consent=business.ai_consent, ai_provider=ai_provider)

    if llm_ok and result["intent"] not in AI_OFF + ("greeting",) and not result.get("used_llm") and not result.get("agent"):
        yield "status", "writing"
        try:
            ai.consume_quota(db, business, "explain", today)
        except ApiError:
            fallback = "quota"  # keep the rule-based wording; the figures are already computed
        else:
            lang = "roman_ur" if result["language"] == "en" and copilot_svc.is_roman_urdu(body.question) else result["language"]
            out = ai_tasks.explain(body.question, result["answer"], result["evidence"], lang, names)
            if out:
                text, provider = out
                result["answer"] = isolate_ltr(text.replace("\u2066", "").replace("\u2069", "")) if lang == "ur" else text
                result["used_llm"] = True
                result["ai_provider"] = provider
            else:
                fallback = "ai_error"
    result["ai_fallback"] = None if result.get("used_llm") else fallback
    yield "answer", result


@router.post("/copilot/query")
def copilot(body: CopilotIn, business: Business = Depends(require_feature("copilot")), db: Session = Depends(get_db)):
    result = None
    for kind, payload in _copilot_steps(body, business, db):
        if kind == "answer":
            result = payload
    return result


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@router.post("/copilot/stream")
def copilot_stream(body: CopilotIn, business: Business = Depends(require_feature("copilot")),
                   db: Session = Depends(get_db)):
    """Same answer as /copilot/query, streamed as Server-Sent Events: `status` events while it works
    ({stage, label}), then one `answer` event, or one `error` event ({code, message})."""
    def events():
        try:
            for kind, payload in _copilot_steps(body, business, db):
                if kind == "status":
                    yield _sse("status", {"stage": payload, "label": COPILOT_STAGES[payload]})
                else:
                    yield _sse("answer", payload)
        except ApiError as exc:
            yield _sse("error", {"code": exc.code, "message": exc.message})
        except Exception:  # never leak internals into the stream
            log.error("copilot stream failed", exc_info=True)
            yield _sse("error", {"code": "internal_error", "message": "Copilot couldn't answer just now. Please try again."})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


@router.get("/ai/status")
def ai_status(business: Business = Depends(get_business)):
    """Which AI providers are configured (booleans and model names only) and today's quota."""
    return {**ai.status(), "consent": business.ai_consent}


@router.post("/ai/test")
def ai_test(business: Business = Depends(get_business), db: Session = Depends(get_db)):
    """Live check of the explanation route with a fixed, fictional sentence (no user data is sent)."""
    ai.consume_quota(db, business, "explain", get_today())
    sample = "Cash today is Rs. 118,000. The lowest projected balance is Rs. -12,000 on 2026-10-19."
    started = ai.status()
    if not started["tasks"]["explain"]["available"]:
        return {"ok": False, "code": "unavailable", "message": "No AI provider is configured on the server."}
    try:
        res = ai.run(ai.AIRequest(task="explain", system=ai_tasks.EXPLAIN_SYSTEM,
                                  user=f"Answer in simple English.\nQUESTION: Summarise.\nEVIDENCE:\n{sample}",
                                  schema=ai_tasks.ExplainOut, max_output_tokens=200))
    except ai.AIError as exc:
        return {"ok": False, "code": exc.code, "message": str(exc)}
    return {"ok": True, "provider": res.provider, "model": res.model, "latency_ms": res.latency_ms,
            "grounded": numbers_grounded(res.data.answer, sample)}


HYPOTHETICAL = {
    "pathway": [
        "Earlier warning of a cash shortage gives an owner time to act (collect, renegotiate, delay purchases).",
        "Acting earlier can reduce missed supplier payments, emergency borrowing at high cost, or forced closure days.",
        "Fewer disruptions can support business continuity and the jobs and household income that depend on it.",
    ],
    "caveat": "This is a plausible pathway, not a measured outcome. FinDost has not yet been evaluated with real "
              "businesses, so no claim is made that it reduces poverty, saves businesses or creates jobs.",
}


@router.get("/public/benchmark", tags=["meta"])
def public_benchmark():
    """Synthetic benchmark summary for the public landing page (no user data involved)."""
    b = stored_benchmark()
    return {
        "version": b["version"],
        "generated_at": b.get("generated_at"),
        "businesses_evaluated": b["businesses_evaluated"],
        "horizon_days": b["config"]["horizon_days"],
        "labelled_shortage_rate_pct": b["labelled_shortage_rate_pct"],
        "accuracy_pct": b["model"]["accuracy"],
        "recall_pct": b["model"]["recall"],
        "precision_pct": b["model"]["precision"],
        "false_positive_rate_pct": b["model"]["false_positive_rate"],
        "naive_accuracy_pct": b["naive_baseline"]["accuracy"],
        "naive_recall_pct": b["naive_baseline"]["recall"],
        "naive_false_positive_rate_pct": b["naive_baseline"]["false_positive_rate"],
        "avg_warning_lead_days": b["avg_warning_lead_days"],
        "recovery_scenarios_evaluated": b["recovery_scenarios_evaluated"],
        "median_abs_error_day14_paisa": b["median_abs_error_day14_paisa"],
        "naive_median_abs_error_day14_paisa": b["naive_median_abs_error_day14_paisa"],
        "band_coverage_day14_pct": b.get("band_coverage_day14_pct"),
        "definitions": b["definitions"],
        "limitations": b["limitations"],
        "sdg_targets": SDG_TARGETS,
        "hypothetical": HYPOTHETICAL,
        "note": "Measured on synthetic, held-out test businesses - not real-world outcomes.",
    }


@router.get("/impact")
def impact(business: Business = Depends(require_feature("impact")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    fc = forecast_and_store(db, business, snap, today, 30)
    bench = stored_benchmark()
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
        "hypothetical": HYPOTHETICAL,
        "sdg_targets": SDG_TARGETS,
    }

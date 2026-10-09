"""Shock simulator, what-if scenarios and recovery strategies."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_feature
from ..db import get_db
from ..errors import ApiError
from ..models import Business, FinancialScenario, ScenarioAction
from ..schemas import Adjustments, CompareScenariosIn, RecoveryCompareIn, RecoveryIn, ScenarioIn
from ..services.forecast import build_components, project
from ..services.ledger import payable_view, receivable_view
from ..services.recovery import compare_strategies, recommend
from ..services.simulation import ACTION_TYPES, SHOCK_PRESETS, AdjustmentError, simulate
from .common import context, owned

router = APIRouter(tags=["scenarios"])


def _run(snap, today, adjustments, horizon=30):
    try:
        return simulate(snap, today, adjustments, horizon)
    except AdjustmentError as exc:
        raise ApiError(422, "invalid_adjustment", str(exc))


def _scenario_dict(sc: FinancialScenario) -> dict:
    return {"id": sc.id, "name": sc.name, "description": sc.description, "kind": sc.kind,
            "adjustments": sc.adjustments, "is_demo": sc.is_demo,
            "actions": [{"id": a.id, "action_type": a.action_type, "label": a.label, "params": a.params} for a in sc.actions],
            "last_result": sc.last_result, "updated_at": sc.updated_at.isoformat() if sc.updated_at else None}


@router.get("/scenarios/presets")
def presets(business: Business = Depends(require_feature("simulator")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    return {
        "presets": SHOCK_PRESETS,
        "receivables": [receivable_view(r, today) for r in snap.receivables if r.outstanding > 0],
        "payables": [payable_view(p, today) for p in snap.payables if p.outstanding > 0],
        "customers": [{"id": k, "name": v} for k, v in snap.customers.items()],
    }


@router.post("/scenarios/simulate")
def simulate_adhoc(body: Adjustments, business: Business = Depends(require_feature("simulator")),
                   db: Session = Depends(get_db)):
    snap, today = context(db, business)
    return _run(snap, today, body.adjustments, body.horizon)


@router.get("/scenarios")
def list_scenarios(business: Business = Depends(require_feature("simulator")), db: Session = Depends(get_db)):
    rows = db.scalars(select(FinancialScenario).where(FinancialScenario.business_id == business.id)
                      .order_by(FinancialScenario.created_at)).all()
    return {"items": [_scenario_dict(s) for s in rows]}


def _save(db: Session, business: Business, sc: FinancialScenario, body: ScenarioIn) -> dict:
    snap, today = context(db, business)
    for a in body.actions:
        if a.get("type") not in ACTION_TYPES:
            raise ApiError(422, "invalid_adjustment", f"'{a.get('type')}' is not a recovery action")
    result = _run(snap, today, body.adjustments + body.actions)
    sc.name, sc.description, sc.kind, sc.adjustments = body.name, body.description, body.kind, body.adjustments
    sc.actions.clear()
    for a in body.actions:
        sc.actions.append(ScenarioAction(action_type=a["type"], label=str(a.get("label") or a["type"])[:200], params=a))
    sc.last_result = {"summary": result["scenario"]["summary"], "comparison": result["comparison"]}
    sc.is_demo = False
    db.commit()
    return {**_scenario_dict(sc), "result": result}


@router.post("/scenarios", status_code=201)
def create_scenario(body: ScenarioIn, business: Business = Depends(require_feature("simulator")),
                    db: Session = Depends(get_db)):
    sc = FinancialScenario(business_id=business.id, name=body.name)
    db.add(sc)
    return _save(db, business, sc, body)


@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str, business: Business = Depends(require_feature("simulator")),
                 db: Session = Depends(get_db)):
    return _scenario_dict(owned(db, FinancialScenario, scenario_id, business, "Scenario"))


@router.put("/scenarios/{scenario_id}")
def update_scenario(scenario_id: str, body: ScenarioIn, business: Business = Depends(require_feature("simulator")),
                    db: Session = Depends(get_db)):
    return _save(db, business, owned(db, FinancialScenario, scenario_id, business, "Scenario"), body)


@router.delete("/scenarios/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: str, business: Business = Depends(require_feature("simulator")),
                    db: Session = Depends(get_db)):
    db.delete(owned(db, FinancialScenario, scenario_id, business, "Scenario"))
    db.commit()


@router.post("/scenarios/{scenario_id}/simulate")
def simulate_saved(scenario_id: str, horizon: int = 30, business: Business = Depends(require_feature("simulator")),
                   db: Session = Depends(get_db)):
    sc = owned(db, FinancialScenario, scenario_id, business, "Scenario")
    snap, today = context(db, business)
    result = _run(snap, today, list(sc.adjustments) + [a.params for a in sc.actions], max(7, min(horizon, 90)))
    sc.last_result = {"summary": result["scenario"]["summary"], "comparison": result["comparison"]}
    db.commit()
    return {**_scenario_dict(sc), "result": result}


@router.post("/scenarios/compare")
def compare_saved(body: CompareScenariosIn, business: Business = Depends(require_feature("simulator")),
                  db: Session = Depends(get_db)):
    snap, today = context(db, business)
    base = build_components(snap, today, body.horizon)
    baseline = project(base)
    rows = []
    for sid in body.scenario_ids:
        sc = owned(db, FinancialScenario, sid, business, "Scenario")
        try:
            res = simulate(snap, today, list(sc.adjustments) + [a.params for a in sc.actions], body.horizon, base=base)
        except AdjustmentError as exc:
            raise ApiError(422, "invalid_adjustment", str(exc))
        rows.append({"id": sc.id, "name": sc.name, "summary": res["scenario"]["summary"], "comparison": res["comparison"],
                     "notes": res["notes"],
                     "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in res["scenario"]["points"]]})
    return {"baseline": {"summary": baseline["summary"],
                         "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in baseline["points"]]},
            "scenarios": rows,
            "disclaimer": "Simulations only - not actual events or certain predictions."}


def _scenario_adjustments(db: Session, business: Business, scenario_id: str | None, adjustments: list[dict]) -> list[dict]:
    if scenario_id:
        sc = owned(db, FinancialScenario, scenario_id, business, "Scenario")
        return list(sc.adjustments) + adjustments
    return adjustments


@router.post("/recovery/recommendations")
def recovery_recommendations(body: RecoveryIn, business: Business = Depends(require_feature("recovery")),
                             db: Session = Depends(get_db)):
    snap, today = context(db, business)
    adjustments = _scenario_adjustments(db, business, body.scenario_id, body.adjustments)
    try:
        return recommend(snap, today, adjustments, body.horizon, body.weights or business.recovery_weights)
    except AdjustmentError as exc:
        raise ApiError(422, "invalid_adjustment", str(exc))


@router.post("/recovery/compare")
def recovery_compare(body: RecoveryCompareIn, business: Business = Depends(require_feature("recovery")),
                     db: Session = Depends(get_db)):
    snap, today = context(db, business)
    adjustments = _scenario_adjustments(db, business, body.scenario_id, body.adjustments)
    for st in body.strategies:
        for a in st.adjustments:
            if a.get("type") not in ACTION_TYPES:
                raise ApiError(422, "invalid_adjustment", f"'{a.get('type')}' is not a recovery action")
    try:
        return compare_strategies(snap, today, adjustments, [s.model_dump() for s in body.strategies], body.horizon)
    except AdjustmentError as exc:
        raise ApiError(422, "invalid_adjustment", str(exc))

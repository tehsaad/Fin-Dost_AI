"""The published benchmark must be reproducible from code and honest about what it measures."""
import json

from app.services.impact import STORED, run_benchmark, stored_benchmark


def test_stored_benchmark_matches_a_fresh_run():
    stored = json.loads(STORED.read_text())
    fresh = json.loads(json.dumps(run_benchmark()))  # same JSON types as the file
    for key in ("generated_at", "status"):
        stored.pop(key)
    assert stored == fresh, "re-run scripts/run_benchmark.py after changing the forecast or benchmark code"


def test_benchmark_reports_definitions_baseline_and_false_alarms():
    b = stored_benchmark()
    for key in ("split", "horizon_days", "labelled_shortage", "recall", "false_positive_rate", "lead_time", "balance_error"):
        assert b["definitions"][key]
    m, naive = b["model"], b["naive_baseline"]
    assert m["confusion"]["tp"] + m["confusion"]["fn"] == b["labelled_shortages"]
    assert sum(m["confusion"].values()) == b["businesses_evaluated"] == 120
    assert 0 <= m["false_positive_rate"] <= 100 and "false_positive_rate" in naive
    assert b["naive_median_abs_error_day14_paisa"] > 0 and b["median_abs_error_day14_paisa"] > 0
    assert "synthetic" in b["limitations"].lower()


def test_public_benchmark_is_labelled_synthetic(client):
    body = client.get("/api/v1/public/benchmark").json()
    assert "synthetic" in body["note"].lower() and body["version"] == "benchmark-v2"
    assert body["naive_recall_pct"] >= 0 and body["false_positive_rate_pct"] >= 0

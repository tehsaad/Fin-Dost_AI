"""Re-run the synthetic shortage benchmark and store the results with metadata.

    python scripts/run_benchmark.py

The API serves backend/app/data/benchmark.json; tests fail if it no longer matches a fresh run,
so the published numbers can never drift from the code that produced them.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.impact import STORED, run_benchmark  # noqa: E402

result = {**run_benchmark(), "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
          "status": "stored"}
STORED.parent.mkdir(parents=True, exist_ok=True)
STORED.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
m, b = result["model"], result["naive_baseline"]
print(f"wrote {STORED}: recall {m['recall']}% (naive {b['recall']}%), FPR {m['false_positive_rate']}% "
      f"(naive {b['false_positive_rate']}%), lead {result['avg_warning_lead_days']} days")

from __future__ import annotations

from backend import analyze_indicators as legacy


def build_assistant_summary(meta: dict, schema: dict, validation: dict, dashboard: dict) -> dict:
    return legacy.build_analysis_assistant(meta, schema, validation, dashboard)


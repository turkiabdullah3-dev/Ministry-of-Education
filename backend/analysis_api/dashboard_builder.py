from __future__ import annotations

import pandas as pd

from backend import analyze_indicators as legacy


def build_dashboard_payload(
    dataframe: pd.DataFrame,
    filename: str,
    sheet_name: str,
    preparation_meta: dict | None = None,
) -> dict:
    return legacy.build_analysis(dataframe, filename, sheet_name, preparation_meta or {})


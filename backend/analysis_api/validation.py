from __future__ import annotations

import pandas as pd

from backend import analyze_indicators as legacy


def build_preflight_report(dataframe: pd.DataFrame, profiles: list[dict]) -> dict:
    return legacy.build_preflight_report(dataframe, profiles)


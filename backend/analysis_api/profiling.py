from __future__ import annotations

import pandas as pd

from backend import analyze_indicators as legacy


def profile_columns(dataframe: pd.DataFrame) -> list[dict]:
    return legacy.profile_columns(dataframe)


def serialize_profiles(profiles: list[dict]) -> list[dict]:
    serialized: list[dict] = []

    for profile in profiles:
        serialized.append(
            {
                "name": profile["name"],
                "normalized": profile["normalized"],
                "nonNull": int(profile["non_null"]),
                "uniqueCount": int(profile["unique_count"]),
                "numericRatio": float(profile["numeric_ratio"]),
                "datetimeRatio": float(profile["datetime_ratio"]),
                "completenessRatio": float(profile["completenessRatio"]),
                "textRatio": float(profile["text_ratio"]),
                "mixedTypeScore": float(profile["mixedTypeScore"]),
                "avgTextLength": float(profile["avg_text_length"]),
            }
        )

    return serialized


from __future__ import annotations

from typing import Any

import pandas as pd


DATE_HINTS = ("date", "time", "period", "month", "تاريخ", "فترة", "شهر", "يوم")
METRIC_HINTS = (
    "value",
    "amount",
    "total",
    "sales",
    "revenue",
    "cost",
    "price",
    "ratio",
    "score",
    "قيمة",
    "مبلغ",
    "إجمالي",
    "المبيعات",
    "تكلفة",
    "نسبة",
)
IDENTIFIER_HINTS = ("id", "code", "sku", "key", "uuid", "رقم", "معرف", "رمز", "كود")
CATEGORY_HINTS = ("category", "department", "group", "segment", "type", "class", "تصنيف", "إدارة", "قسم", "فئة", "نوع")


def _normalize_name(name: Any) -> str:
    return str(name or "").strip().lower()


def _non_null_series(series: pd.Series) -> pd.Series:
    return series.dropna()


def _string_series(series: pd.Series) -> pd.Series:
    return _non_null_series(series).astype(str).str.strip()


def _examples(series: pd.Series, limit: int = 5) -> list[str]:
    values = _string_series(series)
    if values.empty:
        return []
    unique_values = []
    seen = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        unique_values.append(value)
        if len(unique_values) >= limit:
            break
    return unique_values


def _numeric_ratio(series: pd.Series) -> float:
    values = _non_null_series(series)
    if values.empty:
        return 0.0
    numeric = pd.to_numeric(values, errors="coerce")
    return float(numeric.notna().mean())


def _datetime_ratio(series: pd.Series) -> float:
    values = _non_null_series(series)
    if values.empty:
        return 0.0
    parsed = pd.to_datetime(values, errors="coerce")
    return float(parsed.notna().mean())


def _identifier_ratio(series: pd.Series) -> float:
    values = _string_series(series)
    if values.empty:
        return 0.0
    distinct_ratio = float(values.nunique() / max(len(values), 1))
    avg_length = float(values.str.len().mean()) if not values.empty else 0.0
    compact_token_ratio = float(values.str.fullmatch(r"[A-Za-z0-9\-_]{4,}").fillna(False).mean())
    return min(1.0, (distinct_ratio * 0.6) + (compact_token_ratio * 0.3) + (0.1 if avg_length <= 18 else 0.0))


def _category_ratio(series: pd.Series) -> float:
    values = _string_series(series)
    if values.empty:
        return 0.0
    distinct_count = int(values.nunique())
    total_count = max(len(values), 1)
    distinct_ratio = distinct_count / total_count
    if distinct_count < 2:
        return 0.0
    if distinct_ratio <= 0.02:
        return 0.35
    if distinct_ratio <= 0.25:
        return 0.9
    if distinct_ratio <= 0.55:
        return 0.65
    return 0.2


def _has_hint(name: str, hints: tuple[str, ...]) -> bool:
    return any(hint in name for hint in hints)


def _infer_expected_type(
    *,
    name: str,
    numeric_ratio: float,
    datetime_ratio: float,
    identifier_ratio: float,
    category_ratio: float,
) -> tuple[str, bool, bool, bool, bool, float]:
    looks_like_date = datetime_ratio >= 0.7 or (_has_hint(name, DATE_HINTS) and datetime_ratio >= 0.2)
    looks_like_metric = numeric_ratio >= 0.75 or (_has_hint(name, METRIC_HINTS) and numeric_ratio >= 0.3)
    looks_like_identifier = identifier_ratio >= 0.75 or (_has_hint(name, IDENTIFIER_HINTS) and identifier_ratio >= 0.35)
    looks_like_category = category_ratio >= 0.65 or (_has_hint(name, CATEGORY_HINTS) and category_ratio >= 0.25)

    if looks_like_date:
        return "date", looks_like_date, looks_like_metric, looks_like_identifier, looks_like_category, max(datetime_ratio, 0.72)
    if looks_like_metric:
        return "numeric", looks_like_date, looks_like_metric, looks_like_identifier, looks_like_category, max(numeric_ratio, 0.72)
    if looks_like_identifier:
        return "identifier", looks_like_date, looks_like_metric, looks_like_identifier, looks_like_category, max(identifier_ratio, 0.7)
    if looks_like_category:
        return "category", looks_like_date, looks_like_metric, looks_like_identifier, looks_like_category, max(category_ratio, 0.68)

    text_signal = max(0.0, 1 - max(numeric_ratio, datetime_ratio))
    confidence = max(text_signal * 0.6, 0.4)
    return "text", looks_like_date, looks_like_metric, looks_like_identifier, looks_like_category, confidence


def profile_columns(dataframe: pd.DataFrame) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []

    total_rows = max(len(dataframe.index), 1)

    for column in dataframe.columns:
        series = dataframe[column]
        name = str(column)
        normalized_name = _normalize_name(name)
        non_null = _non_null_series(series)
        null_ratio = 1 - (len(non_null) / total_rows)
        unique_count = int(_string_series(series).nunique()) if len(non_null) else 0
        numeric_ratio = _numeric_ratio(series)
        datetime_ratio = _datetime_ratio(series)
        identifier_ratio = _identifier_ratio(series)
        category_ratio = _category_ratio(series)
        (
            expected_data_type,
            looks_like_date,
            looks_like_metric,
            looks_like_identifier,
            looks_like_category,
            confidence,
        ) = _infer_expected_type(
            name=normalized_name,
            numeric_ratio=numeric_ratio,
            datetime_ratio=datetime_ratio,
            identifier_ratio=identifier_ratio,
            category_ratio=category_ratio,
        )

        profiles.append(
            {
                "name": name,
                "expected_data_type": expected_data_type,
                "null_ratio": round(float(null_ratio), 4),
                "unique_count": unique_count,
                "examples": _examples(series),
                "numeric_ratio": round(float(numeric_ratio), 4),
                "datetime_ratio": round(float(datetime_ratio), 4),
                "looks_like_date": looks_like_date,
                "looks_like_metric": looks_like_metric,
                "looks_like_identifier": looks_like_identifier,
                "looks_like_category": looks_like_category,
                "confidence": round(float(min(confidence, 1.0)), 4),
            }
        )

    return profiles

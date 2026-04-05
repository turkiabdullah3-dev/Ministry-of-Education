from __future__ import annotations

from typing import Any

import pandas as pd


BEFORE_ALIASES = ("before", "baseline", "previous", "old", "قبل", "سابق", "السابق", "القديم")
AFTER_ALIASES = ("after", "current", "new", "latest", "بعد", "حالي", "الحالي", "الجديد")


def _normalize_name(value: str) -> str:
    return "".join(str(value or "").strip().lower().split())


def _pick_top_candidate(schema_candidates: list[dict[str, Any]], role: str) -> dict[str, Any] | None:
    candidates = [candidate for candidate in schema_candidates if candidate.get("role") == role]
    if not candidates:
        return None
    return max(candidates, key=lambda item: float(item.get("confidence", 0.0)))


def _find_profile(profiles: list[dict[str, Any]], column_name: str | None) -> dict[str, Any] | None:
    if not column_name:
        return None
    for profile in profiles:
        if profile.get("name") == column_name:
            return profile
    return None


def _find_before_after_columns(dataframe: pd.DataFrame, profiles: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    before_column = None
    after_column = None

    for profile in profiles:
        if profile.get("expected_data_type") != "numeric":
            continue

        normalized_name = _normalize_name(profile.get("name", ""))
        if before_column is None and any(alias in normalized_name for alias in BEFORE_ALIASES):
            before_column = profile["name"]
        if after_column is None and any(alias in normalized_name for alias in AFTER_ALIASES):
            after_column = profile["name"]

    return before_column, after_column


def _quality_cards(meta: dict[str, Any], validation: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "title": "جودة الملف",
            "value": f"{validation.get('quality_score', 0):.0f}",
            "subtitle": "Quality score",
            "tone": "cyan",
            "confidence": float(validation.get("confidence", 0.0)),
        },
        {
            "title": "عدد الصفوف",
            "value": str(meta.get("row_count_raw") or meta.get("row_count") or 0),
            "subtitle": "السجلات الخام المقروءة",
            "tone": "blue",
            "confidence": 0.95,
        },
    ]


def _build_category_bar_chart(dataframe: pd.DataFrame, column_name: str) -> dict[str, Any] | None:
    series = dataframe[column_name].dropna().astype(str).str.strip()
    if series.empty:
        return None

    counts = series.value_counts().head(8)
    return {
        "chart_type": "bar",
        "title": f"التوزيع حسب {column_name}",
        "subtitle": "أعلى الفئات بعدد السجلات",
        "series": [{"label": str(label), "value": int(value)} for label, value in counts.items()],
    }


def _build_status_distribution_chart(dataframe: pd.DataFrame, column_name: str) -> dict[str, Any] | None:
    series = dataframe[column_name].dropna().astype(str).str.strip()
    if series.empty:
        return None

    counts = series.value_counts().head(8)
    total = max(int(counts.sum()), 1)
    return {
        "chart_type": "distribution",
        "title": f"توزيع الحالات من {column_name}",
        "subtitle": "نسبة كل حالة من إجمالي السجلات",
        "series": [
            {
                "label": str(label),
                "value": int(value),
                "share": round((int(value) / total) * 100, 1),
            }
            for label, value in counts.items()
        ],
    }


def _build_date_trend_chart(dataframe: pd.DataFrame, column_name: str) -> dict[str, Any] | None:
    parsed = pd.to_datetime(dataframe[column_name], errors="coerce")
    parsed = parsed.dropna()
    if parsed.empty:
        return None

    periods = parsed.dt.to_period("M")
    counts = periods.value_counts().sort_index().tail(12)
    return {
        "chart_type": "line",
        "title": f"الاتجاه الزمني من {column_name}",
        "subtitle": "عدد السجلات عبر الفترات الزمنية",
        "series": [{"label": str(period), "value": int(value)} for period, value in counts.items()],
    }


def _build_before_after_chart(dataframe: pd.DataFrame, before_column: str, after_column: str) -> dict[str, Any] | None:
    before_series = pd.to_numeric(dataframe[before_column], errors="coerce")
    after_series = pd.to_numeric(dataframe[after_column], errors="coerce")
    before_value = before_series.dropna()
    after_value = after_series.dropna()

    if before_value.empty and after_value.empty:
        return None

    return {
        "chart_type": "comparison",
        "title": "مقارنة قبل / بعد",
        "subtitle": f"من {before_column} إلى {after_column}",
        "series": [
            {"label": "Before", "value": round(float(before_value.mean()), 2) if not before_value.empty else 0.0},
            {"label": "After", "value": round(float(after_value.mean()), 2) if not after_value.empty else 0.0},
        ],
    }


def build_dashboard_payload(
    *,
    dataframe: pd.DataFrame,
    meta: dict[str, Any],
    profiles: list[dict[str, Any]],
    schema_candidates: list[dict[str, Any]],
    validation: dict[str, Any],
    preview_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    charts: list[dict[str, Any]] = []
    cards = _quality_cards(meta, validation)

    top_category = _pick_top_candidate(schema_candidates, "category")
    top_status = _pick_top_candidate(schema_candidates, "status")
    top_date = _pick_top_candidate(schema_candidates, "date")
    before_column, after_column = _find_before_after_columns(dataframe, profiles)

    if top_category:
        chart = _build_category_bar_chart(dataframe, top_category["column_name"])
        if chart:
            charts.append(chart)

    if top_date:
        chart = _build_date_trend_chart(dataframe, top_date["column_name"])
        if chart:
            charts.append(chart)

    if top_status:
        chart = _build_status_distribution_chart(dataframe, top_status["column_name"])
        if chart:
            charts.append(chart)

    if before_column and after_column and before_column != after_column:
        chart = _build_before_after_chart(dataframe, before_column, after_column)
        if chart:
            charts.append(chart)

    if not charts:
        return {
            "cards": cards,
            "charts": [],
            "summary": {
                "status": "quality_only",
                "message": "لم يتم اكتشاف بنية كافية لبناء رسوم ديناميكية، لذلك تم الاكتفاء ببطاقات الجودة والتنبيهات.",
                "warnings": validation.get("warnings", []),
                "preview_rows": preview_rows,
            },
        }

    return {
        "cards": cards,
        "charts": charts,
        "summary": {
            "status": "dynamic",
            "message": "تم بناء dashboard ديناميكية بحسب schema المكتشفة.",
            "warnings": validation.get("warnings", []),
            "preview_rows": preview_rows,
        },
    }

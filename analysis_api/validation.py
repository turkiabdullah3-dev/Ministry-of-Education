from __future__ import annotations

from collections import defaultdict
from typing import Any

import pandas as pd


CRITICAL_ROLES = ("date", "metric", "category")


def _estimate_duplicate_rows(dataframe: pd.DataFrame) -> tuple[int, float]:
    if dataframe.empty:
        return 0, 0.0

    subset_columns = list(dataframe.columns[: min(len(dataframe.columns), 8)])
    working = dataframe[subset_columns].copy()
    for column in subset_columns:
        working[column] = working[column].fillna("").astype(str).str.strip()

    duplicate_count = int(working.duplicated().sum())
    duplicate_ratio = duplicate_count / max(len(working.index), 1)
    return duplicate_count, duplicate_ratio


def _find_high_null_columns(profiles: list[dict[str, Any]], threshold: float = 0.45) -> list[str]:
    return [
        profile["name"]
        for profile in profiles
        if float(profile.get("null_ratio", 0.0)) >= threshold
    ]


def _find_mixed_type_columns(profiles: list[dict[str, Any]]) -> list[str]:
    mixed = []
    for profile in profiles:
        numeric_ratio = float(profile.get("numeric_ratio", 0.0))
        datetime_ratio = float(profile.get("datetime_ratio", 0.0))
        if 0.2 <= numeric_ratio <= 0.8 and datetime_ratio < 0.2:
            mixed.append(profile["name"])
    return mixed


def _find_type_conflicts(profiles: list[dict[str, Any]]) -> list[str]:
    conflicts = []
    for profile in profiles:
        expected_type = profile.get("expected_data_type")
        flags = [
            bool(profile.get("looks_like_date")),
            bool(profile.get("looks_like_metric")),
            bool(profile.get("looks_like_identifier")),
            bool(profile.get("looks_like_category")),
        ]
        if sum(flags) >= 2 and expected_type not in {"text", None}:
            conflicts.append(profile["name"])
    return conflicts


def _group_schema_candidates(schema_candidates: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in schema_candidates:
        grouped[str(candidate["role"])].append(candidate)
    return grouped


def build_validation_report(
    dataframe: pd.DataFrame,
    profiles: list[dict[str, Any]],
    schema_candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    warnings: list[str] = []
    errors: list[str] = []

    row_count = int(len(dataframe.index))
    grouped_candidates = _group_schema_candidates(schema_candidates)
    duplicate_count, duplicate_ratio = _estimate_duplicate_rows(dataframe)
    high_null_columns = _find_high_null_columns(profiles)
    mixed_type_columns = _find_mixed_type_columns(profiles)
    type_conflict_columns = _find_type_conflicts(profiles)

    for role in CRITICAL_ROLES:
        if not grouped_candidates.get(role):
            warnings.append(f"لم يتم العثور على مرشح موثوق لحقل {role}.")

    weak_roles = []
    for role, candidates in grouped_candidates.items():
        top_confidence = float(candidates[0]["confidence"]) if candidates else 0.0
        if top_confidence < 0.55:
            weak_roles.append(role)

    if weak_roles:
        warnings.append(f"ثقة الربط الدلالي ضعيفة في الأدوار التالية: {', '.join(sorted(weak_roles))}.")

    if high_null_columns:
        warnings.append(
            "توجد أعمدة ذات فراغات مرتفعة: " + ", ".join(high_null_columns[:5]) + "."
        )

    if duplicate_count:
        warnings.append(
            f"تم رصد {duplicate_count} صفوف مكررة تقريبًا ({duplicate_ratio * 100:.1f}%)."
        )

    if mixed_type_columns:
        warnings.append(
            "توجد أعمدة فيها خلط بين النص والرقم: " + ", ".join(mixed_type_columns[:5]) + "."
        )

    if type_conflict_columns:
        warnings.append(
            "بعض الأعمدة تحمل إشارات نوع متضاربة: " + ", ".join(type_conflict_columns[:5]) + "."
        )

    if row_count == 0:
        errors.append("الملف لا يحتوي على صفوف قابلة للمعالجة.")

    if len(dataframe.columns) == 0:
        errors.append("الملف لا يحتوي على أعمدة قابلة للقراءة.")

    if all(not grouped_candidates.get(role) for role in CRITICAL_ROLES):
        errors.append("لم يتم العثور على أعمدة أساسية كافية لبناء تحليل موثوق.")

    schema_confidence = (
        sum(float(candidate["confidence"]) for candidate in schema_candidates[:8]) / max(min(len(schema_candidates), 8), 1)
        if schema_candidates
        else 0.0
    )
    null_penalty = min(len(high_null_columns) * 6.5, 24.0)
    duplicate_penalty = min(duplicate_ratio * 100 * 0.6, 16.0)
    mixed_penalty = min(len(mixed_type_columns) * 7.0, 22.0)
    conflict_penalty = min(len(type_conflict_columns) * 5.5, 16.0)
    missing_penalty = sum(8.0 for role in CRITICAL_ROLES if not grouped_candidates.get(role))
    confidence_bonus = schema_confidence * 28.0

    quality_score = max(
        0.0,
        min(
            100.0,
            100.0
            - null_penalty
            - duplicate_penalty
            - mixed_penalty
            - conflict_penalty
            - missing_penalty
            + confidence_bonus
            - (10.0 if errors else 0.0),
        ),
    )

    confidence = max(
        0.0,
        min(
            1.0,
            (quality_score / 100.0) * 0.62 + schema_confidence * 0.38,
        ),
    )

    ready = not errors and confidence >= 0.45

    return {
        "ready": ready,
        "quality_score": round(quality_score, 2),
        "confidence": round(confidence, 4),
        "warnings": warnings,
        "errors": errors,
        "checks": {
            "missing_roles": [role for role in CRITICAL_ROLES if not grouped_candidates.get(role)],
            "weak_roles": sorted(weak_roles),
            "high_null_columns": high_null_columns[:10],
            "duplicate_rows": duplicate_count,
            "duplicate_ratio": round(duplicate_ratio, 4),
            "mixed_type_columns": mixed_type_columns[:10],
            "type_conflict_columns": type_conflict_columns[:10],
        },
    }

from __future__ import annotations

from collections import defaultdict


ROLE_ALIASES = {
    "identifier": ("id", "code", "key", "uuid", "sku", "serial", "رقم", "رمز", "كود", "معرف"),
    "category": ("category", "department", "group", "segment", "class", "type", "تصنيف", "إدارة", "قسم", "فئة", "نوع"),
    "metric": ("value", "amount", "total", "sales", "revenue", "cost", "price", "ratio", "score", "قيمة", "مبلغ", "إجمالي", "المبيعات", "تكلفة", "نسبة"),
    "status": ("status", "state", "stage", "phase", "approval", "closure", "حالة", "وضع", "مرحلة", "اعتماد", "إغلاق"),
    "date": ("date", "time", "period", "month", "day", "created", "updated", "تاريخ", "وقت", "فترة", "شهر", "يوم"),
    "plan": ("plan", "target", "goal", "budget", "forecast", "quota", "خطة", "مستهدف", "هدف", "ميزانية", "تقدير"),
    "entity": ("name", "client", "customer", "employee", "user", "trainee", "vendor", "account", "اسم", "عميل", "مستخدم", "موظف", "متدرب", "جهة"),
    "text": ("description", "details", "comment", "message", "content", "notes", "summary", "وصف", "تفاصيل", "تعليق", "ملاحظات", "بيان", "ملخص"),
}

STATUS_VALUE_HINTS = {
    "open",
    "closed",
    "active",
    "inactive",
    "pending",
    "approved",
    "rejected",
    "completed",
    "cancelled",
    "onhold",
    "مفتوح",
    "مغلق",
    "نشط",
    "غيرنشط",
    "معلق",
    "معتمد",
    "مرفوض",
    "مكتمل",
    "ملغي",
    "قيدالتنفيذ",
}


def _normalize_token(value: str) -> str:
    return "".join(str(value or "").strip().lower().split())


def _alias_score(name: str, aliases: tuple[str, ...]) -> tuple[float, list[str]]:
    normalized_name = _normalize_token(name)
    reasons: list[str] = []

    for alias in aliases:
        normalized_alias = _normalize_token(alias)
        if normalized_name == normalized_alias:
            reasons.append(f"name_exact:{alias}")
            return 1.0, reasons

    for alias in aliases:
        normalized_alias = _normalize_token(alias)
        if normalized_alias and normalized_alias in normalized_name:
            reasons.append(f"name_partial:{alias}")
            return 0.72, reasons

    return 0.0, reasons


def _example_signal(examples: list[str], role: str) -> tuple[float, list[str]]:
    reasons: list[str] = []
    normalized_examples = [_normalize_token(example) for example in examples if str(example).strip()]
    if not normalized_examples:
        return 0.0, reasons

    if role == "status":
        hit_count = sum(1 for example in normalized_examples if example in STATUS_VALUE_HINTS)
        if hit_count:
            reasons.append("example_status_values")
            return min(1.0, 0.45 + (hit_count / max(len(normalized_examples), 1)) * 0.4), reasons

    if role == "identifier":
        compact_count = sum(1 for example in normalized_examples if example.isalnum() and 4 <= len(example) <= 24)
        if compact_count:
            reasons.append("example_identifier_tokens")
            return min(1.0, 0.35 + (compact_count / max(len(normalized_examples), 1)) * 0.45), reasons

    if role == "entity":
        name_like_count = sum(1 for example in examples if len(str(example).split()) >= 2)
        if name_like_count:
            reasons.append("example_entity_names")
            return min(1.0, 0.3 + (name_like_count / max(len(examples), 1)) * 0.4), reasons

    if role == "text":
        long_text_count = sum(1 for example in examples if len(str(example)) >= 24)
        if long_text_count:
            reasons.append("example_long_text")
            return min(1.0, 0.4 + (long_text_count / max(len(examples), 1)) * 0.4), reasons

    return 0.0, reasons


def _type_signal(profile: dict, role: str) -> tuple[float, list[str]]:
    reasons: list[str] = []
    expected_type = profile.get("expected_data_type")
    unique_count = int(profile.get("unique_count", 0))
    null_ratio = float(profile.get("null_ratio", 0.0))
    non_null_ratio = 1.0 - null_ratio

    if role == "date":
        score = 0.7 if profile.get("looks_like_date") else 0.0
        if expected_type == "date":
            score = max(score, 0.82)
            reasons.append("type=date")
        return score * non_null_ratio, reasons

    if role == "metric":
        score = 0.68 if profile.get("looks_like_metric") else 0.0
        if expected_type == "numeric":
            score = max(score, 0.8)
            reasons.append("type=numeric")
        return score * non_null_ratio, reasons

    if role == "plan":
        score = 0.62 if profile.get("looks_like_metric") else 0.0
        if expected_type == "numeric":
            score = max(score, 0.74)
            reasons.append("type=numeric_for_plan")
        return score * non_null_ratio, reasons

    if role == "identifier":
        score = 0.72 if profile.get("looks_like_identifier") else 0.0
        if expected_type == "identifier":
            score = max(score, 0.84)
            reasons.append("type=identifier")
        return score * non_null_ratio, reasons

    if role == "category":
        score = 0.7 if profile.get("looks_like_category") else 0.0
        if expected_type == "category":
            score = max(score, 0.82)
            reasons.append("type=category")
        if 2 <= unique_count <= 40:
            score = max(score, 0.66)
            reasons.append("cardinality=category_fit")
        return score * non_null_ratio, reasons

    if role == "status":
        score = 0.0
        if expected_type == "category" and 2 <= unique_count <= 12:
            score = 0.72
            reasons.append("cardinality=status_fit")
        return score * non_null_ratio, reasons

    if role == "entity":
        score = 0.0
        if expected_type in {"identifier", "text"} and unique_count >= 3:
            score = 0.58
            reasons.append("type=entity_fit")
        return score * non_null_ratio, reasons

    if role == "text":
        score = 0.0
        if expected_type == "text":
            score = 0.72
            reasons.append("type=text")
        return score * non_null_ratio, reasons

    return 0.0, reasons


def _uniqueness_signal(profile: dict, role: str, row_count: int) -> tuple[float, list[str]]:
    reasons: list[str] = []
    unique_count = int(profile.get("unique_count", 0))
    null_ratio = float(profile.get("null_ratio", 0.0))
    non_null_count = max(int(round(row_count * (1.0 - null_ratio))), 1)
    unique_ratio = unique_count / non_null_count

    if role in {"identifier", "entity"} and unique_ratio >= 0.65:
        reasons.append("uniqueness=high")
        return 0.78 if role == "identifier" else 0.62, reasons

    if role in {"category", "status"} and 2 <= unique_count <= 20:
        reasons.append("uniqueness=grouped")
        return 0.68 if role == "category" else 0.72, reasons

    if role == "text" and unique_ratio >= 0.35:
        reasons.append("uniqueness=textual")
        return 0.55, reasons

    if role in {"metric", "plan"} and unique_ratio >= 0.2:
        reasons.append("uniqueness=numeric_variation")
        return 0.36, reasons

    if role == "date" and unique_ratio >= 0.08:
        reasons.append("uniqueness=temporal_variation")
        return 0.34, reasons

    return 0.0, reasons


def _score_role(profile: dict, role: str, row_count: int) -> dict | None:
    alias_score, alias_reasons = _alias_score(profile.get("name", ""), ROLE_ALIASES[role])
    type_score, type_reasons = _type_signal(profile, role)
    example_score, example_reasons = _example_signal(profile.get("examples", []), role)
    uniqueness_score, uniqueness_reasons = _uniqueness_signal(profile, role, row_count)

    weighted_score = (
        alias_score * 0.34
        + type_score * 0.30
        + example_score * 0.18
        + uniqueness_score * 0.18
    )

    confidence = round(min(weighted_score, 1.0), 4)
    if confidence < 0.28:
        return None

    return {
        "role": role,
        "column_name": profile["name"],
        "confidence": confidence,
        "reasons": alias_reasons + type_reasons + example_reasons + uniqueness_reasons,
    }


def build_schema_candidates(profiles: list[dict], row_count: int) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)

    for profile in profiles:
        for role in ROLE_ALIASES:
            candidate = _score_role(profile, role, row_count=row_count)
            if candidate is not None:
                grouped[role].append(candidate)

    flattened: list[dict] = []
    for role, candidates in grouped.items():
        candidates.sort(key=lambda item: (item["confidence"], item["column_name"]), reverse=True)
        flattened.extend(candidates[:3])

    flattened.sort(key=lambda item: (item["confidence"], item["role"], item["column_name"]), reverse=True)
    return flattened

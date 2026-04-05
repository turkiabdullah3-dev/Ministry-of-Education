from __future__ import annotations

from collections import defaultdict
from typing import Any


LOW_CONFIDENCE_THRESHOLD = 0.55

ROLE_LABELS = {
    "identifier": "المعرف",
    "category": "التصنيف",
    "metric": "المقياس",
    "status": "الحالة",
    "date": "التاريخ",
    "plan": "الخطة",
    "entity": "الجهة",
    "text": "النص",
}


def _group_schema_candidates(schema_candidates: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in schema_candidates:
        grouped[str(candidate.get("role", ""))].append(candidate)
    return grouped


def _pick_top_candidate(schema_candidates: list[dict[str, Any]], role: str) -> dict[str, Any] | None:
    matches = [candidate for candidate in schema_candidates if candidate.get("role") == role]
    if not matches:
        return None
    return max(matches, key=lambda item: float(item.get("confidence", 0.0)))


def _build_headline(validation: dict[str, Any], dashboard: dict[str, Any]) -> str:
    confidence = float(validation.get("confidence", 0.0))
    if validation.get("errors"):
        return "التحليل يحتاج مراجعة قبل الاعتماد"
    if confidence < LOW_CONFIDENCE_THRESHOLD:
        return "التحليل متاح لكن بثقة منخفضة"
    if dashboard.get("summary", {}).get("status") == "quality_only":
        return "تم تحليل جودة الملف أولًا"
    return "تم تجهيز قراءة أولية قابلة للاستخدام"


def _build_summary(
    meta: dict[str, Any],
    validation: dict[str, Any],
    dashboard: dict[str, Any],
    schema_candidates: list[dict[str, Any]],
) -> str:
    row_count = meta.get("row_count_raw") or meta.get("row_count") or 0
    column_count = len(meta.get("column_names_raw") or [])
    confidence = float(validation.get("confidence", 0.0))
    quality_score = float(validation.get("quality_score", 0.0))
    charts = dashboard.get("charts", [])
    mapped_roles = {
        candidate.get("role")
        for candidate in schema_candidates
        if float(candidate.get("confidence", 0.0)) >= LOW_CONFIDENCE_THRESHOLD
    }

    base = (
        f"تمت قراءة {row_count} صفوف و{column_count} أعمدة."
        f" درجة الجودة الحالية {quality_score:.0f}/100"
        f" ومستوى الثقة {confidence * 100:.0f}%."
    )

    if validation.get("errors"):
        return base + " توجد أخطاء تمنع اعتماد التحليل بشكل كامل."

    if dashboard.get("summary", {}).get("status") == "quality_only":
        return base + " البنية المكتشفة لا تكفي بعد لبناء رسوم تحليلية موثوقة، لذلك تم التركيز على جودة الملف والتنبيهات."

    return (
        base
        + f" تم التعرف على {len(mapped_roles)} أدوار دلالية موثوقة وبناء {len(charts)} رسوم ديناميكية من الملف نفسه."
    )


def _schema_finding(schema_candidates: list[dict[str, Any]]) -> str | None:
    grouped = _group_schema_candidates(schema_candidates)
    prioritized_roles = ("date", "category", "metric", "status", "entity", "text")
    findings: list[str] = []

    for role in prioritized_roles:
        candidates = grouped.get(role, [])
        if not candidates:
            continue
        top_candidate = max(candidates, key=lambda item: float(item.get("confidence", 0.0)))
        confidence = float(top_candidate.get("confidence", 0.0))
        if confidence < LOW_CONFIDENCE_THRESHOLD:
            continue
        role_label = ROLE_LABELS.get(role, role)
        findings.append(
            f"تم ربط {role_label} بالعمود {top_candidate['column_name']} بثقة {confidence * 100:.0f}%."
        )
        if len(findings) == 2:
            break

    if not findings:
        return None

    return " ".join(findings)


def _dashboard_finding(dashboard: dict[str, Any]) -> str | None:
    charts = dashboard.get("charts", [])
    if not charts:
        return None

    top_chart = charts[0]
    title = str(top_chart.get("title", "")).strip()
    points = len(top_chart.get("series", []))
    if not title:
        return None

    if points:
        return f"أبرز مخرج بصري حاليًا هو {title} ويعرض {points} نقاط قراءة محسوبة من الملف."
    return f"أبرز مخرج بصري حاليًا هو {title}."


def _quality_finding(validation: dict[str, Any]) -> str:
    quality_score = float(validation.get("quality_score", 0.0))
    confidence = float(validation.get("confidence", 0.0))
    return f"درجة الجودة {quality_score:.0f}/100 والثقة العامة {confidence * 100:.0f}%."


def _warning_finding(validation: dict[str, Any]) -> str | None:
    warnings = validation.get("warnings", [])
    errors = validation.get("errors", [])
    if errors:
        return str(errors[0])
    if warnings:
        return str(warnings[0])
    return None


def _build_key_findings(
    validation: dict[str, Any],
    schema_candidates: list[dict[str, Any]],
    dashboard: dict[str, Any],
) -> list[str]:
    findings: list[str] = [_quality_finding(validation)]

    schema_finding = _schema_finding(schema_candidates)
    if schema_finding:
        findings.append(schema_finding)

    dashboard_finding = _dashboard_finding(dashboard)
    if dashboard_finding:
        findings.append(dashboard_finding)

    warning_finding = _warning_finding(validation)
    if warning_finding and warning_finding not in findings:
        findings.append(warning_finding)

    unique_findings: list[str] = []
    for finding in findings:
        if finding and finding not in unique_findings:
            unique_findings.append(finding)
        if len(unique_findings) == 3:
            break

    return unique_findings


def _build_confidence_notice(validation: dict[str, Any], schema_candidates: list[dict[str, Any]]) -> str | None:
    confidence = float(validation.get("confidence", 0.0))
    weak_roles = sorted(
        {
            str(candidate.get("role"))
            for candidate in schema_candidates
            if float(candidate.get("confidence", 0.0)) < LOW_CONFIDENCE_THRESHOLD
        }
    )

    if confidence >= LOW_CONFIDENCE_THRESHOLD and not validation.get("errors"):
        return None

    if validation.get("errors"):
        return "الثقة الحالية منخفضة أو غير مكتملة، لذلك لا ينبغي اعتماد النتائج قبل مراجعة التحذيرات والأخطاء."

    if weak_roles:
        role_labels = ", ".join(ROLE_LABELS.get(role, role) for role in weak_roles[:4])
        return f"الثقة الحالية منخفضة، وبعض الأدوار الدلالية غير مستقرة بعد مثل: {role_labels}."

    return "الثقة الحالية منخفضة، لذلك ينبغي التعامل مع النتائج كقراءة أولية لا كاعتماد نهائي."


def _build_next_steps(validation: dict[str, Any], dashboard: dict[str, Any]) -> list[str]:
    next_steps: list[str] = []

    if validation.get("errors"):
        next_steps.append("معالجة الأخطاء الأساسية في الملف قبل الاعتماد على أي قراءة تحليلية.")

    if validation.get("warnings"):
        next_steps.append("مراجعة التحذيرات المؤثرة على الجودة وخصوصًا الأعمدة الناقصة أو المختلطة.")

    if dashboard.get("summary", {}).get("status") == "quality_only":
        next_steps.append("توفير أعمدة أوضح للتاريخ أو التصنيف أو المقياس لتمكين رسوم أدق.")

    if not next_steps:
        next_steps.append("يمكن الانتقال للمرحلة التالية من بناء المؤشرات التفصيلية على نفس البنية الحالية.")

    return next_steps[:3]


def build_assistant_insight(
    *,
    meta: dict[str, Any],
    validation: dict[str, Any],
    schema_candidates: list[dict[str, Any]],
    dashboard: dict[str, Any],
) -> dict[str, Any]:
    return {
        "headline": _build_headline(validation, dashboard),
        "summary": _build_summary(meta, validation, dashboard, schema_candidates),
        "key_findings": _build_key_findings(validation, schema_candidates, dashboard),
        "confidence_notice": _build_confidence_notice(validation, schema_candidates),
        "next_steps": _build_next_steps(validation, dashboard),
    }

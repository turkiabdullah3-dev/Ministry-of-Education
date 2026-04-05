from __future__ import annotations

from backend import analyze_indicators as legacy


ROLE_CONFIG = {
    "date": (legacy.DATE_ALIASES, "date", 3),
    "value": (legacy.VALUE_ALIASES, "numeric", 3),
    "target": (legacy.TARGET_ALIASES, "target", 2),
    "category": (legacy.CATEGORY_ALIASES, "category", 3),
    "entity": (legacy.ENTITY_ALIASES, "entity", 3),
}


def select_schema(profiles: list[dict]) -> dict:
    return legacy.select_schema(profiles)


def build_schema_candidates(profiles: list[dict]) -> dict[str, list[str]]:
    return legacy.build_schema_candidates(profiles)


def build_schema_candidate_details(profiles: list[dict]) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}

    for role, (aliases, mode, limit) in ROLE_CONFIG.items():
        result[role] = [
            {
                "role": role,
                "columnName": candidate["name"],
                "confidence": candidate.get("selectionConfidence"),
                "aliasStrength": candidate.get("selectionAliasStrength"),
                "uniqueRatio": candidate.get("selectionUniqueRatio"),
            }
            for candidate in legacy.rank_candidates(profiles, aliases, mode, limit=limit)
        ]

    return result


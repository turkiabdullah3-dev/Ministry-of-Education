from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MetaInfo(BaseModel):
    filename: str
    sheetName: str | None = None
    rowCount: int = 0
    columnCount: int = 0
    headerRow: int = 1
    sheetScore: float | None = None
    selectionScore: float | None = None


class ColumnProfile(BaseModel):
    name: str
    normalized: str
    nonNull: int = 0
    uniqueCount: int = 0
    numericRatio: float = 0.0
    datetimeRatio: float = 0.0
    completenessRatio: float = 0.0
    textRatio: float = 0.0
    mixedTypeScore: float = 0.0
    avgTextLength: float = 0.0


class SchemaCandidate(BaseModel):
    role: str
    columnName: str
    confidence: float | None = None
    aliasStrength: float | None = None
    uniqueRatio: float | None = None


class ValidationReport(BaseModel):
    qualityScore: float = 0.0
    completenessRate: float = 0.0
    ready: bool = False
    needsReview: bool = True
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    detectedColumns: list[str] = Field(default_factory=list)
    columnConfidence: dict[str, float] = Field(default_factory=dict)
    schemaCandidates: dict[str, list[str]] = Field(default_factory=dict)
    schemaCandidateDetails: dict[str, list[SchemaCandidate]] = Field(default_factory=dict)
    preflight: dict[str, Any] = Field(default_factory=dict)
    profiles: list[ColumnProfile] = Field(default_factory=list)


class DashboardCard(BaseModel):
    title: str
    actual: float | int | str | None = None
    actualDisplay: str
    referenceLabel: str
    referenceValue: str
    progress: float | None = None
    progressDisplay: str
    tone: str
    description: str
    priority: float | int = 0


class ChartSpec(BaseModel):
    title: str
    subtitle: str | None = None
    points: list[dict[str, Any]] = Field(default_factory=list)
    items: list[dict[str, Any]] = Field(default_factory=list)
    total: float | int | None = None
    primaryLabel: str | None = None
    secondaryLabel: str | None = None
    display: str | None = None
    value: float | int | None = None
    tone: str | None = None


class AssistantInsight(BaseModel):
    headline: str
    summary: str
    findings: list[dict[str, Any]] = Field(default_factory=list)
    actions: list[str] | list[dict[str, Any]] = Field(default_factory=list)
    focus: list[dict[str, Any]] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    meta: MetaInfo
    schema: dict[str, str | None]
    validation: ValidationReport
    dashboard: dict[str, Any]
    assistant: AssistantInsight | None = None
    powerBi: dict[str, Any] | None = None


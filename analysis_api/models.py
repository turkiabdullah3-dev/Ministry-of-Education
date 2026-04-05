from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MetaInfo(BaseModel):
    filename: str
    content_type: str | None = None
    size_bytes: int
    file_type: str | None = None
    sheet_names: list[str] = Field(default_factory=list)
    selected_sheet: str | None = None
    selected_header_row: int | None = None
    reason_for_selection: str | None = None
    all_sheets_scores: list[dict[str, Any]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    row_count: int | None = None
    column_count: int | None = None
    row_count_raw: int | None = None
    column_names_raw: list[str] = Field(default_factory=list)
    source: str = "upload"


class ColumnProfile(BaseModel):
    name: str
    expected_data_type: str
    null_ratio: float
    unique_count: int
    examples: list[str] = Field(default_factory=list)
    looks_like_date: bool
    looks_like_metric: bool
    looks_like_identifier: bool
    looks_like_category: bool
    confidence: float


class SchemaCandidate(BaseModel):
    role: str
    column_name: str
    confidence: float
    reasons: list[str] = Field(default_factory=list)


class ValidationReport(BaseModel):
    ready: bool
    quality_score: float
    confidence: float
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class DashboardCard(BaseModel):
    title: str
    value: str
    subtitle: str
    tone: str
    confidence: float


class ChartSpec(BaseModel):
    chart_type: str
    title: str
    subtitle: str
    series: list[dict[str, Any]] = Field(default_factory=list)


class AssistantInsight(BaseModel):
    headline: str
    summary: str
    key_findings: list[str] = Field(default_factory=list)
    confidence_notice: str | None = None
    next_steps: list[str] = Field(default_factory=list)


class AnalyzeResponse(BaseModel):
    meta: MetaInfo
    profile: list[ColumnProfile] = Field(default_factory=list)
    schema_candidates: list[SchemaCandidate] = Field(default_factory=list)
    validation: ValidationReport
    dashboard: dict[str, list[DashboardCard] | list[ChartSpec] | dict[str, Any]]
    assistant: AssistantInsight

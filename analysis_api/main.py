from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from analysis_api.assistant import build_assistant_insight
from analysis_api.dashboard_builder import build_dashboard_payload
from analysis_api.ingestion import IngestionResult, ingest_uploaded_file
from analysis_api.models import (
    AnalyzeResponse,
    AssistantInsight,
    ColumnProfile,
    MetaInfo,
    SchemaCandidate,
    ValidationReport,
)
from analysis_api.profiling import profile_columns
from analysis_api.schema_mapping import build_schema_candidates
from analysis_api.validation import build_validation_report


app = FastAPI(title="analysis_api", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)


def _normalize_filename(filename: str) -> str:
    name = Path(filename or "").name.strip()
    if not name:
        raise ValueError("اسم الملف غير صالح.")
    return name


def _build_stub_response(
    filename: str,
    content_type: str | None,
    size_bytes: int,
    ingestion: IngestionResult,
) -> AnalyzeResponse:
    profiled_columns = profile_columns(ingestion.dataframe)
    ranked_schema_candidates = build_schema_candidates(
        profiled_columns,
        row_count=ingestion.row_count_raw,
    )
    validation_report = build_validation_report(
        dataframe=ingestion.dataframe,
        profiles=profiled_columns,
        schema_candidates=ranked_schema_candidates,
    )

    meta = MetaInfo(
        filename=filename,
        content_type=content_type,
        size_bytes=size_bytes,
        file_type=ingestion.file_type,
        sheet_names=ingestion.sheet_names,
        selected_sheet=ingestion.selected_sheet,
        selected_header_row=ingestion.selected_header_row,
        reason_for_selection=ingestion.reason_for_selection,
        all_sheets_scores=ingestion.all_sheets_scores,
        warnings=ingestion.warnings,
        row_count=ingestion.row_count_raw,
        column_count=len(ingestion.column_names_raw),
        row_count_raw=ingestion.row_count_raw,
        column_names_raw=ingestion.column_names_raw,
    )

    profile: list[ColumnProfile] = []

    for item in profiled_columns:
        profile.append(
            ColumnProfile(
                name=item["name"],
                expected_data_type=item["expected_data_type"],
                null_ratio=item["null_ratio"],
                unique_count=item["unique_count"],
                examples=item["examples"],
                looks_like_date=item["looks_like_date"],
                looks_like_metric=item["looks_like_metric"],
                looks_like_identifier=item["looks_like_identifier"],
                looks_like_category=item["looks_like_category"],
                confidence=item["confidence"],
            )
        )

    schema_candidates = [
        SchemaCandidate(
            role=item["role"],
            column_name=item["column_name"],
            confidence=item["confidence"],
            reasons=item["reasons"],
        )
        for item in ranked_schema_candidates
    ]

    validation = ValidationReport(
        ready=validation_report["ready"],
        quality_score=validation_report["quality_score"],
        confidence=validation_report["confidence"],
        warnings=[*ingestion.warnings, *validation_report["warnings"]],
        errors=validation_report["errors"],
    )

    dashboard = build_dashboard_payload(
        dataframe=ingestion.dataframe,
        meta={
            "row_count_raw": ingestion.row_count_raw,
            "column_names_raw": ingestion.column_names_raw,
            "file_type": ingestion.file_type,
        },
        profiles=profiled_columns,
        schema_candidates=ranked_schema_candidates,
        validation=validation_report,
        preview_rows=ingestion.preview_rows,
    )

    assistant = AssistantInsight(
        **build_assistant_insight(
            meta={
                "row_count": ingestion.row_count_raw,
                "row_count_raw": ingestion.row_count_raw,
                "column_names_raw": ingestion.column_names_raw,
            },
            validation=validation_report,
            schema_candidates=ranked_schema_candidates,
            dashboard=dashboard,
        )
    )

    return AnalyzeResponse(
        meta=meta,
        profile=profile,
        schema_candidates=schema_candidates,
        validation=validation,
        dashboard=dashboard,
        assistant=assistant,
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)) -> AnalyzeResponse:
    try:
        filename = _normalize_filename(file.filename or "")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    payload = await file.read()
    try:
        ingestion = ingest_uploaded_file(filename=filename, payload=payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return _build_stub_response(
        filename=filename,
        content_type=file.content_type,
        size_bytes=len(payload),
        ingestion=ingestion,
    )

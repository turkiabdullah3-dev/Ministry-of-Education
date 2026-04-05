from __future__ import annotations

import tempfile
from pathlib import Path

from backend import analyze_indicators as legacy
from backend.analysis_api import assistant, dashboard_builder, ingestion, profiling, schema_mapping, validation
from backend.analysis_api.models import AnalyzeResponse


def _write_temp_file(filename: str, payload: bytes) -> Path:
    suffix = Path(filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        handle.write(payload)
        return Path(handle.name)


def analyze_uploaded_file(filename: str, payload: bytes) -> dict:
    temp_path = _write_temp_file(filename, payload)

    try:
        dataframe, sheet_name, preparation_meta = ingestion.load_tabular_data(temp_path)
        profiles = profiling.profile_columns(dataframe)
        schema_candidates = schema_mapping.build_schema_candidates(profiles)
        schema_candidate_details = schema_mapping.build_schema_candidate_details(profiles)
        preflight = validation.build_preflight_report(dataframe, profiles)

        response = dashboard_builder.build_dashboard_payload(
            dataframe=dataframe,
            filename=filename,
            sheet_name=sheet_name,
            preparation_meta=preparation_meta,
        )

        response["validation"]["schemaCandidates"] = schema_candidates
        response["validation"]["schemaCandidateDetails"] = schema_candidate_details
        response["validation"]["preflight"] = preflight
        response["validation"]["profiles"] = profiling.serialize_profiles(profiles)

        response["assistant"] = assistant.build_assistant_summary(
            response["meta"],
            response["schema"],
            response["validation"],
            response["dashboard"],
        )
        response["powerBi"] = legacy.build_powerbi_package(
            response["meta"],
            response["schema"],
            response["validation"],
            response["dashboard"],
        )

        return AnalyzeResponse.model_validate(response).model_dump(mode="json")
    finally:
        temp_path.unlink(missing_ok=True)

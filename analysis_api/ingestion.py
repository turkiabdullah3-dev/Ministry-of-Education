from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd


ALLOWED_EXTENSIONS = {".csv", ".xlsx", ".xls"}
MAX_UPLOAD_BYTES = 12 * 1024 * 1024


@dataclass(slots=True)
class IngestionResult:
    file_type: str
    sheet_names: list[str]
    selected_sheet: str | None
    selected_header_row: int | None
    reason_for_selection: str | None
    all_sheets_scores: list[dict[str, Any]]
    warnings: list[str]
    row_count_raw: int
    column_names_raw: list[str]
    preview_rows: list[dict[str, Any]]
    dataframe: pd.DataFrame


def _normalize_filename(filename: str) -> str:
    normalized = Path(filename or "").name.strip()
    if not normalized:
        raise ValueError("اسم الملف غير صالح.")
    return normalized


def _normalize_extension(filename: str) -> str:
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise ValueError("نوع الملف غير مدعوم. ارفع csv أو xlsx أو xls.")
    return extension


def _serialize_preview(dataframe: pd.DataFrame, limit: int = 20) -> list[dict[str, Any]]:
    preview = dataframe.head(limit).copy()
    preview.columns = [str(column) for column in preview.columns]
    preview = preview.where(pd.notna(preview), None)
    return preview.to_dict(orient="records")


def _finalize_result(
    file_type: str,
    dataframe: pd.DataFrame,
    *,
    sheet_names: list[str] | None = None,
    selected_sheet: str | None = None,
    selected_header_row: int | None = None,
    reason_for_selection: str | None = None,
    all_sheets_scores: list[dict[str, Any]] | None = None,
    warnings: list[str] | None = None,
) -> IngestionResult:
    normalized_frame = dataframe.copy()
    normalized_frame.columns = [str(column) for column in normalized_frame.columns]

    return IngestionResult(
        file_type=file_type,
        sheet_names=sheet_names or [],
        selected_sheet=selected_sheet,
        selected_header_row=selected_header_row,
        reason_for_selection=reason_for_selection,
        all_sheets_scores=all_sheets_scores or [],
        warnings=warnings or [],
        row_count_raw=int(len(normalized_frame.index)),
        column_names_raw=[str(column) for column in normalized_frame.columns],
        preview_rows=_serialize_preview(normalized_frame, limit=20),
        dataframe=normalized_frame,
    )


def _write_temp_file(filename: str, payload: bytes) -> Path:
    suffix = Path(filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
        handle.write(payload)
        return Path(handle.name)


def _read_csv_with_duckdb(file_path: Path) -> pd.DataFrame | None:
    try:
        import duckdb  # type: ignore
    except ImportError:
        return None

    try:
        connection = duckdb.connect(database=":memory:")
        try:
            return connection.execute(
                "SELECT * FROM read_csv_auto(?, header = true, sample_size = -1)",
                [str(file_path)],
            ).fetchdf()
        finally:
            connection.close()
    except Exception:
        return None


def _read_xlsx_with_duckdb(file_path: Path, sheet_name: str | None = None) -> pd.DataFrame | None:
    try:
        import duckdb  # type: ignore
    except ImportError:
        return None

    queries: list[tuple[str, list[Any]]] = []
    if sheet_name:
        queries.append(
            (
                "SELECT * FROM read_xlsx(?, sheet = ?, header = true)",
                [str(file_path), sheet_name],
            )
        )
    queries.append(("SELECT * FROM read_xlsx(?, header = true)", [str(file_path)]))

    for query, params in queries:
        try:
            connection = duckdb.connect(database=":memory:")
            try:
                return connection.execute(query, params).fetchdf()
            finally:
                connection.close()
        except Exception:
            continue

    return None


def _read_csv(file_path: Path) -> IngestionResult:
    dataframe = _read_csv_with_duckdb(file_path)
    if dataframe is None:
        dataframe = pd.read_csv(file_path)
    return _finalize_result(
        "csv",
        dataframe,
        reason_for_selection="ملف CSV لا يحتوي على أوراق متعددة، لذا تم اعتماد المحتوى مباشرة.",
    )


def _normalize_sheet_frame(dataframe: pd.DataFrame) -> pd.DataFrame:
    normalized = dataframe.copy()
    normalized.columns = [str(column) for column in normalized.columns]
    normalized = normalized.dropna(axis=0, how="all").dropna(axis=1, how="all")
    return normalized.reset_index(drop=True)


def _normalize_sheet_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return value


def _normalize_raw_sheet(raw_frame: pd.DataFrame) -> pd.DataFrame:
    normalized = raw_frame.copy()
    normalized = normalized.map(_normalize_sheet_value)
    normalized = normalized.dropna(axis=0, how="all").dropna(axis=1, how="all")
    return normalized.reset_index(drop=True)


def _normalize_sheet_name(sheet_name: str) -> str:
    return "".join(str(sheet_name or "").strip().lower().split())


def _is_instruction_like_name(sheet_name: str) -> bool:
    normalized = _normalize_sheet_name(sheet_name)
    instruction_aliases = (
        "instruction",
        "instructions",
        "guide",
        "guidelines",
        "readme",
        "notes",
        "note",
        "help",
        "intro",
        "overview",
        "تعليمات",
        "ارشادات",
        "إرشادات",
        "ملاحظات",
        "ملاحظة",
        "شرح",
        "دليل",
        "اقرأني",
    )
    return any(alias in normalized for alias in instruction_aliases)


def _build_non_empty_mask(dataframe: pd.DataFrame) -> pd.DataFrame:
    return dataframe.notna() & dataframe.astype(str).apply(lambda column: column.str.strip() != "")


def _sheet_non_empty_stats(dataframe: pd.DataFrame) -> tuple[int, int]:
    if dataframe.empty:
        return 0, 0
    non_empty_mask = _build_non_empty_mask(dataframe)
    populated_cells = int(non_empty_mask.sum().sum())
    total_cells = max(int(dataframe.shape[0] * dataframe.shape[1]), 1)
    return populated_cells, total_cells


def _extract_row_text_cells(dataframe: pd.DataFrame, row_index: int) -> list[str]:
    if row_index >= len(dataframe.index):
        return []

    row = dataframe.iloc[row_index].tolist()
    values: list[str] = []
    for value in row:
        normalized = _normalize_sheet_value(value)
        if normalized is None:
            continue
        values.append(str(normalized))
    return values


def _is_likely_instruction_sheet(dataframe: pd.DataFrame) -> tuple[bool, str]:
    row_count = int(len(dataframe.index))
    column_count = int(len(dataframe.columns))

    if row_count <= 1:
        return True, "تم تجاهلها لأن عدد الصفوف الفعلية صف واحد أو أقل."

    if column_count <= 1:
        return True, "تم تجاهلها لأن عدد الأعمدة الفعلية عمود واحد أو أقل."

    non_empty_mask = _build_non_empty_mask(dataframe)
    tabular_rows = int((non_empty_mask.sum(axis=1) >= 2).sum())
    if tabular_rows <= 1:
        return True, "تم تجاهلها لأن عدد الصفوف الجدولية الفعلية منخفض جدًا."

    flattened = dataframe.where(non_empty_mask).stack().astype(str).str.strip()
    if flattened.empty:
        return True, "تم تجاهلها لأنها لا تحتوي على بيانات فعلية."

    numeric_ratio = pd.to_numeric(flattened, errors="coerce").notna().mean()
    datetime_ratio = pd.to_datetime(flattened, errors="coerce").notna().mean()
    average_text_length = float(flattened.str.len().mean())
    unique_line_ratio = flattened.nunique() / max(len(flattened), 1)

    if numeric_ratio < 0.05 and datetime_ratio < 0.05 and average_text_length >= 18 and unique_line_ratio >= 0.7:
        return True, "تم تجاهلها لأن محتواها يبدو تعليمات أو ملاحظات عامة أكثر من كونه جدول بيانات."

    return False, "تبدو الورقة قابلة للتحليل كجدول بيانات."


def _build_column_names(header_cells: list[Any]) -> list[str]:
    seen: dict[str, int] = {}
    names: list[str] = []

    for index, cell in enumerate(header_cells, start=1):
        base_name = str(_normalize_sheet_value(cell) or f"column_{index}")
        counter = seen.get(base_name, 0) + 1
        seen[base_name] = counter
        names.append(base_name if counter == 1 else f"{base_name}_{counter}")

    return names


def _detect_header_row(raw_frame: pd.DataFrame) -> tuple[int | None, str]:
    if raw_frame.empty:
        return None, "الورقة لا تحتوي على بيانات كافية لاكتشاف صف العنوان."

    scan_limit = min(len(raw_frame.index), 20)
    best_index: int | None = None
    best_score = float("-inf")

    for row_index in range(scan_limit):
        header_cells = _extract_row_text_cells(raw_frame, row_index)
        if len(header_cells) <= 1:
            continue

        short_text_ratio = sum(len(cell) <= 40 for cell in header_cells) / max(len(header_cells), 1)
        unique_ratio = len(set(header_cells)) / max(len(header_cells), 1)

        next_rows = raw_frame.iloc[row_index + 1 : row_index + 6]
        if next_rows.empty:
            continue

        next_mask = _build_non_empty_mask(next_rows)
        tabular_following_rows = int((next_mask.sum(axis=1) >= 2).sum())
        if tabular_following_rows == 0:
            continue

        flattened_following = next_rows.where(next_mask).stack().astype(str).str.strip()
        numeric_signal = pd.to_numeric(flattened_following, errors="coerce").notna().mean() if not flattened_following.empty else 0.0
        datetime_signal = pd.to_datetime(flattened_following, errors="coerce").notna().mean() if not flattened_following.empty else 0.0

        score = (
            (len(header_cells) * 1.2)
            + (short_text_ratio * 4.0)
            + (unique_ratio * 3.0)
            + (tabular_following_rows * 2.4)
            + (numeric_signal * 3.0)
            + (datetime_signal * 2.0)
        )

        if score > best_score:
            best_score = score
            best_index = row_index

    if best_index is None:
        return None, "تعذر تحديد صف عنوان واضح ضمن أول 20 صفًا."

    return best_index, f"تم اختيار الصف {best_index + 1} كعنوان لأنه الأكثر شبهًا بصف header حقيقي."


def _materialize_table_from_header(raw_frame: pd.DataFrame, header_row_index: int | None) -> pd.DataFrame:
    if header_row_index is None or raw_frame.empty or header_row_index >= len(raw_frame.index):
        return pd.DataFrame()

    header_cells = raw_frame.iloc[header_row_index].tolist()
    data_frame = raw_frame.iloc[header_row_index + 1 :].copy().reset_index(drop=True)
    if data_frame.empty:
        return pd.DataFrame(columns=_build_column_names(header_cells))

    data_frame.columns = _build_column_names(header_cells)
    data_frame = data_frame.dropna(axis=0, how="all").dropna(axis=1, how="all")
    return data_frame.reset_index(drop=True)


def _analyze_sheet(raw_frame: pd.DataFrame, sheet_name: str) -> dict[str, Any]:
    normalized_raw = _normalize_raw_sheet(raw_frame)
    row_count_non_empty = int(len(normalized_raw.index))
    column_count_non_empty = int(len(normalized_raw.columns))
    non_empty_mask = _build_non_empty_mask(normalized_raw) if not normalized_raw.empty else pd.DataFrame()
    tabular_rows = int((non_empty_mask.sum(axis=1) >= 2).sum()) if not normalized_raw.empty else 0
    populated_cells, total_cells = _sheet_non_empty_stats(normalized_raw)
    empty_ratio = round(1 - (populated_cells / max(total_cells, 1)), 4) if total_cells else 1.0

    instruction_like, instruction_reason = _is_likely_instruction_sheet(normalized_raw)
    if _is_instruction_like_name(sheet_name):
        instruction_like = True
        instruction_reason = "تم تجاهلها لأن اسم الورقة يوحي بأنها تعليمات أو ملاحظات."

    header_row_index, header_reason = _detect_header_row(normalized_raw) if not instruction_like else (None, "لم يتم فحص صفوف العنوان لأن الورقة غير مؤهلة.")
    table_frame = _materialize_table_from_header(normalized_raw, header_row_index) if not instruction_like else pd.DataFrame()
    actual_row_count = int(len(table_frame.index))
    actual_column_count = int(len(table_frame.columns))
    actual_non_empty_mask = _build_non_empty_mask(table_frame) if not table_frame.empty else pd.DataFrame()
    actual_tabular_rows = int((actual_non_empty_mask.sum(axis=1) >= 2).sum()) if not table_frame.empty else 0

    eligible = (
        not instruction_like
        and header_row_index is not None
        and actual_row_count > 0
        and actual_column_count > 1
        and actual_tabular_rows > 0
    )

    score = 0.0
    if eligible:
        score = round(
            (actual_row_count * 0.45)
            + (actual_column_count * 0.25)
            + (actual_tabular_rows * 0.25)
            + ((1 - empty_ratio) * 10 * 0.05),
            2,
        )

    reason = instruction_reason if instruction_like else header_reason
    if eligible:
        reason = (
            f"تم اختيارها لأنها تحتوي على {actual_row_count} صفوف فعلية و{actual_column_count} أعمدة "
            f"بعد اكتشاف العنوان في الصف {header_row_index + 1}."
        )

    return {
        "sheet_name": str(sheet_name),
        "row_count_non_empty": row_count_non_empty,
        "column_count_non_empty": column_count_non_empty,
        "tabular_rows": tabular_rows,
        "empty_ratio": empty_ratio,
        "looks_like_instructions": instruction_like,
        "selected_header_row": header_row_index + 1 if header_row_index is not None else None,
        "actual_row_count": actual_row_count,
        "actual_column_count": actual_column_count,
        "score": score,
        "eligible": eligible,
        "reason": reason,
        "table_frame": table_frame,
    }


def _select_best_sheet(workbook: pd.ExcelFile) -> tuple[pd.DataFrame, str | None, int | None, str, list[dict[str, Any]], list[str]]:
    analyses: list[dict[str, Any]] = []
    warnings: list[str] = []
    best_frame: pd.DataFrame | None = None
    best_sheet_name: str | None = None
    best_header_row: int | None = None
    best_score = float("-inf")
    best_reason = "لم يتم العثور على ورقة مناسبة للتحليل."

    for sheet_name in workbook.sheet_names:
        raw_frame = workbook.parse(sheet_name, header=None, dtype=object)
        analysis = _analyze_sheet(raw_frame, str(sheet_name))
        analyses.append(analysis)

        if analysis["eligible"] and analysis["score"] > best_score:
            best_score = analysis["score"]
            best_frame = analysis["table_frame"]
            best_sheet_name = analysis["sheet_name"]
            best_header_row = analysis["selected_header_row"]
            best_reason = (
                f"تم اختيار الورقة {best_sheet_name} لأنها الأعلى في score ({analysis['score']}) "
                f"بعد اكتشاف الجدول الحقيقي ووجود بيانات tabular فعلية."
            )

    sheet_scores = [
        {
            "sheet_name": analysis["sheet_name"],
            "row_count_non_empty": analysis["row_count_non_empty"],
            "column_count_non_empty": analysis["column_count_non_empty"],
            "tabular_rows": analysis["tabular_rows"],
            "empty_ratio": analysis["empty_ratio"],
            "looks_like_instructions": analysis["looks_like_instructions"],
            "selected_header_row": analysis["selected_header_row"],
            "actual_row_count": analysis["actual_row_count"],
            "actual_column_count": analysis["actual_column_count"],
            "score": analysis["score"],
            "eligible": analysis["eligible"],
            "reason": analysis["reason"],
        }
        for analysis in sorted(analyses, key=lambda item: float(item["score"]), reverse=True)
    ]

    if best_frame is None:
        warnings.append(
            "لم يتم العثور على Sheet مناسب للتحليل. راجع الأوراق المتاحة وتأكد أن البيانات ليست داخل ورقة تعليمات أو عنوان فقط."
        )
        return pd.DataFrame(), None, None, best_reason, sheet_scores, warnings

    return best_frame, best_sheet_name, best_header_row, best_reason, sheet_scores, warnings


def _read_xlsx(file_path: Path) -> IngestionResult:
    workbook = pd.ExcelFile(file_path)
    sheet_names = [str(name) for name in workbook.sheet_names]
    if not sheet_names:
        raise ValueError("ملف xlsx لا يحتوي على أوراق قابلة للقراءة.")

    dataframe, selected_sheet, selected_header_row, reason_for_selection, all_sheets_scores, warnings = _select_best_sheet(workbook)

    return _finalize_result(
        "xlsx",
        dataframe,
        sheet_names=sheet_names,
        selected_sheet=selected_sheet,
        selected_header_row=selected_header_row,
        reason_for_selection=reason_for_selection,
        all_sheets_scores=all_sheets_scores,
        warnings=warnings,
    )


def _read_xls_fallback(file_path: Path) -> IngestionResult:
    try:
        workbook = pd.ExcelFile(file_path, engine="xlrd")
    except ImportError as error:
        raise ValueError("قراءة ملفات xls تتطلب تثبيت xlrd.") from error

    sheet_names = [str(name) for name in workbook.sheet_names]
    if not sheet_names:
        raise ValueError("ملف xls لا يحتوي على أوراق قابلة للقراءة.")

    dataframe, selected_sheet, selected_header_row, reason_for_selection, all_sheets_scores, warnings = _select_best_sheet(workbook)
    return _finalize_result(
        "xls",
        dataframe,
        sheet_names=sheet_names,
        selected_sheet=selected_sheet,
        selected_header_row=selected_header_row,
        reason_for_selection=reason_for_selection,
        all_sheets_scores=all_sheets_scores,
        warnings=warnings,
    )


def ingest_uploaded_file(filename: str, payload: bytes) -> IngestionResult:
    safe_filename = _normalize_filename(filename)
    extension = _normalize_extension(safe_filename)

    if not payload:
        raise ValueError("الملف المرفوع فارغ.")

    if len(payload) > MAX_UPLOAD_BYTES:
        raise ValueError("حجم الملف كبير جدًا. الحد الأقصى 12MB.")

    temp_path = _write_temp_file(safe_filename, payload)

    try:
        if extension == ".csv":
            return _read_csv(temp_path)
        if extension == ".xlsx":
            return _read_xlsx(temp_path)
        return _read_xls_fallback(temp_path)
    finally:
        temp_path.unlink(missing_ok=True)

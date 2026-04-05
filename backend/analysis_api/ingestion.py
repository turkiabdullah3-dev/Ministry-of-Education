from __future__ import annotations

from pathlib import Path

import pandas as pd

from backend import analyze_indicators as legacy


def read_csv_file(file_path: Path) -> pd.DataFrame:
    return legacy.read_csv_with_fallbacks(file_path)


def read_xlsx_file(file_path: Path) -> dict[str, pd.DataFrame]:
    return pd.read_excel(file_path, sheet_name=None, header=None)


def read_xls_fallback(file_path: Path) -> dict[str, pd.DataFrame]:
    try:
        return pd.read_excel(file_path, sheet_name=None, header=None, engine="xlrd")
    except ImportError as error:
        raise ValueError("ملف XLS يحتاج محرك xlrd ليتم تحليله.") from error


def _prepare_workbook_sheets(workbook: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, str, dict]:
    prepared_sheets: list[tuple[str, pd.DataFrame, dict]] = []

    for sheet_name, sheet_df in workbook.items():
        cleaned = sheet_df.dropna(how="all").dropna(axis=1, how="all")
        if cleaned.empty:
            continue

        prepared_dataframe, preparation_meta = legacy.prepare_dataframe_from_raw(
            cleaned.reset_index(drop=True)
        )
        if prepared_dataframe.empty:
            continue

        prepared_sheets.append(
            (
                sheet_name,
                prepared_dataframe,
                {
                    **preparation_meta,
                    "sheetScore": legacy.score_dataframe_candidate(prepared_dataframe),
                },
            )
        )

    if not prepared_sheets:
        raise ValueError("الملف لا يحتوي على أي بيانات قابلة للتحليل.")

    best_sheet_name, best_sheet, preparation_meta = max(
        prepared_sheets,
        key=lambda item: (item[2]["sheetScore"], len(item[1]), item[1].notna().sum().sum()),
    )
    return best_sheet, best_sheet_name, preparation_meta


def load_tabular_data(file_path: Path) -> tuple[pd.DataFrame, str, dict]:
    extension = file_path.suffix.lower()

    if extension == ".csv":
        raw_dataframe = read_csv_file(file_path)
        dataframe, preparation_meta = legacy.prepare_dataframe_from_raw(raw_dataframe)
        return dataframe, "CSV", preparation_meta

    if extension == ".xlsx":
        return _prepare_workbook_sheets(read_xlsx_file(file_path))

    if extension == ".xls":
        try:
            return _prepare_workbook_sheets(read_xlsx_file(file_path))
        except Exception:
            return _prepare_workbook_sheets(read_xls_fallback(file_path))

    raise ValueError("نوع الملف غير مدعوم للتحليل.")


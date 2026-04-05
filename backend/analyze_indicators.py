import json
import math
import re
import sys
import warnings
from itertools import product
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore", message="Could not infer format")
warnings.filterwarnings("ignore", message="Parsing dates in .*", category=UserWarning)
warnings.filterwarnings("ignore", message="Data Validation extension is not supported and will be removed", category=UserWarning)


COLOR_TONES = [
    {"id": "cyan", "accent": "#72e8ff", "glow": "#1ea7ff"},
    {"id": "mint", "accent": "#66f2d6", "glow": "#1ecfc2"},
    {"id": "violet", "accent": "#7fb5ff", "glow": "#4f7dff"},
    {"id": "teal", "accent": "#58d6ff", "glow": "#269dff"},
    {"id": "amber", "accent": "#8ce6ff", "glow": "#2da8ff"},
    {"id": "blue", "accent": "#5f9dff", "glow": "#336dff"},
]

DATE_ALIASES = {
    "date",
    "transactiondate",
    "invoicedate",
    "createdat",
    "createddate",
    "orderdate",
    "month",
    "period",
    "timestamp",
    "التاريخ",
    "تاريخ",
    "تاريخالفاتورة",
    "تاريخالطلب",
    "الفترة",
    "الشهر",
}

VALUE_ALIASES = {
    "amount",
    "total",
    "sales",
    "revenue",
    "value",
    "net",
    "subtotal",
    "sum",
    "price",
    "cost",
    "المبلغ",
    "القيمة",
    "الاجمالي",
    "الإجمالي",
    "المبيعات",
    "الايراد",
    "الإيراد",
    "السعر",
    "التكلفة",
}

TARGET_ALIASES = {
    "target",
    "plan",
    "goal",
    "budget",
    "forecast",
    "الخطة",
    "المستهدف",
    "الهدف",
    "الموازنة",
}

CATEGORY_ALIASES = {
    "category",
    "department",
    "segment",
    "region",
    "branch",
    "product",
    "type",
    "group",
    "class",
    "departmentname",
    "categoryname",
    "الإدارة",
    "القسم",
    "الفئة",
    "التصنيف",
    "المنتج",
    "الفرع",
    "المنطقة",
    "القطاع",
}

ENTITY_ALIASES = {
    "client",
    "customer",
    "name",
    "fullname",
    "employee",
    "user",
    "trainee",
    "account",
    "id",
    "code",
    "sku",
    "clientname",
    "customername",
    "الاسم",
    "العميل",
    "المستفيد",
    "المستخدم",
    "المتدرب",
    "المعرف",
    "الرقم",
    "الرمز",
}

ALL_ALIASES = DATE_ALIASES | VALUE_ALIASES | TARGET_ALIASES | CATEGORY_ALIASES | ENTITY_ALIASES

ARABIC_MONTHS = {
    "يناير": "january",
    "فبراير": "february",
    "مارس": "march",
    "ابريل": "april",
    "أبريل": "april",
    "مايو": "may",
    "يونيو": "june",
    "يوليو": "july",
    "اغسطس": "august",
    "أغسطس": "august",
    "سبتمبر": "september",
    "اكتوبر": "october",
    "أكتوبر": "october",
    "نوفمبر": "november",
    "ديسمبر": "december",
}

TEXT_STOPWORDS = {
    "من",
    "في",
    "على",
    "الى",
    "إلى",
    "عن",
    "مع",
    "تم",
    "هذا",
    "هذه",
    "ذلك",
    "التي",
    "الذي",
    "لدى",
    "بعد",
    "قبل",
    "بسبب",
    "حول",
    "ضمن",
    "عدم",
    "وجود",
    "يتم",
    "عند",
    "كان",
    "كانت",
    "كما",
    "كل",
    "وقد",
    "او",
    "أو",
    "then",
    "with",
    "from",
    "that",
    "this",
    "have",
    "has",
    "had",
    "will",
    "into",
    "about",
    "there",
    "their",
    "them",
    "than",
    "the",
    "and",
    "for",
    "are",
    "was",
    "were",
}


def normalize_digits(value):
    return str(value).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))


def cleaned_text(value):
    return "" if value is None else normalize_digits(str(value)).strip()


def normalize_text(value):
    text = cleaned_text(value).lower()
    text = re.sub(r"[\s_\-\/\\\.\(\)\[\]\{\}]+", "", text)
    return text


def compact_number(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"

    if isinstance(value, (int, float)):
        if abs(float(value) - int(float(value))) < 1e-9:
            return f"{int(round(float(value))):,}"
        return f"{float(value):,.1f}"

    return str(value)


def percent_text(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "--"
    return f"{float(value):.0f}%"


def safe_float(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    return float(value)


def clamp(value, minimum=0.0, maximum=1.0):
    return max(minimum, min(float(value), maximum))


def clean_numeric_token(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None

    if isinstance(value, (int, float)):
        return value

    token = cleaned_text(value)
    if not token:
        return None

    token = token.replace("،", ",")
    token = re.sub(r"[^\d,\.\-]", "", token)

    if not token or token in {"-", ".", ","}:
        return None

    if "," in token and "." in token:
        if token.rfind(",") > token.rfind("."):
            token = token.replace(".", "").replace(",", ".")
        else:
            token = token.replace(",", "")
    elif token.count(",") == 1 and "." not in token:
        left, right = token.split(",", 1)
        token = f"{left}.{right}" if len(right) <= 2 else f"{left}{right}"
    else:
        token = token.replace(",", "")

    return token


def to_numeric_series(series):
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")

    cleaned = series.map(clean_numeric_token)
    return pd.to_numeric(cleaned, errors="coerce")


def normalize_date_text(value):
    token = cleaned_text(value).lower()
    if not token:
        return token

    for arabic_name, english_name in ARABIC_MONTHS.items():
        token = token.replace(arabic_name, english_name)

    return token.replace("هـ", "").replace("م", "")


def to_datetime_series(series):
    normalized_text_series = series.map(normalize_date_text)
    numeric_series = to_numeric_series(series)
    excel_serial_try = pd.Series(pd.NaT, index=series.index, dtype="datetime64[ns]")

    if numeric_series.notna().mean() >= 0.7:
        plausible_serials = numeric_series.where((numeric_series >= 20000) & (numeric_series <= 60000))
        excel_serial_try = pd.to_datetime(plausible_serials, unit="D", origin="1899-12-30", errors="coerce")

    first_try = pd.to_datetime(normalized_text_series, errors="coerce", dayfirst=True)
    second_try = pd.to_datetime(normalized_text_series, errors="coerce", dayfirst=False)

    first_count = int(first_try.notna().sum())
    second_count = int(second_try.notna().sum())
    serial_count = int(excel_serial_try.notna().sum())

    if serial_count > max(first_count, second_count):
        return excel_serial_try
    return first_try if first_count >= second_count else second_try


def make_unique_headers(values):
    headers = []
    seen = {}

    for index, value in enumerate(values, start=1):
        base = cleaned_text(value)
        base = re.sub(r"\s+", " ", base)
        if not base or normalize_text(base).startswith("unnamed"):
            base = f"Column {index}"

        count = seen.get(base, 0)
        seen[base] = count + 1
        headers.append(base if count == 0 else f"{base} ({count + 1})")

    return headers


def score_header_row(raw_dataframe, row_index):
    if row_index >= len(raw_dataframe.index):
        return float("-inf")

    row = raw_dataframe.iloc[row_index].tolist()
    meaningful_cells = [cell for cell in row if cleaned_text(cell)]
    if len(meaningful_cells) < 2:
        return float("-inf")

    normalized_cells = [normalize_text(cell) for cell in meaningful_cells]
    alias_hits = sum(1 for token in normalized_cells if get_alias_strength(token, ALL_ALIASES) >= 0.72)
    distinct_ratio = len(set(normalized_cells)) / max(len(normalized_cells), 1)
    text_like_ratio = sum(1 for cell in meaningful_cells if clean_numeric_token(cell) is None) / max(len(meaningful_cells), 1)

    following_rows = raw_dataframe.iloc[row_index + 1 : row_index + 7]
    data_like_rows = 0
    for _, data_row in following_rows.iterrows():
        non_empty_count = int(sum(1 for cell in data_row.tolist() if cleaned_text(cell)))
        if non_empty_count >= max(2, min(len(meaningful_cells), 4)):
            data_like_rows += 1

    return (
        alias_hits * 6.0
        + distinct_ratio * 2.5
        + text_like_ratio * 1.8
        + data_like_rows * 0.75
        + min(len(meaningful_cells), 12) * 0.08
    )


def prepare_dataframe_from_raw(raw_dataframe):
    candidate_range = min(8, len(raw_dataframe.index))
    best_header_row = 0
    best_score = float("-inf")

    for row_index in range(candidate_range):
        score = score_header_row(raw_dataframe, row_index)
        if score > best_score:
            best_score = score
            best_header_row = row_index

    dataframe = raw_dataframe.iloc[best_header_row + 1 :].copy()
    dataframe.columns = make_unique_headers(raw_dataframe.iloc[best_header_row].tolist())
    dataframe = dataframe.dropna(how="all").dropna(axis=1, how="all").reset_index(drop=True)

    return dataframe, {"headerRow": best_header_row + 1, "headerScore": round(best_score, 2)}


def read_csv_with_fallbacks(file_path):
    for encoding in ("utf-8", "utf-8-sig", "cp1256", "latin1"):
        try:
            return pd.read_csv(file_path, header=None, encoding=encoding)
        except UnicodeDecodeError:
            continue
    return pd.read_csv(file_path, header=None)


def load_dataframe(file_path):
    extension = file_path.suffix.lower()

    if extension == ".csv":
        raw_dataframe = read_csv_with_fallbacks(file_path)
        dataframe, preparation_meta = prepare_dataframe_from_raw(raw_dataframe)
        return dataframe, "CSV", preparation_meta

    if extension in {".xlsx", ".xls"}:
        workbook = pd.read_excel(file_path, sheet_name=None, header=None)
        prepared_sheets = []

        for sheet_name, sheet_df in workbook.items():
            cleaned = sheet_df.dropna(how="all").dropna(axis=1, how="all")
            if cleaned.empty:
                continue
            prepared_dataframe, preparation_meta = prepare_dataframe_from_raw(cleaned.reset_index(drop=True))
            if prepared_dataframe.empty:
                continue
            prepared_sheets.append(
                (
                    sheet_name,
                    prepared_dataframe,
                    {
                        **preparation_meta,
                        "sheetScore": score_dataframe_candidate(prepared_dataframe),
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

    raise ValueError("نوع الملف غير مدعوم للتحليل.")


def profile_columns(dataframe):
    profiles = []

    for column in dataframe.columns:
        series = dataframe[column]
        non_null = int(series.notna().sum())
        normalized = normalize_text(column)
        numeric_series = to_numeric_series(series)
        numeric_ratio = (numeric_series.notna().sum() / non_null) if non_null else 0
        datetime_series = to_datetime_series(series)
        datetime_ratio = (datetime_series.notna().sum() / non_null) if non_null else 0
        unique_count = int(series.dropna().astype(str).nunique())
        avg_text_length = float(series.dropna().astype(str).map(lambda value: len(cleaned_text(value))).mean()) if non_null else 0.0
        completeness_ratio = (non_null / len(series.index)) if len(series.index) else 0.0
        text_ratio = clamp(1 - max(float(numeric_ratio), float(datetime_ratio)))
        mixed_type_score = min(float(numeric_ratio), text_ratio)

        profiles.append(
            {
                "name": str(column),
                "normalized": normalized,
                "series": series,
                "numeric_series": numeric_series,
                "numeric_ratio": float(numeric_ratio),
                "datetime_series": datetime_series,
                "datetime_ratio": float(datetime_ratio),
                "non_null": non_null,
                "unique_count": unique_count,
                "avg_text_length": avg_text_length,
                "completenessRatio": round(completeness_ratio, 4),
                "text_ratio": round(text_ratio, 4),
                "mixedTypeScore": round(mixed_type_score, 4),
            }
        )

    return profiles


def score_dataframe_candidate(dataframe):
    if dataframe.empty:
        return float("-inf")

    profiles = profile_columns(dataframe)
    row_count = max(len(dataframe.index), 1)
    mode_scores = []

    for aliases, mode in [
        (DATE_ALIASES, "date"),
        (VALUE_ALIASES, "numeric"),
        (TARGET_ALIASES, "target"),
        (CATEGORY_ALIASES, "category"),
        (ENTITY_ALIASES, "entity"),
    ]:
        best_confidence = 0.0
        for profile in profiles:
            candidate = score_profile(profile, aliases, mode, row_count)
            if candidate and candidate["eligible"]:
                best_confidence = max(best_confidence, candidate["confidence"])
        mode_scores.append(best_confidence)

    density = dataframe.notna().mean().mean() if len(dataframe.columns) else 0.0
    return round(sum(mode_scores) * 10 + min(len(dataframe.index), 500) * 0.01 + density * 2.5, 3)


def normalize_theme_token(token):
    token = token.lower()
    token = re.sub(r"^(ال)", "", token)
    token = re.sub(r"(ات|ون|ين|ية|ه|ة)$", "", token)
    return token


def tokenize_text(value):
    text = cleaned_text(value).lower()
    if not text:
        return []

    raw_tokens = re.findall(r"[a-zA-Z\u0600-\u06FF]{3,}", text)
    tokens = []

    for raw_token in raw_tokens:
        if raw_token in TEXT_STOPWORDS or raw_token.isdigit():
            continue

        normalized_token = normalize_theme_token(raw_token)
        if len(normalized_token) < 3 or normalized_token in TEXT_STOPWORDS:
            continue

        tokens.append({"raw": raw_token, "normalized": normalized_token})

    return tokens

def choose_primary_text_profile(profiles, used_names=None):
    used_names = used_names or set()
    candidates = [
        profile
        for profile in profiles
        if profile["name"] not in used_names
        and profile["non_null"] >= 3
        and profile["numeric_ratio"] < 0.30
        and profile["datetime_ratio"] < 0.35
        and profile["avg_text_length"] >= 8
    ]
    if not candidates:
        return None

    candidates.sort(
        key=lambda profile: (
            profile["avg_text_length"],
            profile["non_null"],
            profile["unique_count"],
        ),
        reverse=True,
    )
    return candidates[0]


def prettify_theme_label(token):
    if not token:
        return token
    return token.replace("_", " ")


def build_row_candidates(tokens):
    candidates = {}

    for token in tokens:
        candidates[token["normalized"]] = token["raw"]

    for index in range(len(tokens) - 1):
        left = tokens[index]
        right = tokens[index + 1]
        if left == right:
            continue
        candidates[f"{left['normalized']}_{right['normalized']}"] = f"{left['raw']} {right['raw']}"
    return candidates


def derive_text_themes(series, limit=6):
    candidate_counter = {}
    display_counter = {}
    row_candidates = []

    for value in series.fillna(""):
        tokens = tokenize_text(value)
        candidates = build_row_candidates(tokens)
        row_candidates.append(candidates)
        for candidate, display_value in candidates.items():
            candidate_counter[candidate] = candidate_counter.get(candidate, 0) + 1
            display_counter.setdefault(candidate, {})
            display_counter[candidate][display_value] = display_counter[candidate].get(display_value, 0) + 1

    ranked_candidates = []
    for candidate, count in candidate_counter.items():
        if count < 2:
            continue
        is_phrase = "_" in candidate
        score = count * (2.4 if is_phrase else 1.0) + len(candidate) * 0.03
        ranked_candidates.append((candidate, count, score))

    ranked_candidates.sort(key=lambda item: (item[2], item[1], len(item[0])), reverse=True)
    selected_candidates = [candidate for candidate, _, _ in ranked_candidates[:limit]]

    if len(selected_candidates) < 2:
        return None

    candidate_scores = {candidate: index for index, candidate in enumerate(selected_candidates)}
    candidate_display = {}
    for candidate in selected_candidates:
        candidate_display[candidate] = max(
            display_counter[candidate].items(),
            key=lambda item: (item[1], len(item[0])),
        )[0]

    derived_labels = []
    for candidates in row_candidates:
        matching_candidates = [candidate for candidate in candidates if candidate in candidate_scores]
        if not matching_candidates:
            derived_labels.append("أخرى")
            continue
        matching_candidates.sort(key=lambda candidate: (candidate_scores[candidate], "_" not in candidate))
        derived_labels.append(prettify_theme_label(candidate_display[matching_candidates[0]]))

    derived_series = pd.Series(derived_labels, index=series.index, name="themes")
    if derived_series.nunique() < 2:
        return None

    return {
        "series": derived_series,
        "tokens": [prettify_theme_label(candidate_display[candidate]) for candidate in selected_candidates],
        "sourceName": getattr(series, "name", None),
    }


def get_alias_strength(normalized_name, aliases):
    if normalized_name in aliases:
        return 1.0

    long_aliases = [alias for alias in aliases if len(alias) >= 4]
    if any(alias in normalized_name for alias in long_aliases):
        return 0.72

    return 0.0


def get_category_shape_score(unique_ratio):
    if unique_ratio <= 0.01:
        return 0.25
    if unique_ratio <= 0.18:
        return 1.0
    if unique_ratio <= 0.55:
        return clamp(1 - ((unique_ratio - 0.18) / 0.37), 0.2, 1.0)
    if unique_ratio <= 0.72:
        return clamp(0.25 - ((unique_ratio - 0.55) / 0.17) * 0.25, 0.0, 0.25)
    return 0.0


def get_entity_shape_score(unique_ratio):
    if unique_ratio <= 0.08:
        return 0.0
    if unique_ratio >= 0.92:
        return 1.0
    return clamp((unique_ratio - 0.08) / 0.84, 0.0, 1.0)


def score_profile(profile, aliases, mode, row_count):
    completeness_ratio = (profile["non_null"] / row_count) if row_count else 0.0
    unique_ratio = (profile["unique_count"] / profile["non_null"]) if profile["non_null"] else 0.0
    alias_strength = get_alias_strength(profile["normalized"], aliases)
    numeric_ratio = clamp(profile["numeric_ratio"])
    datetime_ratio = clamp(profile["datetime_ratio"])
    text_ratio = clamp(1 - max(numeric_ratio, datetime_ratio))
    confidence = 0.0
    eligible = profile["non_null"] > 0
    minimum_confidence = 0.0

    if mode == "date":
        confidence = alias_strength * 0.45 + datetime_ratio * 0.45 + completeness_ratio * 0.10
        minimum_confidence = 0.72
        eligible = eligible and (
            datetime_ratio >= 0.78 or (alias_strength >= 0.72 and datetime_ratio >= 0.45)
        )
    elif mode == "numeric":
        identifier_penalty = 0.14 if profile["normalized"] in ENTITY_ALIASES else 0.0
        confidence = alias_strength * 0.50 + numeric_ratio * 0.38 + completeness_ratio * 0.12 - identifier_penalty
        minimum_confidence = 0.74
        eligible = eligible and (
            numeric_ratio >= 0.88 or (alias_strength >= 0.72 and numeric_ratio >= 0.58)
        )
    elif mode == "target":
        identifier_penalty = 0.18 if profile["normalized"] in ENTITY_ALIASES else 0.0
        confidence = alias_strength * 0.62 + numeric_ratio * 0.25 + completeness_ratio * 0.13 - identifier_penalty
        minimum_confidence = 0.78
        eligible = eligible and alias_strength >= 0.72 and numeric_ratio >= 0.60
    elif mode == "category":
        category_shape = get_category_shape_score(unique_ratio)
        confidence = alias_strength * 0.48 + category_shape * 0.24 + text_ratio * 0.16 + completeness_ratio * 0.12
        minimum_confidence = 0.64
        eligible = eligible and profile["unique_count"] >= 2 and numeric_ratio < 0.45 and (
            unique_ratio <= 0.72 or alias_strength >= 0.72
        )
    elif mode == "entity":
        entity_shape = get_entity_shape_score(unique_ratio)
        confidence = alias_strength * 0.55 + entity_shape * 0.22 + text_ratio * 0.13 + completeness_ratio * 0.10
        minimum_confidence = 0.68
        eligible = eligible and profile["unique_count"] >= 2 and numeric_ratio < 0.68 and (
            unique_ratio >= 0.32 or alias_strength >= 0.72
        )
    else:
        return None

    confidence = clamp(confidence)

    return {
        "profile": profile,
        "confidence": round(confidence, 3),
        "eligible": bool(eligible),
        "aliasStrength": alias_strength,
        "uniqueRatio": round(unique_ratio, 3),
        "minimumConfidence": minimum_confidence,
    }


def choose_column(profiles, aliases, mode):
    row_count = max(max((profile["non_null"] for profile in profiles), default=0), 1)
    candidates = [candidate for candidate in (score_profile(profile, aliases, mode, row_count) for profile in profiles) if candidate]
    eligible_candidates = [candidate for candidate in candidates if candidate["eligible"]]

    if not eligible_candidates:
        return None

    eligible_candidates.sort(
        key=lambda candidate: (
            candidate["confidence"],
            candidate["aliasStrength"],
            candidate["profile"]["non_null"],
        ),
        reverse=True,
    )

    best_candidate = eligible_candidates[0]
    runner_up = eligible_candidates[1] if len(eligible_candidates) > 1 else None
    ambiguous = runner_up and (
        abs(best_candidate["confidence"] - runner_up["confidence"]) < 0.08
        and runner_up["confidence"] >= best_candidate["minimumConfidence"] - 0.03
    )

    if best_candidate["confidence"] < best_candidate["minimumConfidence"] or ambiguous:
        return None

    return {
        **best_candidate["profile"],
        "selectionConfidence": round(best_candidate["confidence"] * 100, 1),
        "selectionAliasStrength": round(best_candidate["aliasStrength"] * 100, 1),
        "selectionUniqueRatio": round(best_candidate["uniqueRatio"] * 100, 1),
    }


def rank_candidates(profiles, aliases, mode, limit=3):
    row_count = max(max((profile["non_null"] for profile in profiles), default=0), 1)
    candidates = [candidate for candidate in (score_profile(profile, aliases, mode, row_count) for profile in profiles) if candidate and candidate["eligible"]]
    candidates.sort(
        key=lambda candidate: (
            candidate["confidence"],
            candidate["aliasStrength"],
            candidate["profile"]["non_null"],
        ),
        reverse=True,
    )

    ranked = []
    for candidate in candidates:
        if candidate["confidence"] < candidate["minimumConfidence"] - 0.08:
            continue
        ranked.append(
            {
                **candidate["profile"],
                "selectionConfidence": round(candidate["confidence"] * 100, 1),
                "selectionAliasStrength": round(candidate["aliasStrength"] * 100, 1),
                "selectionUniqueRatio": round(candidate["uniqueRatio"] * 100, 1),
            }
        )
        if len(ranked) >= limit:
            break

    return ranked


def evaluate_schema_combo(date_profile, target_profile, value_profile, category_profile, entity_profile):
    selected_profiles = [profile for profile in [date_profile, target_profile, value_profile, category_profile, entity_profile] if profile]
    selected_names = [profile["name"] for profile in selected_profiles]

    if len(set(selected_names)) != len(selected_names):
        return float("-inf")

    score = 0.0
    score += (date_profile.get("selectionConfidence", 0.0) if date_profile else 0.0) * 1.05
    score += (value_profile.get("selectionConfidence", 0.0) if value_profile else 0.0) * 1.20
    score += (target_profile.get("selectionConfidence", 0.0) if target_profile else 0.0) * 0.60
    score += (category_profile.get("selectionConfidence", 0.0) if category_profile else 0.0) * 0.85
    score += (entity_profile.get("selectionConfidence", 0.0) if entity_profile else 0.0) * 0.55

    if target_profile and not value_profile:
        score -= 18

    if date_profile:
        valid_dates = int(date_profile["datetime_series"].notna().sum())
        distinct_periods = int(date_profile["datetime_series"].dropna().dt.to_period("M").nunique()) if valid_dates else 0
        score += min(valid_dates, 120) * 0.05
        score += min(distinct_periods, 12) * 1.8
        if distinct_periods <= 1:
            score -= 10

    if value_profile:
        numeric_fill = float(value_profile["numeric_series"].notna().mean())
        non_zero_ratio = float((value_profile["numeric_series"].fillna(0) != 0).mean())
        score += numeric_fill * 10
        score += non_zero_ratio * 6

    if category_profile:
        category_count = int(category_profile["series"].dropna().astype(str).nunique())
        score += 6 if 2 <= category_count <= 14 else max(0, 4 - abs(category_count - 8) * 0.35)
        if value_profile and 2 <= category_count <= 14:
            score += 8

    if entity_profile:
        entity_ratio = (entity_profile["unique_count"] / max(entity_profile["non_null"], 1)) if entity_profile["non_null"] else 0.0
        score += clamp(entity_ratio, 0.0, 1.0) * 8
        if category_profile and entity_ratio <= 0.18:
            score -= 8

    if date_profile and value_profile:
        score += 14
    if date_profile and category_profile and value_profile:
        score += 6

    return round(score, 3)


def select_schema(profiles):
    ranked_date_profiles = rank_candidates(profiles, DATE_ALIASES, "date")
    ranked_target_profiles = rank_candidates(profiles, TARGET_ALIASES, "target", limit=2)
    ranked_value_profiles = rank_candidates(profiles, VALUE_ALIASES, "numeric")
    ranked_category_profiles = rank_candidates(profiles, CATEGORY_ALIASES, "category")
    ranked_entity_profiles = rank_candidates(profiles, ENTITY_ALIASES, "entity")

    best_score = float("-inf")
    best_selection = (None, None, None, None, None)

    for date_profile, target_profile, value_profile, category_profile, entity_profile in product(
        [None] + ranked_date_profiles,
        [None] + ranked_target_profiles,
        [None] + ranked_value_profiles,
        [None] + ranked_category_profiles,
        [None] + ranked_entity_profiles,
    ):
        combo_score = evaluate_schema_combo(date_profile, target_profile, value_profile, category_profile, entity_profile)
        if combo_score > best_score:
            best_score = combo_score
            best_selection = (date_profile, target_profile, value_profile, category_profile, entity_profile)

    return {
        "date": best_selection[0] or choose_column(profiles, DATE_ALIASES, "date"),
        "target": best_selection[1] or choose_column(profiles, TARGET_ALIASES, "target"),
        "value": best_selection[2] or choose_column(profiles, VALUE_ALIASES, "numeric"),
        "category": best_selection[3] or choose_column(profiles, CATEGORY_ALIASES, "category"),
        "entity": best_selection[4] or choose_column(profiles, ENTITY_ALIASES, "entity"),
        "selectionScore": best_score,
    }


def choose_secondary_category(profiles, used_names):
    candidates = [
        profile
        for profile in profiles
        if profile["name"] not in used_names and profile["numeric_ratio"] < 0.35 and profile["unique_count"] >= 2
    ]
    if not candidates:
        return None

    return sorted(
        candidates,
        key=lambda profile: (profile["normalized"] in CATEGORY_ALIASES, -profile["unique_count"], profile["name"]),
        reverse=True,
    )[0]


def series_from_grouped(grouped_series, limit=8):
    result = []
    for label, value in grouped_series.head(limit).items():
        result.append({"label": str(label), "value": safe_float(value) or 0.0})
    return result


def build_time_points(grouped_frame, label_key, primary_key, secondary_key=None):
    points = []
    for _, row in grouped_frame.iterrows():
        point = {"label": str(row[label_key]), "primary": safe_float(row[primary_key]) or 0.0}
        if secondary_key:
            point["secondary"] = safe_float(row[secondary_key]) or 0.0
        points.append(point)
    return points


def calculate_field_quality(dataframe):
    items = []
    for column in dataframe.columns:
        completeness = dataframe[column].notna().mean() * 100 if len(dataframe.index) else 0
        items.append({"label": str(column), "value": round(completeness, 1)})
    return sorted(items, key=lambda item: item["value"], reverse=True)


def build_column_confidence(*profiles):
    return {
        profile["name"]: profile["selectionConfidence"]
        for profile in profiles
        if profile and profile.get("selectionConfidence") is not None
    }


def build_schema_candidates(profiles):
    return {
        "date": [candidate["name"] for candidate in rank_candidates(profiles, DATE_ALIASES, "date", limit=3)],
        "value": [candidate["name"] for candidate in rank_candidates(profiles, VALUE_ALIASES, "numeric", limit=3)],
        "target": [candidate["name"] for candidate in rank_candidates(profiles, TARGET_ALIASES, "target", limit=2)],
        "category": [candidate["name"] for candidate in rank_candidates(profiles, CATEGORY_ALIASES, "category", limit=3)],
        "entity": [candidate["name"] for candidate in rank_candidates(profiles, ENTITY_ALIASES, "entity", limit=3)],
    }


def estimate_duplicate_rows(dataframe):
    if dataframe.empty:
        return 0

    subset_columns = list(dataframe.columns[: min(len(dataframe.columns), 8)])
    normalized_subset = dataframe[subset_columns].copy()

    for column in subset_columns:
        normalized_subset[column] = normalized_subset[column].fillna("").astype(str).str.strip()

    return int(normalized_subset.duplicated().sum())


def build_preflight_report(dataframe, profiles):
    row_count = int(len(dataframe.index))
    column_count = int(len(dataframe.columns))
    duplicate_rows = estimate_duplicate_rows(dataframe)
    low_completeness_fields = [
        {
            "name": profile["name"],
            "completeness": round(profile["completenessRatio"] * 100, 1),
        }
        for profile in profiles
        if profile["non_null"] and profile["completenessRatio"] < 0.6
    ]
    mixed_type_fields = [
        {
            "name": profile["name"],
            "numericRatio": round(profile["numeric_ratio"] * 100, 1),
            "textRatio": round(profile["text_ratio"] * 100, 1),
        }
        for profile in profiles
        if profile["non_null"] >= 5 and profile["numeric_ratio"] >= 0.2 and profile["text_ratio"] >= 0.2 and profile["mixedTypeScore"] >= 0.2
    ]
    sparse_fields = [profile["name"] for profile in profiles if profile["non_null"] == 0]
    very_wide_file = column_count >= 35
    very_large_file = row_count >= 20_000
    processing_mode = "full"

    if row_count >= 80_000 or column_count >= 70:
        processing_mode = "heavy"
    elif row_count >= 20_000 or column_count >= 35:
        processing_mode = "elevated"

    score = 100.0
    score -= min(len(low_completeness_fields) * 3.2, 20)
    score -= min(len(mixed_type_fields) * 4.5, 22)
    score -= min((duplicate_rows / max(row_count, 1)) * 100 * 0.7, 16)
    score -= 6 if very_large_file else 0
    score -= 4 if very_wide_file else 0
    score = round(max(score, 0.0), 1)

    notes = []
    if duplicate_rows:
        notes.append(f"تم رصد {compact_number(duplicate_rows)} صفًا مكررًا تقريبًا ضمن أول الحقول الأساسية.")
    if low_completeness_fields:
        notes.append("توجد أعمدة منخفضة الاكتمال قد تؤثر على بعض المؤشرات.")
    if mixed_type_fields:
        notes.append("توجد أعمدة مختلطة النوع بين نص ورقم، ويجب الانتباه إليها قبل الاعتماد النهائي.")
    if very_large_file:
        notes.append("الملف كبير الحجم، لذلك يجب الاعتماد على الأعمدة المعتمدة فقط وتجنب التفسير الحر للحقول الجانبية.")

    return {
        "score": score,
        "processingMode": processing_mode,
        "rowCount": row_count,
        "columnCount": column_count,
        "duplicateRows": duplicate_rows,
        "duplicateRatio": round((duplicate_rows / max(row_count, 1)) * 100, 2),
        "lowCompletenessFields": low_completeness_fields[:6],
        "mixedTypeFields": mixed_type_fields[:6],
        "emptyFields": sparse_fields[:6],
        "notes": notes,
    }


def make_indicator_card(
    *,
    title,
    actual,
    actual_display,
    reference_label,
    reference_value,
    progress,
    progress_display,
    tone,
    description,
    priority,
):
    return {
        "title": title,
        "actual": actual,
        "actualDisplay": actual_display,
        "referenceLabel": reference_label,
        "referenceValue": reference_value,
        "progress": progress,
        "progressDisplay": progress_display,
        "tone": tone,
        "description": description,
        "priority": priority,
    }


def build_analysis_assistant(meta, schema, validation, dashboard):
    quality_score = safe_float(validation.get("qualityScore")) or 0.0
    row_count = int(meta.get("rowCount") or 0)
    warnings = validation.get("warnings", [])
    distribution_items = dashboard.get("distribution", {}).get("items", [])
    ranking_items = dashboard.get("ranking", {}).get("items", [])
    trend_points = dashboard.get("trend", {}).get("points", [])
    field_quality_items = dashboard.get("fieldQuality", {}).get("items", [])

    readiness_label = "جاهز للتشغيل" if validation.get("ready") and not validation.get("needsReview") else "جاهز مع مراجعة"
    headline = (
        f"الملف يحتوي على {compact_number(row_count)} سجلًا، والتحليل في حالة {readiness_label} بدرجة {percent_text(quality_score)}."
        if row_count
        else "لم يتمكن النظام من تكوين قراءة تشغيلية كافية لهذا الملف."
    )

    summary_parts = []
    if schema.get("valueColumn"):
        summary_parts.append(f"اعتمد النظام عمود القيمة من {schema['valueColumn']}")
    if schema.get("dateColumn"):
        summary_parts.append(f"واكتشف التسلسل الزمني من {schema['dateColumn']}")
    if schema.get("categoryColumn"):
        summary_parts.append(f"والتوزيع الرئيسي من {schema['categoryColumn']}")
    elif schema.get("secondaryCategoryColumn"):
        summary_parts.append(f"والتوزيع المساند من {schema['secondaryCategoryColumn']}")
    elif schema.get("textColumn"):
        summary_parts.append(f"والتصنيف المشتق من النصوص في {schema['textColumn']}")

    findings = []
    if dashboard.get("cards"):
        lead_card = dashboard["cards"][0]
        findings.append(
            {
                "title": f"أهم مؤشر الآن: {lead_card.get('title')}",
                "detail": f"القيمة الأبرز هي {lead_card.get('actualDisplay')} مع مرجع {lead_card.get('referenceLabel')} = {lead_card.get('referenceValue')}.",
                "tone": lead_card.get("tone") or COLOR_TONES[0]["id"],
            }
        )

    if distribution_items:
        top_distribution = distribution_items[0]
        findings.append(
            {
                "title": f"التركيز الأعلى في {dashboard.get('distribution', {}).get('title', 'التوزيع')}",
                "detail": f"{top_distribution.get('label')} تمثل {percent_text(top_distribution.get('share'))} من القراءة الحالية.",
                "tone": top_distribution.get("tone") or COLOR_TONES[1]["id"],
            }
        )

    if ranking_items:
        top_ranking = ranking_items[0]
        findings.append(
            {
                "title": "العنصر الأكثر حضورًا",
                "detail": f"{top_ranking.get('label')} هو الأكثر بواقع {compact_number(top_ranking.get('value'))}.",
                "tone": top_ranking.get("tone") or COLOR_TONES[2]["id"],
            }
        )

    if len(trend_points) >= 2:
        first_value = safe_float(trend_points[0].get("primary")) or 0.0
        last_value = safe_float(trend_points[-1].get("primary")) or 0.0
        delta = last_value - first_value
        direction = "صاعد" if delta > 0 else ("هابط" if delta < 0 else "مستقر")
        findings.append(
            {
                "title": "اتجاه القراءة",
                "detail": f"الاتجاه العام {direction} من {trend_points[0].get('label')} إلى {trend_points[-1].get('label')}.",
                "tone": COLOR_TONES[3]["id"],
            }
        )

    for warning in warnings[:2]:
        findings.append(
            {
                "title": "ملاحظة تؤثر على الدقة",
                "detail": warning,
                "tone": COLOR_TONES[4]["id"],
            }
        )

    actions = []
    if quality_score < 75:
        actions.append("راجع الأعمدة ذات الاكتمال المنخفض قبل الاعتماد على النتائج النهائية.")
    if warnings:
        actions.append("ابدأ بمعالجة الملاحظات الظاهرة لأن بعضها يوقف لوحات كاملة حفاظًا على الدقة.")
    if distribution_items and safe_float(distribution_items[0].get("share")) and safe_float(distribution_items[0].get("share")) >= 50:
        actions.append("راجع سبب تركز النتائج في فئة واحدة لأنها قد تخفي التوزيع الحقيقي لبقية الحالات.")
    if field_quality_items:
        weakest_field = min(field_quality_items, key=lambda item: safe_float(item.get("value")) or 0.0)
        actions.append(
            f"أولوية جودة البيانات الآن: رفع اكتمال حقل {weakest_field.get('label')} لأنه الأضعف في الملف."
        )
    if not actions:
        actions.append("الملف في وضع جيد، ويمكن البدء بمراجعة الاتجاهات والفترات الأعلى مباشرة.")

    focus_items = [
        {
            "label": "حالة القراءة",
            "value": readiness_label,
            "detail": f"الجودة العامة {percent_text(quality_score)}",
        },
        {
            "label": "عدد الحقول المعتمدة",
            "value": compact_number(len(validation.get("detectedColumns", []))),
            "detail": "حقول تم اعتمادها في القراءة الحالية",
        },
    ]

    if distribution_items:
        focus_items.append(
            {
                "label": "الفئة الأقوى",
                "value": distribution_items[0].get("label"),
                "detail": percent_text(distribution_items[0].get("share")),
            }
        )
    elif ranking_items:
        focus_items.append(
            {
                "label": "الموضوع الأبرز",
                "value": ranking_items[0].get("label"),
                "detail": compact_number(ranking_items[0].get("value")),
            }
        )

    return {
        "headline": headline,
        "summary": "، ".join(summary_parts) + "." if summary_parts else "اعتمد النظام القراءة على أفضل الأعمدة المتاحة داخل الملف.",
        "findings": findings[:4],
        "actions": actions[:4],
        "focus": focus_items[:3],
    }


def build_powerbi_package(meta, schema, validation, dashboard):
    cards = dashboard.get("cards", [])
    trend = dashboard.get("trend", {})
    peak_chart = dashboard.get("peakChart", {})
    distribution = dashboard.get("distribution", {})
    comparison = dashboard.get("comparison", {})
    ranking = dashboard.get("ranking", {})
    average_chart = dashboard.get("averageChart", {})
    field_quality = dashboard.get("fieldQuality", {})

    summary_row = {
        "filename": meta.get("filename"),
        "sheet_name": meta.get("sheetName"),
        "row_count": meta.get("rowCount"),
        "column_count": meta.get("columnCount"),
        "header_row": meta.get("headerRow"),
        "sheet_score": meta.get("sheetScore"),
        "selection_score": meta.get("selectionScore"),
        "quality_score": validation.get("qualityScore"),
        "completeness_rate": validation.get("completenessRate"),
        "ready": validation.get("ready"),
        "needs_review": validation.get("needsReview"),
    }

    schema_rows = [
        {"field_role": "date", "column_name": schema.get("dateColumn")},
        {"field_role": "value", "column_name": schema.get("valueColumn")},
        {"field_role": "target", "column_name": schema.get("targetColumn")},
        {"field_role": "category", "column_name": schema.get("categoryColumn")},
        {"field_role": "secondary_category", "column_name": schema.get("secondaryCategoryColumn")},
        {"field_role": "entity", "column_name": schema.get("entityColumn")},
        {"field_role": "text", "column_name": schema.get("textColumn")},
    ]

    return {
        "packageVersion": 1,
        "tables": {
            "Summary": [summary_row],
            "Schema": [row for row in schema_rows if row["column_name"]],
            "Cards": [
                {
                    "title": card.get("title"),
                    "actual_display": card.get("actualDisplay"),
                    "actual_value": safe_float(card.get("actual")),
                    "reference_label": card.get("referenceLabel"),
                    "reference_value": card.get("referenceValue"),
                    "progress": safe_float(card.get("progress")),
                    "progress_display": card.get("progressDisplay"),
                    "tone": card.get("tone"),
                    "description": card.get("description"),
                    "priority": card.get("priority"),
                }
                for card in cards
            ],
            "Trend": [
                {
                    "period_label": point.get("label"),
                    "primary_value": safe_float(point.get("primary")),
                    "secondary_value": safe_float(point.get("secondary")),
                    "chart_title": trend.get("title"),
                }
                for point in trend.get("points", [])
            ],
            "PeakPeriods": [
                {
                    "period_label": point.get("label"),
                    "value": safe_float(point.get("primary")),
                    "chart_title": peak_chart.get("title"),
                }
                for point in peak_chart.get("points", [])
            ],
            "Distribution": [
                {
                    "label": item.get("label"),
                    "value": safe_float(item.get("value")),
                    "share": safe_float(item.get("share")),
                    "tone": item.get("tone"),
                    "chart_title": distribution.get("title"),
                }
                for item in distribution.get("items", [])
            ],
            "Comparison": [
                {
                    "label": point.get("label"),
                    "primary_value": safe_float(point.get("primary")),
                    "secondary_value": safe_float(point.get("secondary")),
                    "primary_label": comparison.get("primaryLabel"),
                    "secondary_label": comparison.get("secondaryLabel"),
                    "chart_title": comparison.get("title"),
                }
                for point in comparison.get("points", [])
            ],
            "Ranking": [
                {
                    "label": item.get("label"),
                    "value": safe_float(item.get("value")),
                    "share": safe_float(item.get("share")),
                    "tone": item.get("tone"),
                    "chart_title": ranking.get("title"),
                }
                for item in ranking.get("items", [])
            ],
            "AverageByPeriod": [
                {
                    "period_label": point.get("label"),
                    "average_value": safe_float(point.get("primary")),
                    "chart_title": average_chart.get("title"),
                }
                for point in average_chart.get("points", [])
            ],
            "FieldQuality": [
                {
                    "field_name": item.get("label"),
                    "completeness": safe_float(item.get("value")),
                    "tone": item.get("tone"),
                }
                for item in field_quality.get("items", [])
            ],
            "Warnings": [{"message": warning} for warning in validation.get("warnings", [])],
            "ColumnConfidence": [
                {"column_name": column_name, "confidence": safe_float(confidence)}
                for column_name, confidence in validation.get("columnConfidence", {}).items()
            ],
        },
    }


def build_analysis(dataframe, filename, sheet_name, preparation_meta=None):
    dataframe = dataframe.dropna(how="all").copy()
    profiles = profile_columns(dataframe)
    preparation_meta = preparation_meta or {}
    schema_selection = select_schema(profiles)
    schema_candidates = build_schema_candidates(profiles)
    preflight = build_preflight_report(dataframe, profiles)

    date_profile = schema_selection["date"]
    target_profile = schema_selection["target"]
    value_profile = schema_selection["value"]
    category_profile = schema_selection["category"]
    entity_profile = schema_selection["entity"]

    used_names = {profile["name"] for profile in [date_profile, target_profile, value_profile, category_profile, entity_profile] if profile}
    primary_text_profile = choose_primary_text_profile(profiles, used_names)
    derived_text_themes = (
        derive_text_themes(primary_text_profile["series"].astype(str).fillna(""))
        if primary_text_profile is not None
        else None
    )
    secondary_category = choose_secondary_category(profiles, used_names)
    auxiliary_category_series = None
    if secondary_category is not None:
        auxiliary_unique_count = int(secondary_category["series"].dropna().astype(str).nunique())
        if 2 <= auxiliary_unique_count <= 18:
            auxiliary_category_series = secondary_category["series"].astype(str).fillna("غير مصنف")

    warnings = []
    errors = []

    text_analysis_mode = value_profile is None and primary_text_profile is not None
    text_theme_mode = category_profile is None and derived_text_themes is not None
    auxiliary_category_mode = category_profile is None and auxiliary_category_series is not None

    if value_profile is None and not text_analysis_mode:
        warnings.append("لم يتم اعتماد عمود قيمة/مبلغ بثقة كافية، لذلك تم إيقاف اللوحات التي تعتمد على إجماليات مالية بدل تخمين عمود غير مؤكد.")
    if date_profile is None:
        warnings.append("لم يتم اعتماد عمود تاريخ بثقة كافية، لذلك تم إيقاف الرسوم الزمنية بدل عرض تسلسل قد يكون خاطئًا.")
    if category_profile is None and not text_theme_mode and not auxiliary_category_mode:
        warnings.append("لم يتم اعتماد عمود تصنيف/إدارة بثقة كافية، لذلك تم إيقاف لوحات التوزيع والتصنيفات بدل استخدام بدائل تقديرية.")
    if target_profile is None and any(profile["normalized"] in TARGET_ALIASES for profile in profiles):
        warnings.append("يوجد عمود يبدو كخطة/مستهدف، لكن دقته الرقمية أو اكتماله غير كافيين لاعتماده في المقارنة.")

    if dataframe.empty:
        errors.append("الملف لا يحتوي على صفوف صالحة بعد تنظيف البيانات.")
    if preparation_meta.get("headerRow", 1) > 1:
        warnings.append(f"تم اكتشاف عناوين الأعمدة من الصف {preparation_meta['headerRow']} بدل الصف الأول.")
    if preflight["duplicateRows"] >= max(5, int(preflight["rowCount"] * 0.02)):
        warnings.append("توجد صفوف متكررة بنسبة ملحوظة، وقد تؤثر على الإجماليات والتوزيعات إذا كانت تمثل نفس السجل أكثر من مرة.")
    if preflight["mixedTypeFields"]:
        warnings.append("تم رصد أعمدة مختلطة النوع بين النصوص والأرقام، لذلك قد يتم استبعاد بعض الحقول من الاعتماد الكامل حفاظًا على الدقة.")
    if preflight["lowCompletenessFields"]:
        warnings.append("توجد أعمدة منخفضة الاكتمال، وقد ينعكس ذلك على بعض اللوحات أو المقارنات.")
    if preflight["processingMode"] == "heavy":
        warnings.append("الملف كبير جدًا، لذلك تم تقديم الأعمدة الأعلى ثقة فقط لتقليل الانحراف في التحليل.")

    row_count = int(len(dataframe.index))
    column_count = int(len(dataframe.columns))
    value_series = value_profile["numeric_series"] if value_profile else None
    target_series = target_profile["numeric_series"] if target_profile else None
    date_series = date_profile["datetime_series"] if date_profile else None
    theme_series = derived_text_themes["series"].astype(str).fillna("أخرى") if derived_text_themes is not None else None
    distribution_series = category_profile["series"].astype(str).fillna("غير مصنف") if category_profile else None
    if distribution_series is None and auxiliary_category_series is not None:
        distribution_series = auxiliary_category_series
    if distribution_series is None and theme_series is not None:
        distribution_series = theme_series
    category_series = distribution_series
    entity_series = entity_profile["series"].astype(str).fillna("غير محدد") if entity_profile else None

    selected_profiles = [profile for profile in [date_profile, value_profile, category_profile, entity_profile, primary_text_profile] if profile]
    selected_completeness = [profile["non_null"] / row_count * 100 for profile in selected_profiles if row_count]
    completeness_rate = round(sum(selected_completeness) / len(selected_completeness), 1) if selected_completeness else 0.0
    quality_penalty = min(len(warnings) * 4.5, 16) + min(preflight["duplicateRatio"] * 0.08, 8)
    quality_signal = (completeness_rate * 0.58) + (preflight["score"] * 0.32)
    confidence_bonus = (18 if value_profile and date_profile else 8) + clamp(schema_selection["selectionScore"] / 240, 0, 0.12) * 100
    quality_score = min(
        max(round(quality_signal - quality_penalty + confidence_bonus, 1), 0),
        100,
    )

    total_value = safe_float(value_series.sum()) if value_profile else None
    average_value = safe_float(value_series.mean()) if value_profile else None
    median_value = safe_float(value_series.median()) if value_profile else None
    total_target = safe_float(target_series.sum()) if target_profile else None
    unique_entities = int(entity_series.nunique()) if entity_profile else (int(category_series.nunique()) if category_series is not None else row_count)
    category_count = int(category_series.nunique()) if category_series is not None else 0
    theme_count = int(theme_series.nunique()) if theme_series is not None else 0
    period_count = int(date_series.dropna().dt.to_period("M").nunique()) if date_series is not None and date_series.notna().sum() else 0
    value_coverage = round(value_series.notna().mean() * 100, 1) if value_profile and row_count else 0.0
    category_coverage = round(category_series.replace("nan", pd.NA).notna().mean() * 100, 1) if category_series is not None and row_count else 0.0
    target_progress = round((total_value / total_target) * 100, 1) if total_value is not None and total_target not in {None, 0} else 0.0
    analysis_ready = bool(value_profile or date_profile or category_profile or primary_text_profile)
    needs_review = bool(warnings) or not analysis_ready
    confidence_map = build_column_confidence(date_profile, value_profile, target_profile, category_profile, entity_profile, primary_text_profile)

    candidate_cards = []

    trend_chart = {"title": "اتجاه القراءة", "subtitle": "لا تتوفر بيانات كافية للرسم.", "points": [], "secondaryLabel": None}
    peak_chart = {"title": "أعلى الفترات", "subtitle": "لا تتوفر بيانات كافية للرسم.", "points": []}
    comparison_chart = {"title": "مقارنة القراءة", "subtitle": "لا تتوفر بيانات كافية للرسم.", "points": [], "primaryLabel": "القيمة", "secondaryLabel": "العدد"}
    average_chart = {"title": "المتوسط الدوري", "subtitle": "لا تتوفر بيانات كافية للرسم.", "points": []}

    if date_series is not None and date_series.notna().sum() >= 2:
        working = pd.DataFrame({"date": date_series})
        if value_series is not None:
            working["value"] = value_series
        working = working.dropna(subset=["date"])
        working["period"] = working["date"].dt.to_period("M").astype(str)

        if value_series is not None:
            grouped = (
                working.groupby("period")
                .agg(total=("value", "sum"), average=("value", "mean"), count=("date", "size"))
                .reset_index()
                .tail(8)
            )
            grouped["label"] = pd.to_datetime(grouped["period"]).dt.strftime("%b").str.upper()
            trend_chart = {
                "title": f"اتجاه {value_profile['name']}",
                "subtitle": "إجمالي القيمة خلال الفترات الزمنية المكتشفة.",
                "points": build_time_points(grouped, "label", "total", "count"),
                "secondaryLabel": "العدد",
            }
            peak_chart = {
                "title": "قمم الفترات",
                "subtitle": "أعلى الفترات حسب إجمالي القيمة.",
                "points": build_time_points(grouped.sort_values("total", ascending=False).head(5), "label", "total"),
            }
            comparison_chart = {
                "title": "القيمة مقابل عدد السجلات",
                "subtitle": "مقارنة بين الإجمالي والعدد لكل فترة.",
                "points": build_time_points(grouped, "label", "total", "count"),
                "primaryLabel": "القيمة",
                "secondaryLabel": "السجلات",
            }
            average_chart = {
                "title": "المتوسط لكل فترة",
                "subtitle": "المتوسط الحسابي للقيمة ضمن كل فترة.",
                "points": build_time_points(grouped, "label", "average"),
            }
        elif text_analysis_mode:
            grouped = working.groupby("period").agg(count=("date", "size")).reset_index().tail(8)
            grouped["label"] = pd.to_datetime(grouped["period"]).dt.strftime("%b").str.upper()
            trend_chart = {
                "title": "اتجاه النصوص",
                "subtitle": "حجم السجلات النصية خلال الفترات المكتشفة.",
                "points": build_time_points(grouped, "label", "count"),
                "secondaryLabel": None,
            }
            peak_chart = {
                "title": "أكثر الفترات نشاطًا",
                "subtitle": "الفترات الأعلى من حيث عدد السجلات النصية.",
                "points": build_time_points(grouped.sort_values("count", ascending=False).head(5), "label", "count"),
            }
            comparison_chart = {
                "title": "عدد السجلات عبر الفترات",
                "subtitle": "مقارنة حجم الإدخالات النصية عبر الزمن.",
                "points": build_time_points(grouped, "label", "count"),
                "primaryLabel": "السجلات",
                "secondaryLabel": None,
            }
            average_chart = {
                "title": "المتوسط الدوري",
                "subtitle": "متوسط القراءة الدورية للسجلات النصية.",
                "points": build_time_points(grouped, "label", "count"),
            }
    distribution_chart = {"title": "التوزيع", "subtitle": "لا يوجد عمود تصنيف واضح.", "items": [], "total": 0}
    ranking_panel = {"title": "أعلى التصنيفات", "subtitle": "لا يوجد عمود تصنيف واضح.", "items": []}
    radar_panel = {"title": "بصمة المؤشرات", "subtitle": "لا يوجد عمود تصنيف واضح.", "items": []}

    distribution_items = []
    distribution_total = 0.0
    if distribution_series is not None and distribution_series.notna().sum() >= 2:
        grouping_frame = pd.DataFrame({"category": distribution_series})
        if value_series is not None:
            grouping_frame["value"] = value_series
            grouped_category = (
                grouping_frame.groupby("category")
                .agg(total=("value", "sum"), count=("category", "size"))
                .sort_values("total", ascending=False)
            )
            distribution_total = safe_float(grouped_category["total"].sum()) or 0.0
            distribution_items = [
                {
                    "label": str(label),
                    "value": safe_float(row["total"]) or 0.0,
                    "share": round(((safe_float(row["total"]) or 0.0) / distribution_total) * 100, 1) if distribution_total else 0.0,
                }
                for label, row in grouped_category.head(6).iterrows()
            ]
        else:
            grouped_category = grouping_frame.groupby("category").agg(count=("category", "size")).sort_values("count", ascending=False)
            distribution_total = safe_float(grouped_category["count"].sum()) or 0.0
            distribution_items = [
                {
                    "label": str(label),
                    "value": safe_float(row["count"]) or 0.0,
                    "share": round(((safe_float(row["count"]) or 0.0) / distribution_total) * 100, 1) if distribution_total else 0.0,
                }
                for label, row in grouped_category.head(6).iterrows()
            ]

    theme_items = []
    theme_total = 0.0
    if theme_series is not None and theme_series.notna().sum() >= 2:
        theme_grouped = (
            pd.DataFrame({"theme": theme_series})
            .groupby("theme")
            .agg(count=("theme", "size"))
            .sort_values("count", ascending=False)
        )
        theme_total = safe_float(theme_grouped["count"].sum()) or 0.0
        theme_items = [
            {
                "label": str(label),
                "value": safe_float(row["count"]) or 0.0,
                "share": round(((safe_float(row["count"]) or 0.0) / theme_total) * 100, 1) if theme_total else 0.0,
            }
            for label, row in theme_grouped.head(6).iterrows()
        ]

    if distribution_items:
        for index, item in enumerate(distribution_items):
            tone = COLOR_TONES[index % len(COLOR_TONES)]
            item["tone"] = tone["id"]
            item["color"] = tone["accent"]

        distribution_chart = {
            "title": category_profile["name"] if category_profile else (secondary_category["name"] if auxiliary_category_mode and secondary_category else "الموضوعات"),
            "subtitle": (
                "حصة كل تصنيف من إجمالي القراءة الحالية."
                if value_series is not None
                else (
                    "توزيع الحقول التنظيمية المساندة داخل الملف."
                    if auxiliary_category_mode
                    else ("توزيع الموضوعات المستخرجة من النصوص." if text_theme_mode else "حصة كل تصنيف من إجمالي القراءة الحالية.")
                )
            ),
            "items": distribution_items[:5],
            "total": distribution_total,
        }

    ranking_source_items = theme_items or distribution_items
    if ranking_source_items:
        for index, item in enumerate(ranking_source_items):
            tone = COLOR_TONES[index % len(COLOR_TONES)]
            item["tone"] = tone["id"]
            item["color"] = tone["accent"]

        ranking_panel = {
            "title": "أعلى التصنيفات" if not text_theme_mode else "أبرز الموضوعات",
            "subtitle": (
                "التصنيفات الأعلى أداءً أو كثافةً في الملف."
                if not text_theme_mode and not auxiliary_category_mode
                else ("الموضوعات الأكثر حضورًا داخل السجلات النصية." if text_theme_mode else "أكثر القيم التنظيمية حضورًا داخل الملف.")
            ),
            "items": ranking_source_items[:5],
        }
        radar_panel = {
            "title": "بصمة التصنيفات" if not text_theme_mode else "بصمة الموضوعات",
            "subtitle": (
                "قراءة نسبية لأعلى التصنيفات المكتشفة."
                if not text_theme_mode and not auxiliary_category_mode
                else ("بصمة نسبية للموضوعات المستخرجة من النصوص." if text_theme_mode else "بصمة نسبية للقيم التنظيمية داخل الملف.")
            ),
            "items": ranking_source_items[:5],
        }

    candidate_cards.append(
        make_indicator_card(
            title="السجلات",
            actual=row_count,
            actual_display=compact_number(row_count),
            reference_label="الأعمدة",
            reference_value=compact_number(column_count),
            progress=completeness_rate,
            progress_display=percent_text(completeness_rate),
            tone=COLOR_TONES[0]["id"],
            description="عدد الصفوف التي دخلت فعليًا في القراءة بعد تنظيف الملف.",
            priority=80,
        )
    )

    if value_profile is not None:
        candidate_cards.append(
            make_indicator_card(
                title=value_profile["name"],
                actual=total_value,
                actual_display=compact_number(total_value),
                reference_label="المتوسط",
                reference_value=compact_number(average_value),
                progress=value_coverage,
                progress_display=percent_text(value_coverage),
                tone=COLOR_TONES[1]["id"],
                description="إجمالي القيمة المعتمدة من العمود المالي المكتشف داخل الملف.",
                priority=100,
            )
        )

    if value_profile is not None and total_target not in {None, 0}:
        candidate_cards.append(
            make_indicator_card(
                title="مستوى الإنجاز",
                actual=target_progress,
                actual_display=percent_text(target_progress),
                reference_label="المستهدف",
                reference_value=compact_number(total_target),
                progress=target_progress,
                progress_display=percent_text(target_progress),
                tone=COLOR_TONES[4]["id"],
                description="نسبة التقدم بين القيمة الحالية والمستهدف الموجود في الملف.",
                priority=99,
            )
        )

    if distribution_chart["items"]:
        top_distribution = distribution_chart["items"][0]
        candidate_cards.append(
            make_indicator_card(
                title=f"الأكثر في {distribution_chart['title']}",
                actual=top_distribution["value"],
                actual_display=top_distribution["label"],
                reference_label="الحصة",
                reference_value=percent_text(top_distribution["share"]),
                progress=top_distribution["share"],
                progress_display=percent_text(top_distribution["share"]),
                tone=top_distribution.get("tone", COLOR_TONES[5]["id"]),
                description="أكثر فئة حضورًا في التوزيع الرئيسي الحالي.",
                priority=97 if not value_profile else 95,
            )
        )

    if ranking_panel["items"]:
        top_ranking = ranking_panel["items"][0]
        candidate_cards.append(
            make_indicator_card(
                title="أكثر موضوع تكرارًا" if text_theme_mode else "العنصر الأعلى",
                actual=top_ranking["value"],
                actual_display=top_ranking["label"],
                reference_label="الحضور",
                reference_value=percent_text(top_ranking["share"]),
                progress=top_ranking["share"],
                progress_display=percent_text(top_ranking["share"]),
                tone=top_ranking.get("tone", COLOR_TONES[2]["id"]),
                description="العنصر الأوضح داخل القراءة الحالية بناءً على أعلى حضور نسبي.",
                priority=96 if text_theme_mode else 89,
            )
        )

    if peak_chart["points"]:
        top_peak = peak_chart["points"][0]
        peak_value = top_peak.get("primary")
        candidate_cards.append(
            make_indicator_card(
                title="الفترة الأبرز",
                actual=peak_value,
                actual_display=top_peak["label"],
                reference_label="القيمة",
                reference_value=compact_number(peak_value),
                progress=100 if peak_value is not None else 0,
                progress_display=percent_text(100 if peak_value is not None else 0),
                tone=COLOR_TONES[0]["id"],
                description="الفترة الأعلى ظهورًا أو أداءً داخل القراءة الزمنية.",
                priority=94 if period_count else 0,
            )
        )

    if text_theme_mode:
        candidate_cards.append(
            make_indicator_card(
                title="الموضوعات المستخرجة",
                actual=theme_count,
                actual_display=compact_number(theme_count),
                reference_label="المصدر",
                reference_value=primary_text_profile["name"] if primary_text_profile else "النص",
                progress=quality_score,
                progress_display=percent_text(quality_score),
                tone=COLOR_TONES[2]["id"],
                description="عدد الموضوعات التي أمكن استخلاصها من النصوص المتكررة.",
                priority=93,
            )
        )

    if entity_profile is not None:
        candidate_cards.append(
            make_indicator_card(
                title=entity_profile["name"],
                actual=unique_entities,
                actual_display=compact_number(unique_entities),
                reference_label="النوع",
                reference_value="فريد",
                progress=quality_score,
                progress_display=percent_text(quality_score),
                tone=COLOR_TONES[2]["id"],
                description="عدد الكيانات الفريدة المكتشفة في العمود الأنسب للأسماء أو المعرفات.",
                priority=87,
            )
        )

    if quality_score < 95 or warnings:
        candidate_cards.append(
            make_indicator_card(
                title="جودة القراءة",
                actual=quality_score,
                actual_display=percent_text(quality_score),
                reference_label="اكتمال الحقول",
                reference_value=percent_text(completeness_rate),
                progress=quality_score,
                progress_display=percent_text(quality_score),
                tone=COLOR_TONES[3]["id"],
                description="مدى وضوح الملف واكتمال حقوله بالنسبة للتحليل الحالي.",
                priority=92,
            )
        )

    if preflight["score"] < 96 or preflight["duplicateRows"] > 0:
        candidate_cards.append(
            make_indicator_card(
                title="سلامة الملف",
                actual=preflight["score"],
                actual_display=percent_text(preflight["score"]),
                reference_label="الصفوف المكررة",
                reference_value=compact_number(preflight["duplicateRows"]),
                progress=preflight["score"],
                progress_display=percent_text(preflight["score"]),
                tone=COLOR_TONES[4]["id"],
                description="تقيس اكتمال الأعمدة ونظافة الصفوف واستقرار أنواع البيانات قبل الاعتماد على النتائج.",
                priority=98 if preflight["score"] < 85 else 91,
            )
        )

    cards = sorted(candidate_cards, key=lambda card: (card["priority"], card["progress"], card["actual"] or 0), reverse=True)[:4]

    field_quality_items = calculate_field_quality(dataframe)[:6]
    for index, item in enumerate(field_quality_items):
        tone = COLOR_TONES[index % len(COLOR_TONES)]
        item["tone"] = tone["id"]
        item["color"] = tone["accent"]

    ring_metric = {
        "title": "ثقة التحليل",
        "value": quality_score,
        "display": percent_text(quality_score),
        "subtitle": "تعتمد على اكتمال الحقول الأساسية ووضوح القراءة العامة للملف.",
        "tone": COLOR_TONES[1]["id"],
    }

    schema = {
        "dateColumn": date_profile["name"] if date_profile else None,
        "valueColumn": value_profile["name"] if value_profile else None,
        "targetColumn": target_profile["name"] if target_profile else None,
        "categoryColumn": category_profile["name"] if category_profile else None,
        "secondaryCategoryColumn": secondary_category["name"] if secondary_category else None,
        "entityColumn": entity_profile["name"] if entity_profile else None,
        "textColumn": primary_text_profile["name"] if primary_text_profile else None,
    }

    if errors:
        raise ValueError(" ".join(errors))

    return {
        "meta": {
            "filename": filename,
            "sheetName": sheet_name,
            "rowCount": row_count,
            "columnCount": column_count,
            "headerRow": preparation_meta.get("headerRow", 1),
            "sheetScore": preparation_meta.get("sheetScore"),
            "selectionScore": round(schema_selection["selectionScore"], 1) if schema_selection["selectionScore"] != float("-inf") else None,
        },
        "schema": schema,
        "validation": {
            "qualityScore": quality_score,
            "completenessRate": completeness_rate,
            "ready": analysis_ready,
            "needsReview": needs_review,
            "warnings": warnings,
            "errors": errors,
            "detectedColumns": [column for column in schema.values() if column],
            "columnConfidence": confidence_map,
            "schemaCandidates": schema_candidates,
            "preflight": preflight,
        },
        "dashboard": {
            "cards": cards,
            "trend": trend_chart,
            "ringMetric": ring_metric,
            "peakChart": peak_chart,
            "distribution": distribution_chart,
            "comparison": comparison_chart,
            "radar": radar_panel,
            "ranking": ranking_panel,
            "averageChart": average_chart,
            "fieldQuality": {
                "title": "اكتمال الحقول",
                "subtitle": "نسبة امتلاء أهم الحقول في الملف.",
                "items": field_quality_items,
            },
        },
        "assistant": build_analysis_assistant(
            {
                "filename": filename,
                "sheetName": sheet_name,
                "rowCount": row_count,
                "columnCount": column_count,
                "headerRow": preparation_meta.get("headerRow", 1),
                "sheetScore": preparation_meta.get("sheetScore"),
                "selectionScore": round(schema_selection["selectionScore"], 1) if schema_selection["selectionScore"] != float("-inf") else None,
            },
            schema,
            {
                "qualityScore": quality_score,
                "completenessRate": completeness_rate,
                "ready": analysis_ready,
                "needsReview": needs_review,
                "warnings": warnings,
                "errors": errors,
                "detectedColumns": [column for column in schema.values() if column],
                "columnConfidence": confidence_map,
                "schemaCandidates": schema_candidates,
                "preflight": preflight,
            },
            {
                "cards": cards,
                "trend": trend_chart,
                "ringMetric": ring_metric,
                "peakChart": peak_chart,
                "distribution": distribution_chart,
                "comparison": comparison_chart,
                "radar": radar_panel,
                "ranking": ranking_panel,
                "averageChart": average_chart,
                "fieldQuality": {
                    "title": "اكتمال الحقول",
                    "subtitle": "نسبة امتلاء أهم الحقول في الملف.",
                    "items": field_quality_items,
                },
            },
        ),
        "powerBi": build_powerbi_package(
            {
                "filename": filename,
                "sheetName": sheet_name,
                "rowCount": row_count,
                "columnCount": column_count,
                "headerRow": preparation_meta.get("headerRow", 1),
                "sheetScore": preparation_meta.get("sheetScore"),
                "selectionScore": round(schema_selection["selectionScore"], 1) if schema_selection["selectionScore"] != float("-inf") else None,
            },
            schema,
            {
                "qualityScore": quality_score,
                "completenessRate": completeness_rate,
                "ready": analysis_ready,
                "needsReview": needs_review,
                "warnings": warnings,
                "errors": errors,
                "detectedColumns": [column for column in schema.values() if column],
                "columnConfidence": confidence_map,
                "schemaCandidates": schema_candidates,
                "preflight": preflight,
            },
            {
                "cards": cards,
                "trend": trend_chart,
                "ringMetric": ring_metric,
                "peakChart": peak_chart,
                "distribution": distribution_chart,
                "comparison": comparison_chart,
                "radar": radar_panel,
                "ranking": ranking_panel,
                "averageChart": average_chart,
                "fieldQuality": {
                    "title": "اكتمال الحقول",
                    "subtitle": "نسبة امتلاء أهم الحقول في الملف.",
                    "items": field_quality_items,
                },
            },
        ),
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit("Usage: analyze_indicators.py <file_path> <original_filename>")

    file_path = Path(sys.argv[1])
    original_filename = sys.argv[2]
    dataframe, sheet_name, preparation_meta = load_dataframe(file_path)
    analysis = build_analysis(dataframe, original_filename, sheet_name, preparation_meta)
    print(json.dumps(analysis, ensure_ascii=False))


if __name__ == "__main__":
    main()

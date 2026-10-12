
import io
import os
import re

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, Response
from flask_cors import CORS


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

CORS(
    app,
    expose_headers=[
        "X-Original-Rows",
        "X-Cleaned-Rows",
        "X-Original-Missing",
        "X-Remaining-Missing",
        "X-Original-Duplicates",
        "X-Remaining-Duplicates",
        "X-Cleaning-Method",
        "X-Duplicates-Removed",
        "X-Original-Quality",
        "X-Cleaned-Quality",
        "X-Original-Completeness",
        "X-Cleaned-Completeness",
        "X-Original-Uniqueness",
        "X-Cleaned-Uniqueness",
        "X-Original-Consistency",
        "X-Cleaned-Consistency",
    ],
)


# ---------------------------------------------------------
# General helpers
# ---------------------------------------------------------

def make_json_safe(value):
    """Convert NumPy and Pandas values into JSON-safe values."""
    if isinstance(value, dict):
        return {str(k): make_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple)):
        return [make_json_safe(v) for v in value]

    if isinstance(value, np.integer):
        return int(value)

    if isinstance(value, np.floating):
        return float(value) if np.isfinite(value) else None

    if isinstance(value, np.bool_):
        return bool(value)

    if value is None or value is pd.NA or value is pd.NaT:
        return None

    if isinstance(value, (float, np.float64)) and not np.isfinite(value):
        return None

    if isinstance(value, pd.Timestamp):
        return value.isoformat()

    return value


def read_csv_file(file_storage):
    """Read and validate an uploaded CSV."""
    if not file_storage or not file_storage.filename:
        raise ValueError("Please select a CSV file.")

    if not file_storage.filename.lower().endswith(".csv"):
        raise ValueError("Only CSV files are supported.")

    content = file_storage.read()

    if not content:
        raise ValueError("The uploaded file is empty.")

    try:
        df = pd.read_csv(io.BytesIO(content))
    except UnicodeDecodeError:
        raise ValueError(
            "Unable to read this file's encoding. Save it as UTF-8 CSV."
        )
    except pd.errors.EmptyDataError:
        raise ValueError("The CSV file contains no readable columns.")
    except pd.errors.ParserError:
        raise ValueError("The CSV format is invalid. Please check the file.")

    if len(df.columns) == 0:
        raise ValueError("The CSV file has no columns.")

    if len(df) == 0:
        raise ValueError(
            "The CSV contains column headers but no data rows."
        )

    if df.columns.duplicated().any():
        raise ValueError("The CSV contains duplicate column names.")

    return df


def count_missing(df):
    return int(df.isna().sum().sum())


def count_duplicates(df):
    # Counts repeated rows after their first occurrence.
    return int(df.duplicated().sum())


def percentage(numerator, denominator):
    if denominator == 0:
        return 0.0
    return round(float(numerator) / float(denominator) * 100, 2)


# ---------------------------------------------------------
# Quality metrics
# ---------------------------------------------------------

def calculate_quality_score(df):
    """
    Project-defined quality score:
    100 - missing-cell percentage - duplicate-row percentage.

    This is a simple project metric, not a universal standard.
    """
    total_cells = int(df.shape[0] * df.shape[1])

    if total_cells == 0 or len(df) == 0:
        return 0.0

    missing_penalty = percentage(count_missing(df), total_cells)
    duplicate_penalty = percentage(count_duplicates(df), len(df))

    return round(
        max(0.0, min(100.0, 100 - missing_penalty - duplicate_penalty)),
        2,
    )


def numeric_candidate(series):
    """
    Return cleaned text and numeric conversion for a possible
    numeric-like column.

    Commas and a trailing percent sign are accepted for parsing.
    Values such as 'unknown' remain invalid.
    """
    text = series.dropna().astype(str).str.strip()

    cleaned = (
        text.str.replace(",", "", regex=False)
        .str.replace(r"%$", "", regex=True)
    )

    numeric = pd.to_numeric(cleaned, errors="coerce")
    return text, numeric


def build_smart_metrics(df):
    """
    Completeness:
        Non-missing cells / all cells * 100.

    Uniqueness:
        Rows remaining after exact duplicate removal / all rows * 100.
        The first occurrence of a repeated row is retained.

    Consistency:
        For each numeric-like text column, count every non-missing value
        as a validation check. A value passes if it parses as a finite
        number after supported formatting is removed.

        A text column is treated as numeric-like when at least 50% of
        its non-missing values are numeric-parsable. This heuristic may
        not suit identifiers, phone numbers, or other domain-specific
        fields, so results should be reviewed.
    """
    rows, column_count = df.shape
    total_cells = int(rows * column_count)
    missing = count_missing(df)
    duplicate_rows = count_duplicates(df)

    completeness = percentage(total_cells - missing, total_cells)
    uniqueness = percentage(rows - duplicate_rows, rows)

    issues = []
    total_checks = 0
    passed_checks = 0
    numeric_like_columns = 0

    for column in df.columns:
        series = df[column]
        non_missing = series.dropna()

        if non_missing.empty:
            continue

        text, numeric = numeric_candidate(non_missing)

        parseable_mask = numeric.notna() & np.isfinite(
            numeric.fillna(0).astype(float)
        )
        parseable_count = int(parseable_mask.sum())
        value_count = len(non_missing)

        # A column is numeric-like if at least half its values
        # can be interpreted as numbers.
        is_numeric_dtype = pd.api.types.is_numeric_dtype(series)
        is_numeric_like = (
            is_numeric_dtype
            or parseable_count / value_count >= 0.5
        )

        if is_numeric_like:
            numeric_like_columns += 1
            invalid_count = int((~parseable_mask).sum())

            total_checks += value_count
            passed_checks += value_count - invalid_count

            if invalid_count:
                invalid_examples = (
                    text.loc[~parseable_mask].head(5).tolist()
                )

                issues.append({
                    "column": str(column),
                    "issue": "Invalid numeric values",
                    "details": (
                        "Some non-missing values could not be parsed "
                        "as finite numbers."
                    ),
                    "count": invalid_count,
                    "examples": invalid_examples,
                })

    consistency = (
        percentage(passed_checks, total_checks)
        if total_checks
        else 100.0
    )

    return {
        "completeness": completeness,
        "uniqueness": uniqueness,
        "consistency": consistency,
        "consistency_checks": total_checks,
        "consistency_checks_passed": passed_checks,
        "consistency_issues": issues,
        "numeric_like_columns": numeric_like_columns,
        "consistency_note": (
            "Consistency checks validate numeric-like columns only. "
            "A column is considered numeric-like when at least 50% of "
            "its non-missing values parse as numbers. This heuristic "
            "does not validate every business rule or text field."
        ),
    }


# ---------------------------------------------------------
# Column profile and outliers
# ---------------------------------------------------------

def build_column_quality(df):
    results = []
    total = len(df)

    for column in df.columns:
        series = df[column]
        missing = int(series.isna().sum())
        unique = int(series.nunique(dropna=True))

        results.append({
            "column": str(column),
            "dtype": str(series.dtype),
            "total": total,
            "missing": missing,
            "missing_percent": percentage(missing, total),
            "unique": unique,
            "duplicate_values": max(0, total - missing - unique),
        })

    return results


def build_outlier_results(df):
    results = []

    for column in df.columns:
        series = pd.to_numeric(df[column], errors="coerce").dropna()

        if len(series) < 4:
            continue

        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1

        if iqr == 0:
            continue

        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        count = int(((series < lower) | (series > upper)).sum())

        results.append({
            "column": str(column),
            "outlier_count": count,
            "lower_bound": round(lower, 4),
            "upper_bound": round(upper, 4),
            "outlier_percent": percentage(count, len(series)),
        })

    return results


# ---------------------------------------------------------
# Recommendations
# ---------------------------------------------------------

def build_cleaning_suggestions(df):
    suggestions = []

    for column in df.columns:
        series = df[column]
        missing = int(series.isna().sum())

        if missing:
            if pd.api.types.is_numeric_dtype(series):
                recommendation = (
                    "Compare mean and median imputation. Median is often "
                    "less sensitive to extreme values."
                )
            else:
                recommendation = (
                    "Review missing values. Consider mode imputation "
                    "for suitable categorical data, or manual review."
                )

            suggestions.append({
                "column": str(column),
                "issue": "Missing values",
                "count": missing,
                "priority": "High" if missing / len(df) >= 0.2 else "Medium",
                "suggestion": recommendation,
            })

    duplicates = count_duplicates(df)

    if duplicates:
        suggestions.append({
            "column": "All columns",
            "issue": "Duplicate rows",
            "count": duplicates,
            "priority": "Medium",
            "suggestion": (
                "Inspect repeated rows before removal. Confirm that "
                "repeated records are not valid transactions or events."
            ),
        })

    metrics = build_smart_metrics(df)

    for issue in metrics["consistency_issues"]:
        suggestions.append({
            "column": issue["column"],
            "issue": issue["issue"],
            "count": issue["count"],
            "priority": "High",
            "suggestion": (
                "Inspect the example values and correct or standardise "
                "invalid entries before analysis."
            ),
        })

    for item in build_outlier_results(df):
        if item["outlier_count"]:
            suggestions.append({
                "column": item["column"],
                "issue": "Potential outliers",
                "count": item["outlier_count"],
                "priority": "Review",
                "suggestion": (
                    "Review values outside the IQR bounds. An outlier "
                    "may be valid and should not be removed automatically."
                ),
            })

    if not suggestions:
        suggestions.append({
            "column": "Entire dataset",
            "issue": "No major issues detected",
            "count": 0,
            "priority": "Info",
            "suggestion": (
                "The implemented checks found no missing values, exact "
                "duplicate rows, numeric consistency issues, or IQR "
                "outliers. This does not guarantee error-free data."
            ),
        })

    return suggestions


# ---------------------------------------------------------
# Analysis response
# ---------------------------------------------------------

def build_analysis(df):
    metrics = build_smart_metrics(df)

    preview_df = df.head(10).astype(object).where(
        pd.notna(df.head(10)), None
    )

    return {
        "filename": None,
        "rows": int(df.shape[0]),
        "columns": int(df.shape[1]),
        "column_names": [str(column) for column in df.columns],
        "missing_values": count_missing(df),
        "duplicate_rows": count_duplicates(df),
        "quality_score": calculate_quality_score(df),
        "column_quality": build_column_quality(df),
        "outliers": build_outlier_results(df),
        "cleaning_suggestions": build_cleaning_suggestions(df),
        "smart_metrics": metrics,
        "preview": make_json_safe(
            preview_df.to_dict(orient="records")
        ),
    }


def get_cleaning_summary(original, cleaned, method, duplicates_removed):
    original_metrics = build_smart_metrics(original)
    cleaned_metrics = build_smart_metrics(cleaned)

    return {
        "original_rows": int(len(original)),
        "cleaned_rows": int(len(cleaned)),
        "original_missing": count_missing(original),
        "remaining_missing": count_missing(cleaned),
        "original_duplicates": count_duplicates(original),
        "remaining_duplicates": count_duplicates(cleaned),
        "original_quality": calculate_quality_score(original),
        "cleaned_quality": calculate_quality_score(cleaned),
        "original_completeness": original_metrics["completeness"],
        "cleaned_completeness": cleaned_metrics["completeness"],
        "original_uniqueness": original_metrics["uniqueness"],
        "cleaned_uniqueness": cleaned_metrics["uniqueness"],
        "original_consistency": original_metrics["consistency"],
        "cleaned_consistency": cleaned_metrics["consistency"],
        "cleaning_method": method,
        "duplicates_removed": duplicates_removed,
    }


# ---------------------------------------------------------
# Routes
# ---------------------------------------------------------

@app.get("/")
def home():
    return jsonify({
        "message": "Welcome to DataLens API",
        "status": "running",
    })


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "DataLens backend",
    })


@app.post("/api/upload")
def upload_csv():
    try:
        uploaded_file = request.files.get("file")
        df = read_csv_file(uploaded_file)

        result = build_analysis(df)
        result["filename"] = uploaded_file.filename

        return jsonify(make_json_safe(result))

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Unexpected error while analysing CSV")
        return jsonify({
            "error": "An unexpected error occurred while analysing the CSV."
        }), 500


@app.post("/api/clean")
def clean_csv():
    try:
        uploaded_file = request.files.get("file")
        original = read_csv_file(uploaded_file)
        cleaned = original.copy()

        method = request.form.get("method", "median").lower().strip()
        duplicate_value = (
            request.form.get("remove_duplicates", "false")
            .lower()
            .strip()
        )

        if method not in {"median", "mean", "mode", "none"}:
            return jsonify({
                "error": (
                    "Invalid cleaning method. Use median, mean, mode, or none."
                )
            }), 400

        if duplicate_value not in {
            "true", "false", "1", "0", "yes", "no"
        }:
            return jsonify({
                "error": "remove_duplicates must be true or false."
            }), 400

        remove_duplicates = duplicate_value in {"true", "1", "yes"}

        if method in {"median", "mean"}:
            for column in cleaned.select_dtypes(include="number").columns:
                if not cleaned[column].isna().any():
                    continue

                fill_value = (
                    cleaned[column].median()
                    if method == "median"
                    else cleaned[column].mean()
                )

                if pd.notna(fill_value):
                    cleaned[column] = cleaned[column].fillna(fill_value)

        elif method == "mode":
            for column in cleaned.columns:
                if cleaned[column].isna().any():
                    modes = cleaned[column].mode(dropna=True)

                    if not modes.empty:
                        cleaned[column] = cleaned[column].fillna(
                            modes.iloc[0]
                        )

        before_duplicates = count_duplicates(cleaned)

        if remove_duplicates:
            cleaned = cleaned.drop_duplicates().reset_index(drop=True)

        duplicates_removed = before_duplicates - count_duplicates(cleaned)

        summary = get_cleaning_summary(
            original,
            cleaned,
            method,
            duplicates_removed,
        )

        output = io.StringIO()
        cleaned.to_csv(output, index=False)

        response = Response(output.getvalue(), mimetype="text/csv")
        response.headers["Content-Disposition"] = (
            'attachment; filename="datalens_cleaned.csv"'
        )

        header_map = {
            "original_rows": "X-Original-Rows",
            "cleaned_rows": "X-Cleaned-Rows",
            "original_missing": "X-Original-Missing",
            "remaining_missing": "X-Remaining-Missing",
            "original_duplicates": "X-Original-Duplicates",
            "remaining_duplicates": "X-Remaining-Duplicates",
            "cleaning_method": "X-Cleaning-Method",
            "duplicates_removed": "X-Duplicates-Removed",
            "original_quality": "X-Original-Quality",
            "cleaned_quality": "X-Cleaned-Quality",
            "original_completeness": "X-Original-Completeness",
            "cleaned_completeness": "X-Cleaned-Completeness",
            "original_uniqueness": "X-Original-Uniqueness",
            "cleaned_uniqueness": "X-Cleaned-Uniqueness",
            "original_consistency": "X-Original-Consistency",
            "cleaned_consistency": "X-Cleaned-Consistency",
        }

        for key, header in header_map.items():
            response.headers[header] = str(summary[key])

        return response

    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        app.logger.exception("Unexpected error while cleaning CSV")
        return jsonify({
            "error": "An unexpected error occurred while cleaning the CSV."
        }), 500


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({
        "error": "File is too large. Please upload a CSV under 16 MB."
    }), 413


if __name__ == "__main__":
    debug_mode = (
        os.getenv("DATALENS_ENV", "development").lower() == "development"
    )
    app.run(host="127.0.0.1", port=5000, debug=debug_mode)

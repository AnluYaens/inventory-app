#!/usr/bin/env python3
"""
Extract staged catalog rows from PDF for manual review and recataloging.

Output columns:
- source_page
- column
- order_in_column
- category
- reference_number
- name_raw
- size
- price
- image_hint
- confidence
- parse_mode
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Any

import pdfplumber


SIZE_TOKEN_PATTERN = re.compile(
    r"\b(?:\d{2}|XS|S|M|L|XL|XXL|XXXL|UNICA|U)\b",
    flags=re.IGNORECASE,
)

PRODUCT_WITH_SIZE_PATTERN = re.compile(
    r"(?:Tallas?:\s*(?P<sizes_a>[A-Za-z0-9,\s/.-]+?)\s*\$(?P<price_a>\d+(?:\.\d{2})?)|"
    r"\$(?P<price_b>\d+(?:\.\d{2})?)\s*Tallas?:\s*(?P<sizes_b>[A-Za-z0-9,\s/.-]+?))",
    flags=re.IGNORECASE,
)

PRICE_PATTERN = re.compile(r"\$(?P<price>\d+(?:\.\d{2})?)")
REFERENCE_PAREN_PATTERN = re.compile(r"\(([^)]+)\)")
REFERENCE_FALLBACK_PATTERN = re.compile(r"\b\d{6,}\b")
PAGE_REFERENCE_PATTERN = re.compile(r"\(([^)]+)\)")


def clean_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_category_marker(raw: str) -> str:
    token = clean_spaces(raw)
    token = re.sub(r"[^A-Za-z\-]", "", token).upper()
    if not token:
        return "Sin categoria"
    parts = [p[::-1] for p in token.split("-") if p]
    return (" ".join(parts) or "Sin categoria").title()


def looks_like_category_marker(word: dict[str, Any]) -> bool:
    text = word.get("text", "")
    return (
        not word.get("upright", True)
        and len(text) >= 4
        and bool(re.fullmatch(r"[A-Z\-]+", text))
    )


def detect_page_category(words: list[dict[str, Any]]) -> str:
    markers = [w for w in words if looks_like_category_marker(w)]
    if not markers:
        return "Sin categoria"
    markers.sort(key=lambda w: w.get("height", 0), reverse=True)
    return normalize_category_marker(markers[0]["text"])


def extract_column_text(page: pdfplumber.page.Page, column: str) -> str:
    words = [w for w in page.extract_words() if w.get("upright", True)]
    midpoint = page.width / 2
    if column == "left":
        selected = [w for w in words if float(w["x0"]) < midpoint]
    else:
        selected = [w for w in words if float(w["x0"]) >= midpoint]
    selected.sort(key=lambda w: (round(float(w["top"]), 1), float(w["x0"])))
    return clean_spaces(" ".join(w["text"] for w in selected))


def parse_sizes(raw: str) -> list[str]:
    if not raw:
        return ["UNICA"]
    cleaned = clean_spaces(raw).upper().replace(" Y ", ",")
    tokens = SIZE_TOKEN_PATTERN.findall(cleaned)
    if not tokens:
        return ["UNICA"]
    normalized: list[str] = []
    for token in tokens:
        upper = token.upper()
        normalized.append("UNICA" if upper == "U" else upper)
    return normalized


def extract_reference_number(text: str) -> str:
    paren = REFERENCE_PAREN_PATTERN.findall(text)
    if paren:
        candidate = clean_spaces(paren[-1])
        candidate = re.sub(r"[^A-Za-z0-9]", "", candidate).upper()
        if candidate:
            return candidate
    fallback = REFERENCE_FALLBACK_PATTERN.findall(text)
    if fallback:
        return fallback[-1].strip().upper()
    return ""


def normalize_reference_candidate(raw: str) -> str | None:
    candidate = clean_spaces(raw)
    candidate = re.sub(r"[^A-Za-z0-9]", "", candidate).upper()
    if not candidate:
        return None

    digit_count = sum(char.isdigit() for char in candidate)
    if digit_count < 5:
        return None
    if len(candidate) < 6:
        return None
    return candidate


def extract_page_reference_candidates(page: pdfplumber.page.Page) -> list[str]:
    page_text = page.extract_text() or ""
    candidates: list[str] = []
    for raw in PAGE_REFERENCE_PATTERN.findall(page_text):
        normalized = normalize_reference_candidate(raw)
        if normalized:
            candidates.append(normalized)
    return candidates


def assign_page_references(
    rows: list[dict[str, str]], candidates: list[str]
) -> list[dict[str, str]]:
    if not rows or not candidates:
        return rows

    grouped: dict[tuple[str, int], list[dict[str, str]]] = {}
    for row in rows:
        column = row.get("column", "left")
        order = int(row.get("order_in_column", "0") or "0")
        key = (column, order)
        grouped.setdefault(key, []).append(row)

    def sort_key(item: tuple[str, int]) -> tuple[int, int]:
        column, order = item
        return (0 if column == "left" else 1, order)

    base_keys = sorted(grouped.keys(), key=sort_key)
    cursor = 0

    for key in base_keys:
        base_rows = grouped[key]
        existing = next(
            (
                normalize_reference_candidate(row.get("reference_number", ""))
                for row in base_rows
                if row.get("reference_number")
            ),
            None,
        )

        if existing:
            for row in base_rows:
                row["reference_number"] = existing
                if row.get("confidence") == "low":
                    row["confidence"] = "medium"
            continue

        if cursor >= len(candidates):
            continue

        assigned = candidates[cursor]
        cursor += 1
        for row in base_rows:
            row["reference_number"] = assigned
            if row.get("confidence") == "low":
                row["confidence"] = "medium"

    return rows


def clean_name_chunk(chunk: str) -> str:
    name = clean_spaces(chunk)
    name = REFERENCE_PAREN_PATTERN.sub("", name)
    name = re.sub(r"\$?\d+(?:\.\d{2})?", "", name)
    name = re.sub(r"Tallas?:.*$", "", name, flags=re.IGNORECASE)
    name = clean_spaces(name).strip(" .,-:;")
    return name or "Producto sin nombre"


def parse_with_sizes(
    text: str, source_page: int, column: str, category: str
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    matches = list(PRODUCT_WITH_SIZE_PATTERN.finditer(text))
    if not matches:
        return rows

    prev_end = 0
    order = 0
    for match in matches:
        chunk = clean_spaces(text[prev_end : match.start()])
        prev_end = match.end()
        if not chunk:
            continue

        sizes_raw = match.group("sizes_a") or match.group("sizes_b") or ""
        price_raw = match.group("price_a") or match.group("price_b") or "0"
        sizes = parse_sizes(sizes_raw)
        name_raw = clean_name_chunk(chunk)
        reference = extract_reference_number(chunk)
        order += 1

        for size in sizes:
            rows.append(
                {
                    "source_page": str(source_page),
                    "column": column,
                    "order_in_column": str(order),
                    "category": category,
                    "reference_number": reference,
                    "name_raw": name_raw,
                    "size": size,
                    "price": price_raw,
                    "image_hint": f"IMG-P{source_page:03d}-C{column[0].upper()}-O{order:02d}",
                    "confidence": "medium" if reference else "low",
                    "parse_mode": "with_sizes",
                }
            )

    return rows


def parse_generic(
    text: str, source_page: int, column: str, category: str
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    matches = list(PRICE_PATTERN.finditer(text))
    if not matches:
        return rows

    prev_end = 0
    order = 0
    for match in matches:
        chunk = clean_spaces(text[prev_end : match.start()])
        prev_end = match.end()
        if not chunk:
            continue
        price_raw = match.group("price")
        order += 1
        rows.append(
            {
                "source_page": str(source_page),
                "column": column,
                "order_in_column": str(order),
                "category": category,
                "reference_number": extract_reference_number(chunk),
                "name_raw": clean_name_chunk(chunk),
                "size": "UNICA",
                "price": price_raw,
                "image_hint": f"IMG-P{source_page:03d}-C{column[0].upper()}-O{order:02d}",
                "confidence": "low",
                "parse_mode": "generic_no_sizes",
            }
        )
    return rows


def extract_staging(pdf_path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            words = page.extract_words(extra_attrs=["upright"])
            category = detect_page_category(words)
            page_rows: list[dict[str, str]] = []

            for column in ("left", "right"):
                column_text = extract_column_text(page, column)
                if not column_text:
                    continue

                parsed = parse_with_sizes(column_text, page_index, column, category)
                if not parsed:
                    parsed = parse_generic(column_text, page_index, column, category)
                page_rows.extend(parsed)

            page_references = extract_page_reference_candidates(page)
            rows.extend(assign_page_references(page_rows, page_references))
    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    headers = [
        "source_page",
        "column",
        "order_in_column",
        "category",
        "reference_number",
        "name_raw",
        "size",
        "price",
        "image_hint",
        "confidence",
        "parse_mode",
    ]
    with path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extrae staging de catalogo desde PDF para recatalogacion."
    )
    parser.add_argument("--pdf", required=True, help="Ruta al PDF de catalogo.")
    parser.add_argument(
        "--output",
        default="artifacts/catalog_staging.csv",
        help="Ruta CSV de salida staging.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not pdf_path.exists():
        raise SystemExit(f"No existe el PDF: {pdf_path}")

    rows = extract_staging(pdf_path)
    write_csv(output_path, rows)
    print(f"Staging generado: {output_path}")
    print(f"Filas extraidas: {len(rows)}")


if __name__ == "__main__":
    main()

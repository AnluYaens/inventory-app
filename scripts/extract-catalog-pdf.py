#!/usr/bin/env python3
"""
Extracts catalog data and embedded images from a PDF into staging artifacts.

Outputs:
- artifacts/catalog_staging.csv
- artifacts/image-map-review.csv
- artifacts/extracted-images/*
- artifacts/extraction-report.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pdfplumber
from PIL import Image


BRAND_CANDIDATES = [
    "Zara",
    "Mango",
    "Pull & Bear",
    "Stradivarius",
    "Bershka",
    "H&M",
    "HM",
    "Sfera",
    "Forever 21",
    "Lefties",
    "Shein",
    "Massimo Dutti",
]

PRODUCT_PATTERN = re.compile(
    r"(?:Tallas:\s*(?P<sizes_a>[A-Za-z0-9,\s/.-]+?)\s*\$(?P<price_a>\d+(?:\.\d{2})?)|"
    r"\$(?P<price_b>\d+(?:\.\d{2})?)\s*Tallas:\s*(?P<sizes_b>[A-Za-z0-9,\s/.-]+?))"
)


@dataclass
class ProductBlock:
    page: int
    column: str
    order_in_column: int
    name: str
    brand: str
    category: str
    sizes: list[str]
    price: float
    image_filename: str
    confidence: str
    source_text: str


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def clean_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_category_token(raw: str) -> str:
    raw = clean_spaces(raw)
    raw = re.sub(r"[^A-Za-z\-]", "", raw).upper()
    if not raw:
        return "Sin categoria"

    parts = raw.split("-")
    reversed_parts = [part[::-1] for part in parts if part]
    if not reversed_parts:
        return "Sin categoria"

    category = " ".join(reversed_parts)
    return category.title()


def category_code(category: str) -> str:
    compact = strip_accents(category).upper()
    compact = re.sub(r"[^A-Z0-9]", "", compact)
    return (compact[:4] or "GENR").ljust(4, "X")


def brand_code(brand: str) -> str:
    compact = strip_accents(brand).upper()
    compact = re.sub(r"[^A-Z0-9]", "", compact)
    return (compact[:4] or "GENR").ljust(4, "X")


def looks_like_category_marker(word: dict[str, Any]) -> bool:
    token = word.get("text", "")
    if word.get("upright", True):
        return False
    if len(token) < 4:
        return False
    return bool(re.fullmatch(r"[A-Z\-]+", token))


def page_category(words: list[dict[str, Any]]) -> str:
    vertical = [w for w in words if looks_like_category_marker(w)]
    if not vertical:
        return "Sin categoria"
    vertical.sort(key=lambda w: w.get("height", 0), reverse=True)
    return normalize_category_token(vertical[0]["text"])


def extract_column_text(page: pdfplumber.page.Page, column: str) -> str:
    words = [w for w in page.extract_words() if w.get("upright", True)]
    midpoint = page.width / 2

    if column == "left":
        selected = [w for w in words if w["x0"] < midpoint]
    else:
        selected = [w for w in words if w["x0"] >= midpoint]

    selected.sort(key=lambda w: (round(float(w["top"]), 1), float(w["x0"])))
    return clean_spaces(" ".join(w["text"] for w in selected))


def parse_sizes(raw_sizes: str) -> list[str]:
    cleaned = clean_spaces(raw_sizes).upper()
    cleaned = cleaned.replace(" Y ", ",")

    tokens = re.findall(r"\b(?:\d{2}|XS|S|M|L|XL|XXL|XXXL|UNICA|U)\b", cleaned)
    if not tokens:
        return ["UNICA"]

    normalized: list[str] = []
    for token in tokens:
        if token == "U":
            normalized.append("UNICA")
        else:
            normalized.append(token)
    return normalized


def extract_brand_and_name(raw_chunk: str) -> tuple[str, str]:
    text = clean_spaces(raw_chunk)
    text = re.sub(r"^[\d,\s]+", "", text)
    text = clean_spaces(text).strip(".,- ")
    if not text:
        return ("Generica", "Producto sin nombre")

    for candidate in BRAND_CANDIDATES:
        if text.lower().startswith(candidate.lower() + " "):
            name = clean_spaces(text[len(candidate) :])
            return (candidate, name or "Producto sin nombre")
        if text.lower().endswith(" " + candidate.lower()):
            name = clean_spaces(text[: -len(candidate)])
            return (candidate, name or "Producto sin nombre")

    return ("Generica", text)


def parse_products_from_text(
    text: str,
    page_number: int,
    column: str,
    category: str,
    page_warnings: list[str],
) -> list[ProductBlock]:
    products: list[ProductBlock] = []
    if not text:
        return products

    prev_end = 0
    order = 0
    matches = list(PRODUCT_PATTERN.finditer(text))
    if not matches:
        page_warnings.append(
            f"Pagina {page_number} ({column}): no se detectaron bloques de producto parseables."
        )
        return products

    for match in matches:
        chunk = clean_spaces(text[prev_end : match.start()])
        prev_end = match.end()

        if not chunk:
            continue

        sizes_raw = match.group("sizes_a") or match.group("sizes_b") or ""
        price_raw = match.group("price_a") or match.group("price_b") or "0"
        sizes = parse_sizes(sizes_raw)

        try:
            price = float(price_raw)
        except ValueError:
            page_warnings.append(
                f"Pagina {page_number} ({column}): precio invalido '{price_raw}' en chunk '{chunk[:60]}'."
            )
            continue

        brand, name = extract_brand_and_name(chunk)
        confidence = "medium"
        if brand == "Generica":
            confidence = "low"

        order += 1
        products.append(
            ProductBlock(
                page=page_number,
                column=column,
                order_in_column=order,
                name=name,
                brand=brand,
                category=category,
                sizes=sizes,
                price=price,
                image_filename="",
                confidence=confidence,
                source_text=chunk,
            )
        )

    return products


def image_mode_from_stream(image_info: dict[str, Any], data: bytes) -> tuple[str, int]:
    width, height = image_info.get("srcsize", (0, 0))
    pixels = int(width) * int(height)
    if pixels <= 0:
        return ("RGB", 3)

    if len(data) == pixels:
        return ("L", 1)
    if len(data) == pixels * 3:
        return ("RGB", 3)
    if len(data) == pixels * 4:
        return ("RGBA", 4)
    return ("RGB", 3)


def save_pdf_image(image_info: dict[str, Any], output_file: Path) -> bool:
    stream = image_info.get("stream")
    if stream is None:
        return False

    data = stream.get_data()
    width, height = image_info.get("srcsize", (0, 0))
    if not width or not height:
        return False

    mode, channels = image_mode_from_stream(image_info, data)
    expected = int(width) * int(height) * channels

    try:
        if len(data) == expected:
            image = Image.frombytes(mode, (int(width), int(height)), data)
        else:
            image = Image.open(io.BytesIO(data))
            image.load()
        output_file.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_file)
        return True
    except Exception:
        return False


def extract_images_from_page(
    page: pdfplumber.page.Page, page_number: int, output_dir: Path
) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    images = page.images or []
    images_sorted = sorted(images, key=lambda img: (float(img["top"]), float(img["x0"])))

    for index, image_info in enumerate(images_sorted, start=1):
        filename = f"IMG-P{page_number:03d}-I{index:02d}.png"
        output_file = output_dir / filename
        ok = save_pdf_image(image_info, output_file)
        if not ok:
            continue

        column = "left" if float(image_info["x0"]) < (page.width / 2) else "right"
        extracted.append(
            {
                "page": page_number,
                "column": column,
                "order_in_column": 0,
                "filename": filename,
                "top": float(image_info["top"]),
                "x0": float(image_info["x0"]),
            }
        )

    # Compute order per column after sorting
    for column in ("left", "right"):
        per_col = [img for img in extracted if img["column"] == column]
        per_col.sort(key=lambda img: (img["top"], img["x0"]))
        for idx, img in enumerate(per_col, start=1):
            img["order_in_column"] = idx

    return extracted


def assign_images_to_products(
    products: list[ProductBlock], page_images: list[dict[str, Any]]
) -> tuple[list[ProductBlock], list[dict[str, str]]]:
    review_rows: list[dict[str, str]] = []

    images_by_key: dict[tuple[str, int], str] = {}
    for image in page_images:
        key = (image["column"], image["order_in_column"])
        images_by_key[key] = image["filename"]

    for product in products:
        filename = images_by_key.get((product.column, product.order_in_column), "")
        product.image_filename = filename
        review_rows.append(
            {
                "page": str(product.page),
                "column": product.column,
                "order_in_column": str(product.order_in_column),
                "product_name": product.name,
                "brand": product.brand,
                "image_filename": filename,
                "confidence": product.confidence,
            }
        )

    return products, review_rows


def make_sku(category: str, brand: str, counter: int, size: str) -> str:
    return f"AMN-{category_code(category)}-{brand_code(brand)}-{counter:04d}-{size}"


def write_staging_csv(output_file: Path, products: list[ProductBlock]) -> int:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "sku",
        "name",
        "category",
        "size",
        "color",
        "price",
        "cost",
        "initial_stock",
        "image_filename",
        "brand",
        "source_page",
        "confidence",
    ]

    row_count = 0
    product_counter = 0
    with output_file.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fields)
        writer.writeheader()

        for product in products:
            product_counter += 1
            for size in product.sizes:
                writer.writerow(
                    {
                        "sku": make_sku(product.category, product.brand, product_counter, size),
                        "name": product.name,
                        "category": product.category,
                        "size": size,
                        "color": "",
                        "price": f"{product.price:.2f}",
                        "cost": "",
                        "initial_stock": "",
                        "image_filename": product.image_filename,
                        "brand": product.brand,
                        "source_page": str(product.page),
                        "confidence": product.confidence,
                    }
                )
                row_count += 1

    return row_count


def write_image_map(output_file: Path, rows: list[dict[str, str]]) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "page",
        "column",
        "order_in_column",
        "product_name",
        "brand",
        "image_filename",
        "confidence",
    ]
    with output_file.open("w", newline="", encoding="utf-8") as fp:
        writer = csv.DictWriter(fp, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def run_extraction(pdf_path: Path, output_dir: Path) -> dict[str, Any]:
    extracted_images_dir = output_dir / "extracted-images"
    staging_csv = output_dir / "catalog_staging.csv"
    image_map_csv = output_dir / "image-map-review.csv"
    report_json = output_dir / "extraction-report.json"

    all_products: list[ProductBlock] = []
    image_review_rows: list[dict[str, str]] = []
    global_warnings: list[str] = []
    pages_report: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            words = page.extract_words(extra_attrs=["upright"])
            category = page_category(words)
            page_warnings: list[str] = []

            left_text = extract_column_text(page, "left")
            right_text = extract_column_text(page, "right")

            left_products = parse_products_from_text(
                left_text, index, "left", category, page_warnings
            )
            right_products = parse_products_from_text(
                right_text, index, "right", category, page_warnings
            )
            page_products = left_products + right_products

            page_images = extract_images_from_page(page, index, extracted_images_dir)
            page_products, page_review_rows = assign_images_to_products(
                page_products, page_images
            )

            # Mark missing images for manual review.
            for product in page_products:
                if not product.image_filename:
                    product.confidence = "low"
                    page_warnings.append(
                        f"Pagina {index}: producto '{product.name}' sin imagen vinculada."
                    )

            all_products.extend(page_products)
            image_review_rows.extend(page_review_rows)
            global_warnings.extend(page_warnings)

            pages_report.append(
                {
                    "page": index,
                    "category": category,
                    "products_detected": len(page_products),
                    "images_extracted": len(page_images),
                    "warnings": page_warnings,
                }
            )

    rows_written = write_staging_csv(staging_csv, all_products)
    write_image_map(image_map_csv, image_review_rows)

    report = {
        "pdf_path": str(pdf_path),
        "total_pages": len(pages_report),
        "products_detected": len(all_products),
        "variant_rows_written": rows_written,
        "warnings_count": len(global_warnings),
        "warnings": global_warnings,
        "outputs": {
            "catalog_staging_csv": str(staging_csv),
            "image_map_review_csv": str(image_map_csv),
            "images_dir": str(extracted_images_dir),
        },
        "pages": pages_report,
    }

    report_json.parent.mkdir(parents=True, exist_ok=True)
    report_json.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extrae catalogo e imagenes de PDF para flujo PDF -> CSV revisado."
    )
    parser.add_argument("--pdf", required=True, help="Ruta al archivo PDF de catalogo.")
    parser.add_argument(
        "--out-dir",
        default="artifacts",
        help="Directorio de salida para csv/reportes/imagenes (default: artifacts).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    pdf_path = Path(args.pdf).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()

    if not pdf_path.exists():
        raise SystemExit(f"No existe el PDF: {pdf_path}")

    report = run_extraction(pdf_path, out_dir)
    print("Extraccion completada.")
    print(f"PDF: {report['pdf_path']}")
    print(f"Paginas: {report['total_pages']}")
    print(f"Productos detectados: {report['products_detected']}")
    print(f"Filas variante CSV: {report['variant_rows_written']}")
    print(f"Warnings: {report['warnings_count']}")
    print("Salida principal:", report["outputs"]["catalog_staging_csv"])


if __name__ == "__main__":
    main()

"""Developer QA only: compare report contents, render Word/PDF, and inspect page bounds.

Requires native Microsoft Word (isolated, read-only COM instance), Python with
PyMuPDF/Pillow/pywin32, and the documents skill's render_docx.py plus Poppler.
None of these are application export dependencies.
"""
import argparse
import importlib.util
import json
import re
import shutil
import tempfile
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import pymupdf
from PIL import Image, ImageDraw


def normalize(value):
    return re.sub(r"\s+", "", value)


def inspect_pdf(path):
    doc = pymupdf.open(path)
    bounds = []
    fonts = set()
    for index, page in enumerate(doc):
        for font in page.get_fonts(full=True):
            fonts.add((font[3], bool(doc.extract_font(font[0])[3])))
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    x0, y0, x1, y1 = span["bbox"]
                    if x0 < 0 or y0 < 0 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                        bounds.append({"page": index + 1, "text": span["text"], "bbox": span["bbox"]})
    text = "\n".join(page.get_text() for page in doc)
    text = re.sub(r"FrameMind\s+\d+\s*/\s*\d+", "", text)
    return {"pages": len(doc), "fonts": sorted(fonts), "out_of_page": bounds}, normalize(text)


def overview(paths, target):
    thumb_width = 238
    thumbs = []
    for index, path in enumerate(paths):
        with Image.open(path) as page:
            page.thumbnail((thumb_width, 337))
            tile = Image.new("RGB", (258, 367), "#e8e8e8")
            tile.paste(page, ((258-page.width)//2, 5))
            ImageDraw.Draw(tile).text((8, 345), f"Page {index+1}", fill="black")
            thumbs.append(tile)
    sheet = Image.new("RGB", (258 * 5, 367 * ((len(thumbs)+4)//5)), "white")
    for index, tile in enumerate(thumbs):
        sheet.paste(tile, ((index % 5) * 258, (index // 5) * 367))
    sheet.save(target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--renderer", required=True)
    parser.add_argument("--samples", nargs="+", default=["selected", "all", "long"])
    parser.add_argument("--output-dir", default=str(Path(tempfile.gettempdir()) / "framemind-t30-qa"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("render_docx", args.renderer)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    import win32com.client
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    reports = {}
    try:
        for sample in args.samples:
            stem = f"T30-{sample}"
            docx = root / "docs" / "evidence" / f"{stem}.docx"
            # Word may lock its read-only document. Render a private copy so
            # desktop evidence restoration and the user's originals stay free.
            source_docx = output / f"{stem}-source.docx"
            product_pdf = output / f"{stem}-source.pdf"
            shutil.copy2(docx, source_docx)
            shutil.copy2(docx.with_suffix(".pdf"), product_pdf)
            word_pdf = output / f"{stem}-word.pdf"
            document = word.Documents.Open(str(source_docx), ReadOnly=True, AddToRecentFiles=False)
            try:
                document.Repaginate()
                document.ExportAsFixedFormat(str(word_pdf), 17)
            finally:
                document.Close(False)
            info, pdf_text = inspect_pdf(product_pdf)
            with ZipFile(source_docx) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            missing = []
            paragraphs = xml.findall(".//w:body//w:p", ns)
            for paragraph in paragraphs:
                text = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns))
                # Independent export operations have independent report timestamps.
                if "ISO 8601" in text:
                    text = text.split("；报告生成时间")[0]
                if text and normalize(text) not in pdf_text:
                    missing.append(text)
            info["missing_word_content"] = missing
            info["word_layout"], _ = inspect_pdf(word_pdf)
            for kind, pdf in [("pdf", product_pdf), ("word", word_pdf)]:
                # Reuse the skill's rasterization and page naming with native Word's PDF.
                renderer.convert_to_pdf = lambda *unused, pdf=pdf, **kwargs: (str(pdf), "native Word / product PDF")
                paths = renderer.rasterize(str(docx), str(output / f"{stem}-{kind}"), 144, False, False)
                overview(paths, root / "docs" / "evidence" / f"{stem}-{kind}-pages.png")
            reports[stem] = info
            print(stem, json.dumps(info, ensure_ascii=False), flush=True)
    finally:
        word.Quit()
    (output / "layout-check.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    if any(item["out_of_page"] or item["missing_word_content"] or item["word_layout"]["out_of_page"] for item in reports.values()):
        raise SystemExit("Layout/content checks failed; inspect rendered pages and fix before accepting.")


if __name__ == "__main__":
    main()

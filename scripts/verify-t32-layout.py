"""Read-only developer QA of all T32 Word/PDF pages; no product dependency."""
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
import win32com.client

layout_spec = importlib.util.spec_from_file_location("t30_layout", Path(__file__).with_name("verify-t30-layout.py"))
layout = importlib.util.module_from_spec(layout_spec)
layout_spec.loader.exec_module(layout)
inspect_pdf, normalize, overview = layout.inspect_pdf, layout.normalize, layout.overview


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--renderer", required=True)
    parser.add_argument("--reuse-rendered", action="store_true")
    parser.add_argument("--output-dir", default=str(Path(tempfile.gettempdir()) / "framemind-t32-layout"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = Path(args.output_dir)
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("render_docx", args.renderer)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    reports = {}
    try:
        for model in ["S", "M", "L"]:
            stem = f"T32-{model}"
            source = output / f"{stem}.docx"
            product_pdf = output / f"{stem}.pdf"
            shutil.copy2(root / "docs/evidence" / source.name, source)
            shutil.copy2(root / "docs/evidence" / product_pdf.name, product_pdf)
            word_pdf = output / f"{stem}-word.pdf"
            if not args.reuse_rendered:
                document = word.Documents.Open(str(source), ReadOnly=True, AddToRecentFiles=False)
                try:
                    document.Repaginate()
                    document.ExportAsFixedFormat(str(word_pdf), 17)
                finally:
                    document.Close(False)
            info, pdf_text = inspect_pdf(product_pdf)
            info["word_layout"], word_text = inspect_pdf(word_pdf)
            # A paragraph can span pages; footers must not interrupt its text.
            word_text = normalize("\n".join(block[4] for page in pymupdf.open(word_pdf) for block in page.get_text("blocks") if not (block[1] > page.rect.height - 100 and re.fullmatch(r"FrameMind\s+\d+", block[4].strip()))))
            with ZipFile(source) as archive:
                xml = ET.fromstring(archive.read("word/document.xml"))
            ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            missing = {"pdf": [], "word": []}
            for paragraph in xml.findall(".//w:body//w:p", ns):
                text = "".join(node.text or "" for node in paragraph.findall(".//w:t", ns))
                if "ISO 8601" in text:
                    text = text.split("；报告生成时间")[0]
                for kind, full_text in [("pdf", pdf_text), ("word", word_text)]:
                    if text and normalize(text) not in full_text:
                        missing[kind].append(text)
            info["missing_content"] = missing
            info["global_pdf_page_numbers"] = all(normalize(f"FrameMind {i + 1} / {info['pages']}") in normalize(page.get_text()) for i, page in enumerate(pymupdf.open(product_pdf)))
            for kind, pdf in [("pdf", product_pdf), ("word", word_pdf)]:
                if args.reuse_rendered:
                    continue
                renderer.convert_to_pdf = lambda *unused, pdf=pdf, **kwargs: (str(pdf), "native Word / product PDF")
                paths = renderer.rasterize(str(source), str(output / f"{stem}-{kind}"), 96, False, False)
                for offset in range(0, len(paths), 20):
                    overview(paths[offset:offset + 20], output / f"{stem}-{kind}-pages-{offset + 1}.png")
                # Full-size representative pages for visual inspection.
                for label, index in [("first", 0), ("middle", len(paths) // 2), ("last", len(paths) - 1)]:
                    shutil.copy2(paths[index], output / f"{stem}-{kind}-{label}.png")
            reports[stem] = info
            print(stem, json.dumps(info, ensure_ascii=False), flush=True)
    finally:
        word.Quit()
    (root / "docs/evidence/T32-layout-results.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    if any(item["out_of_page"] or item["word_layout"]["out_of_page"] or any(item["missing_content"].values()) or not item["global_pdf_page_numbers"] for item in reports.values()):
        raise SystemExit("Layout/content checks failed; inspect pages before accepting.")


if __name__ == "__main__":
    main()

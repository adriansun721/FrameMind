"""Windows development QA: native Word pagination, skill PNG renderer, PDF layout audit."""
import argparse
import importlib.util
import json
from pathlib import Path

import pymupdf
import win32com.client
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("--renderer", required=True, help="documents skill render_docx.py")
parser.add_argument("--samples", nargs="+", default=["force", "base", "multi", "long", "missing"])
args = parser.parse_args()
spec = importlib.util.spec_from_file_location("document_renderer", args.renderer)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)
# Word has already produced these PDFs. Preserve the skill's PNG generation workflow.
renderer.convert_to_pdf = lambda doc_path, *_args, **_kwargs: (doc_path, "Native Word/Electron PDF")
evidence = Path("docs/evidence/plan2/T2-38")
scratch = Path(".scratch/T2-38-layout")
scratch.mkdir(parents=True, exist_ok=True)
word = win32com.client.DispatchEx("Word.Application")
word.Visible = False
word.DisplayAlerts = 0
try:
    for name in args.samples:
        target = (scratch / f"{name}-word.pdf").resolve()
        document = word.Documents.Open(str((evidence / f"{name}.docx").resolve()), ReadOnly=True, AddToRecentFiles=False)
        try:
            document.ExportAsFixedFormat(str(target), 17)
        finally:
            document.Close(False)
finally:
    word.Quit()

checks = []
for name in args.samples:
    for kind in ["word", "pdf"]:
        source = scratch / f"{name}-word.pdf" if kind == "word" else evidence / f"{name}.pdf"
        directory = scratch / f"{name}-{kind}"
        renderer.rasterize(str(source.resolve()), str(directory.resolve()), 100, False, False)
        pdf = pymupdf.open(source)
        issues = []
        footer_count = 0
        for i, page in enumerate(pdf):
            spans = [s for b in page.get_text("dict")["blocks"] if "lines" in b for line in b["lines"] for s in line["spans"] if s["text"].strip()]
            for s in spans:
                x0, y0, x1, y1 = s["bbox"]
                if s["text"].startswith("FrameMind") and x0 >= 48 and x1 <= page.rect.width - 48 and y0 > page.rect.height - 60 and y1 <= page.rect.height - 10:
                    footer_count += 1
                    continue
                if x0 < 48 or x1 > page.rect.width - 48 or y0 < 40 or y1 > page.rect.height - 35:
                    issues.append({"page": i + 1, "text": s["text"], "bbox": s["bbox"]})
            if page.get_text().strip() in ["", f"FrameMind  {i + 1}", str(i + 1)]:
                issues.append({"page": i + 1, "blank": True})
        all_text = "\n".join(page.get_text() for page in pdf)
        assert "历史结果" in all_text and "统计均方根" in all_text and "mm²/Hz" in all_text
        if name == "missing":
            assert "缺少记录" in all_text
        images = [directory / f"page-{i + 1}.png" for i in range(len(pdf))]
        # Contact sheets index all pages; full-size images are retained for visual inspection.
        for start in range(0, len(images), 8):
            sheet = Image.new("RGB", (1600, 1220), "#dddddd")
            draw = ImageDraw.Draw(sheet)
            for j, path in enumerate(images[start:start + 8]):
                page_image = Image.open(path)
                page_image.thumbnail((390, 565))
                x, y = (j % 4) * 400 + 5, (j // 4) * 610 + 25
                sheet.paste(page_image, (x, y))
                draw.text((x, y - 20), f"{name} {kind} page {start + j + 1}", fill="black")
            sheet.save(directory / f"sheet-{start // 8 + 1}.png")
        checks.append({"sample": name, "format": kind, "pages": len(pdf), "issues": issues, "footerCount": footer_count, "pngDirectory": str(directory), "source": str(source)})
        print(name, kind, len(pdf), "pages; bounding/blank issues", len(issues), flush=True)
(evidence / "layout-check.json").write_text(json.dumps({"checks": checks}, indent=2, ensure_ascii=False), encoding="utf-8")

"""Read-only developer QA of T33 exports using native Word and the document renderer."""
import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import tempfile
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

import win32com.client
import pymupdf

layout_spec = importlib.util.spec_from_file_location("t30_layout", Path(__file__).with_name("verify-t30-layout.py"))
layout = importlib.util.module_from_spec(layout_spec)
layout_spec.loader.exec_module(layout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--renderer", required=True)
    parser.add_argument("--modes", nargs="+", choices=["replay", "online"], default=["replay", "online"])
    parser.add_argument("--output-dir", default=str(Path(tempfile.gettempdir()) / "framemind-t33-layout"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / "docs/evidence/T33"
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("render_docx", args.renderer)
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    reports = {}
    try:
        for mode in args.modes:
            for theme in ["dark", "light"]:
                name = f"{mode}-{theme}"
                folder = root / name
                validation = json.loads((folder / "validation.json").read_text(encoding="utf-8"))
                if validation.get("outcome") != "passed":
                    raise RuntimeError(f"{name}: latest workflow did not pass; stale exports are not evidence")
                for artifact, digest in validation["artifacts"].items():
                    if hashlib.sha256((folder / artifact).read_bytes()).hexdigest() != digest:
                        raise RuntimeError(f"{name}: artifact changed after run {validation['runId']}: {artifact}")
                source = output / f"{name}.docx"
                shutil.copy2(folder / "计算书.docx", source)
                word_pdf = output / f"{name}-word.pdf"
                document = word.Documents.Open(str(source), ReadOnly=True, AddToRecentFiles=False)
                try:
                    document.Repaginate()
                    document.ExportAsFixedFormat(str(word_pdf), 17)
                finally:
                    document.Close(False)
                project = json.loads((folder / "after.framemind").read_text(encoding="utf-8"))
                before_id, after_id = [result["id"] for result in project["analysisResults"]]
                with ZipFile(source) as archive:
                    xml = ET.fromstring(archive.read("word/document.xml"))
                ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
                paragraphs = ["".join(node.text or "" for node in paragraph.findall(".//w:t", ns)) for paragraph in xml.findall(".//w:body//w:p", ns)]
                info = {"runId": validation["runId"]}
                for kind, pdf in [("pdf", folder / "计算书.pdf"), ("word", word_pdf)]:
                    details, text = layout.inspect_pdf(pdf)
                    # Native Word may split a paragraph across pages; page footers are not body content.
                    with pymupdf.open(pdf) as rendered:
                        text = layout.normalize("\n".join(re.sub(r"(?m)^FrameMind[ \t]+\d+(?:[ \t]*/[ \t]*\d+)?[ \t]*$", "", page.get_text()) for page in rendered))
                    missing = []
                    for paragraph in paragraphs:
                        # Each format was exported independently; compare its source, not its report timestamp.
                        if "ISO 8601" in paragraph:
                            paragraph = paragraph.split("；报告生成时间")[0]
                        if paragraph and layout.normalize(paragraph) not in text:
                            missing.append(paragraph)
                    details["missing_word_paragraphs"] = missing
                    details["correct_analysis_id"] = after_id in text and before_id not in text
                    info[kind] = details
                    renderer.convert_to_pdf = lambda *unused, pdf=pdf, **kwargs: (str(pdf), "native Word / product PDF")
                    paths = renderer.rasterize(str(source), str(output / f"{name}-{kind}"), 120, False, False)
                    layout.overview(paths, folder / f"{kind}-pages.png")
                reports[name] = info
                print(json.dumps({"sample": name, "pdf_pages": info["pdf"]["pages"], "word_pages": info["word"]["pages"]}), flush=True)
    finally:
        word.Quit()
    (root / "layout-results.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if any(item["out_of_page"] or item["missing_word_paragraphs"] or not item["correct_analysis_id"]
           for report in reports.values() for key, item in report.items() if key != "runId"):
        raise SystemExit("T33 layout/content verification failed; inspect page images.")


if __name__ == "__main__":
    main()

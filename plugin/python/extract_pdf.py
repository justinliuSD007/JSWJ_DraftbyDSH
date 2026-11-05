# -*- coding: utf-8 -*-
"""提取 PDF 纯文本，供受审文件解析与预审使用。"""
import argparse
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    args = parser.parse_args()

    doc = fitz.open(args.file)
    parts = []
    for page_index, page in enumerate(doc, 1):
        text = page.get_text("text").strip()
        if text:
            parts.append(f"[第 {page_index} 页]\n{text}")
    text = "\n\n".join(parts)
    print(
        "JSWJ_TEXT "
        + json.dumps({"text": text, "chars": len(text), "images": [], "figures": []}, ensure_ascii=False)
    )


if __name__ == "__main__":
    main()

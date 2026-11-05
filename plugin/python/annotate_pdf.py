# -*- coding: utf-8 -*-
"""在原 PDF 副本上按页写批注，正文不改。"""
import argparse
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

AUTHOR = "GOVY技术文件助手"


def norm(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def comment_text(item) -> str:
    return "\n".join(
        [
            f"{item.get('severity') or '建议'}｜{item.get('location') or '未标注位置'}",
            f"问题：{item.get('problem') or ''}",
            f"意见依据：{item.get('basis') or '缺依据'}",
            f"建议修订方式：{item.get('suggestion') or '-'}",
        ]
    )


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--issues", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    issues = json.loads(Path(args.issues).read_text(encoding="utf-8-sig"))
    doc = fitz.open(args.file)
    comments = 0
    for item in issues:
        quote = (item.get("evidence") or {}).get("quote") or ""
        page = None
        rect = None
        if quote:
            needle = quote.strip()[:80]
            for page_index in range(len(doc)):
                found = doc[page_index].search_for(needle)
                if found:
                    page = doc[page_index]
                    rect = found[0]
                    break
        if page is None:
            page_no = 0
            match = re.search(r"第\s*(\d+)\s*页", item.get("location") or "")
            if match:
                page_no = max(0, min(len(doc) - 1, int(match.group(1)) - 1))
            page = doc[page_no]
        if rect is not None:
            highlight = page.add_highlight_annot(rect)
            highlight.set_info(title=AUTHOR, content=comment_text(item))
            highlight.update()
            point = fitz.Point(min(rect.x1 + 8, page.rect.width - 30), max(rect.y0, 20))
        else:
            point = fitz.Point(page.rect.width - 40, 36)
        annot = page.add_text_annot(point, comment_text(item), icon="Comment")
        annot.set_info(title=AUTHOR, content=comment_text(item))
        annot.update()
        comments += 1

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    doc.save(args.out, garbage=3, deflate=True)
    print("JSWJ_ANNOTATED " + json.dumps({"out": args.out, "comments": comments}, ensure_ascii=False))


if __name__ == "__main__":
    main()

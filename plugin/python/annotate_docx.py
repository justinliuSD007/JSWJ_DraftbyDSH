# -*- coding: utf-8 -*-
"""在原 Word 副本上按意见位置写批注，正文不改。"""
import argparse
import json
import re
import sys
from pathlib import Path

from docx import Document

AUTHOR = "GOVY技术文件助手"


def norm(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def comment_text(items) -> str:
    lines = []
    for index, item in enumerate(items, 1):
        if len(items) > 1:
            lines.append(f"【预审意见 {index}】")
        lines.append(f"{item.get('severity') or '建议'}｜{item.get('location') or '未标注位置'}")
        lines.append(f"问题：{item.get('problem') or ''}")
        lines.append(f"意见依据：{item.get('basis') or '缺依据'}")
        lines.append(f"建议修订方式：{item.get('suggestion') or '-'}")
        if index < len(items):
            lines.append("")
    return "\n".join(lines)


def find_paragraph(paragraphs, item):
    quote = norm((item.get("evidence") or {}).get("quote") or "")
    location = norm(item.get("location") or "")
    if quote:
        for paragraph in paragraphs:
            if quote in norm(paragraph.text):
                return paragraph
    if location:
        for paragraph in paragraphs:
            if location in norm(paragraph.text):
                return paragraph
    return paragraphs[0] if paragraphs else None


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
    doc = Document(args.file)
    paragraphs = [p for p in doc.paragraphs if norm(p.text)]
    grouped = {}
    for item in issues:
        paragraph = find_paragraph(paragraphs, item)
        if paragraph is None:
            continue
        grouped.setdefault(id(paragraph), (paragraph, []))[1].append(item)

    for paragraph, items in grouped.values():
        runs = list(paragraph.runs)
        if not runs:
            runs = [paragraph.add_run("")]
        doc.add_comment(runs=runs, text=comment_text(items), author=AUTHOR, initials="GOVY")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    doc.save(args.out)
    print("JSWJ_ANNOTATED " + json.dumps({"out": args.out, "comments": sum(len(v[1]) for v in grouped.values())}, ensure_ascii=False))


if __name__ == "__main__":
    main()

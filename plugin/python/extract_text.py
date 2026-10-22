# -*- coding: utf-8 -*-
"""提取 docx 纯文本与内嵌图片，供资料上传后解析使用。"""
import argparse
import json
import sys
from pathlib import Path

from docx import Document


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--images-dir", default="")
    args = parser.parse_args()

    doc = Document(args.file)
    parts = []
    for paragraph in doc.paragraphs:
        text = paragraph.text.strip()
        if text:
            parts.append(text)
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    text = "\n".join(parts)

    images = []
    if args.images_dir:
        out_dir = Path(args.images_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        seen = set()
        for rel in doc.part.rels.values():
            if "image" not in rel.reltype:
                continue
            part = rel.target_part
            key = str(part.partname)
            if key in seen:
                continue
            seen.add(key)
            ext = (part.partname.ext or "png").lstrip(".").lower()
            path = out_dir / f"img-{len(images) + 1:02d}.{ext}"
            path.write_bytes(part.blob)
            images.append(str(path))

    print("JSWJ_TEXT " + json.dumps({"text": text, "chars": len(text), "images": images}, ensure_ascii=False))


if __name__ == "__main__":
    main()

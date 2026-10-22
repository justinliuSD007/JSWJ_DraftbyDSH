# -*- coding: utf-8 -*-
"""JSWJ_DraftbyDSH Word 渲染器。

把 Markdown 正文渲染成套用 GY-F003 模板的 .docx：
  - 封面：密级、文件名称、编制、校对、审核、文件编号
  - 正文：取模板清理版，按 Markdown 章节写入，保留表格/图片/代码块
  - 页眉页脚与版式来自模板，不手工改样式

用法（由插件调用，不直接面向用户）：
  python render_docx.py --md in.md --out out.docx --template t.docx --title "文件名称"

成功时最后一行输出 `JSWJ_RESULT {"ok": true, "path": ..., "blocks": N}`。
"""

import argparse
import copy
import json
import re
import sys
import traceback
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

BODY_STYLE = "标准文件_正文"
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


# ------------------------------------------------------------------ markdown


def parse(md):
    lines = md.split("\n")
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()

        if s.startswith("```"):
            j, buf = i + 1, []
            while j < len(lines) and not lines[j].strip().startswith("```"):
                buf.append(lines[j])
                j += 1
            blocks.append(("code", "\n".join(buf)))
            i = j + 1
            continue

        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(lines[i].strip())
                i += 1
            blocks.append(("table", rows))
            continue

        m = re.match(r"^@@IMG\s+(\S+)\s+([\d.]+)@@$", s)
        if m:
            blocks.append(("img", m.group(1), float(m.group(2))))
            i += 1
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            blocks.append(("h", len(m.group(1)), m.group(2).strip()))
            i += 1
            continue

        if s.startswith("- "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            blocks.append(("ul", items))
            continue

        if re.match(r"^\d+\.\s", s):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                items.append(lines[i].strip())
                i += 1
            blocks.append(("ol", items))
            continue

        if s.startswith("> "):
            items = []
            while i < len(lines) and lines[i].strip().startswith("> "):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            blocks.append(("quote", " ".join(items)))
            continue

        if s in ("---", "***", ""):
            i += 1
            continue

        buf = [s]
        i += 1
        while i < len(lines):
            nxt = lines[i].strip()
            if not nxt or nxt.startswith(("#", "|", "```", "- ", "> ")) or re.match(r"^\d+\.\s", nxt):
                break
            buf.append(nxt)
            i += 1
        blocks.append(("p", "".join(buf)))
    return blocks


# ------------------------------------------------------------------ docx helpers


def cancel_numbering(par):
    pPr = par._p.get_or_add_pPr()
    numPr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    numId = OxmlElement("w:numId")
    numId.set(qn("w:val"), "0")
    numPr.append(ilvl)
    numPr.append(numId)
    style = pPr.find(qn("w:pStyle"))
    if style is not None:
        style.addnext(numPr)
    else:
        pPr.insert(0, numPr)


def add_runs(par, text, base_bold=False, size=None, color=None):
    text = LINK_RE.sub(lambda m: f"{m.group(1)}〔{m.group(2)}〕", text)
    tokens = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
    for tok in tokens:
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**") and len(tok) > 4:
            run = par.add_run(tok[2:-2].replace("`", ""))
            run.bold = True
        elif tok.startswith("`") and tok.endswith("`") and len(tok) > 2:
            run = par.add_run(tok[1:-1])
            run.font.name = "Consolas"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")
            if size:
                run.font.size = size
        else:
            run = par.add_run(tok.replace("`", "").replace("**", ""))
            if base_bold:
                run.bold = True
            if size:
                run.font.size = size
        if color:
            run.font.color.rgb = color


def shade(cell, hex_color="F2F2F2"):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


def add_table(doc, rows):
    cells = []
    for r in rows:
        cells.append([c.strip() for c in r.strip("|").split("|")])
    if len(cells) < 2:
        return
    header, body = cells[0], cells[2:]
    ncols = len(header)

    table = doc.add_table(rows=1 + len(body), cols=ncols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True

    trPr = table.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:tblHeader"))

    for c, text in enumerate(header):
        cell = table.rows[0].cells[c]
        cell.text = ""
        par = cell.paragraphs[0]
        par.paragraph_format.space_before = Pt(2)
        par.paragraph_format.space_after = Pt(2)
        add_runs(par, text, base_bold=True, size=Pt(9))
        shade(cell)

    for row_obj in table.rows:
        row_obj._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))

    for r, row in enumerate(body, start=1):
        for c in range(ncols):
            text = row[c] if c < len(row) else ""
            cell = table.rows[r].cells[c]
            cell.text = ""
            par = cell.paragraphs[0]
            par.paragraph_format.space_before = Pt(1)
            par.paragraph_format.space_after = Pt(1)
            add_runs(par, text, size=Pt(9))

    def weight(s):
        return sum(2 if ord(ch) > 127 else 1 for ch in s)

    weights = []
    for c in range(ncols):
        longest = max([weight(header[c])] + [weight(r[c]) if c < len(r) else 0 for r in body])
        weights.append(max(longest, 6))

    total_cm = 14.6
    min_cm = 2.4
    raw = [total_cm * w / sum(weights) for w in weights]
    raw = [max(x, min_cm) for x in raw]
    scale = total_cm / sum(raw)
    widths = [x * scale for x in raw]

    for idx, cm in enumerate(widths):
        table.columns[idx].width = Cm(cm)
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            cell.width = Cm(widths[idx])

    doc.add_paragraph().paragraph_format.space_after = Pt(2)


# ------------------------------------------------------------------ template


def trim_front_matter(doc):
    """删掉图目录与模板示例正文，并把文档收敛成单节。"""
    body = doc.element.body
    children = list(body.iterchildren())
    fig = body_start = None
    for idx, ch in enumerate(children):
        if ch.tag != qn("w:p"):
            continue
        txt = "".join(t.text or "" for t in ch.iter(qn("w:t"))).strip().replace(" ", "")
        if txt == "图目录" and fig is None:
            fig = idx
        if txt == "概述" and body_start is None and fig is not None:
            body_start = idx
            break
    if fig is None or body_start is None:
        raise RuntimeError(f"模板结构不符：未找到『图目录』或『概述』(fig={fig}, body_start={body_start})")

    first_sect = None
    for ch in children:
        if ch.tag != qn("w:p"):
            continue
        pPr = ch.find(qn("w:pPr"))
        if pPr is not None and pPr.find(qn("w:sectPr")) is not None:
            first_sect = pPr.find(qn("w:sectPr"))
            break

    targets = children[fig:body_start] + children[body_start:]
    for ch in targets:
        if ch.tag == qn("w:sectPr"):
            continue
        body.remove(ch)

    for para in list(body.iter(qn("w:p"))):
        pPr = para.find(qn("w:pPr"))
        if pPr is None:
            continue
        sp = pPr.find(qn("w:sectPr"))
        if sp is None:
            continue
        pPr.remove(sp)
        if pPr.find(qn("w:pageBreakBefore")) is None:
            pPr.insert(0, OxmlElement("w:pageBreakBefore"))

    final = body.find(qn("w:sectPr"))
    if final is not None and first_sect is not None:
        new_sect = copy.deepcopy(first_sect)
        body.replace(final, new_sect)

    return len(targets)


def fill_cover(doc, meta):
    for p in doc.paragraphs:
        try:
            style = p.style.name if p.style is not None else ""
        except Exception:
            style = ""
        if style == "封面表标题" and p.text.strip().startswith("XXXXXX"):
            p.runs[0].text = meta["title"]
            for r in p.runs[1:]:
                r.text = ""

    for t in doc.tables:
        for row in t.rows:
            if len(row.cells) < 2:
                continue
            label = row.cells[0].text.strip().rstrip("：:")
            if label in meta:
                cell = row.cells[1]
                par = cell.paragraphs[0]
                if par.runs:
                    par.runs[0].text = meta[label]
                    for r in par.runs[1:]:
                        r.text = ""
                else:
                    par.add_run(meta[label])


def fill_revision(doc, args):
    values = [args.version, args.revision_note, args.author or "待定", args.date]
    for t in doc.tables:
        if len(t.rows) < 2 or len(t.rows[0].cells) < 4:
            continue
        if t.rows[0].cells[0].text.strip() != "版本":
            continue
        for c, v in enumerate(values):
            cell = t.rows[1].cells[c]
            par = cell.paragraphs[0]
            if par.runs:
                run = par.runs[0]
                run.text = v
                for r in par.runs[1:]:
                    r.text = ""
            else:
                run = par.add_run(v)
            run.font.name = "宋体"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
            run.font.size = Pt(10.5)
            run.bold = False
            pPr = par._p.find(qn("w:pPr"))
            if pPr is not None:
                rPr = pPr.find(qn("w:rPr"))
                if rPr is not None:
                    for tag in ("w:sz", "w:szCs", "w:b", "w:bCs"):
                        el = rPr.find(qn(tag))
                        if el is not None:
                            rPr.remove(el)
        for row in list(t.rows)[2:]:
            row._element.getparent().remove(row._element)
        break


# ------------------------------------------------------------------ build


def build(args):
    md_path = Path(args.md)
    out_path = Path(args.out)
    template = Path(args.template)

    if not md_path.is_file():
        raise RuntimeError(f"Markdown 源文件不存在：{md_path}")
    if not template.is_file():
        raise RuntimeError(f"模板文件不存在：{template}")

    blocks = parse(md_path.read_text(encoding="utf-8"))
    doc = Document(str(template))
    trim_front_matter(doc)

    meta = {
        "title": args.title,
        "密级": args.classification,
        "编制": args.author or "待定",
        "校对": args.checker or "待定",
        "审核": args.reviewer or "待定",
    }
    if args.doc_number:
        meta["文件编号"] = args.doc_number

    fill_cover(doc, meta)
    fill_revision(doc, args)

    started = False
    for blk in blocks:
        kind = blk[0]

        if kind == "h":
            level, text = blk[1], blk[2]
            if level == 1:
                continue  # 文档标题已在封面体现
            nlevel = {2: 1, 3: 2, 4: 3}.get(level, 3)
            clean = LINK_RE.sub(lambda m: m.group(1), text).replace("`", "").replace("**", "")
            h = doc.add_heading(clean, level=nlevel)
            cancel_numbering(h)
            started = True
            continue

        if not started:
            continue

        if kind == "p":
            par = doc.add_paragraph(style=BODY_STYLE)
            par.paragraph_format.first_line_indent = Cm(0.74)
            add_runs(par, blk[1])

        elif kind == "ul":
            for item in blk[1]:
                par = doc.add_paragraph(style=BODY_STYLE)
                par.paragraph_format.left_indent = Cm(0.74)
                par.paragraph_format.first_line_indent = Cm(-0.37)
                add_runs(par, "· " + item)

        elif kind == "ol":
            for item in blk[1]:
                par = doc.add_paragraph(style=BODY_STYLE)
                par.paragraph_format.left_indent = Cm(0.74)
                par.paragraph_format.first_line_indent = Cm(-0.37)
                add_runs(par, item)

        elif kind == "quote":
            par = doc.add_paragraph(style=BODY_STYLE)
            par.paragraph_format.left_indent = Cm(0.74)
            par.paragraph_format.space_before = Pt(3)
            par.paragraph_format.space_after = Pt(3)
            add_runs(par, blk[1])
            for r in par.runs:
                r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)

        elif kind == "code":
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Cm(0.6)
            par.paragraph_format.space_before = Pt(4)
            par.paragraph_format.space_after = Pt(4)
            par.paragraph_format.line_spacing = 1.0
            par.paragraph_format.keep_together = True
            run = par.add_run(blk[1])
            run.font.name = "Consolas"
            run._element.rPr.rFonts.set(qn("w:eastAsia"), "Consolas")
            run.font.size = Pt(8.5)
            pPr = par._p.get_or_add_pPr()
            shd = OxmlElement("w:shd")
            shd.set(qn("w:val"), "clear")
            shd.set(qn("w:color"), "auto")
            shd.set(qn("w:fill"), "F5F5F5")
            pPr.append(shd)

        elif kind == "table":
            add_table(doc, blk[1])

        elif kind == "img":
            raw = blk[1]
            path = Path(raw)
            if not path.is_absolute():
                path = Path(args.base_dir) / raw if args.base_dir else (md_path.parent / raw)
            if path.exists():
                doc.add_picture(str(path), width=Cm(blk[2]))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                doc.paragraphs[-1].paragraph_format.space_after = Pt(8)
            else:
                print(f"warning: missing image {path}", file=sys.stderr)

    settings = doc.settings.element
    for el in settings.findall(qn("w:updateFields")):
        settings.remove(el)
    uf = OxmlElement("w:updateFields")
    uf.set(qn("w:val"), "true")
    settings.append(uf)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    return {"ok": True, "path": str(out_path), "blocks": len(blocks), "bytes": out_path.stat().st_size}


def main():
    # Windows 管道输出默认走本地代码页，必须固定 UTF-8，否则插件侧解析中文路径会乱码。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="JSWJ Word 渲染器")
    parser.add_argument("--md", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--base-dir", dest="base_dir", default="")
    parser.add_argument("--title", required=True)
    parser.add_argument("--classification", default="L2 重要/秘密")
    parser.add_argument("--author", default="")
    parser.add_argument("--checker", default="待定")
    parser.add_argument("--reviewer", default="待定")
    parser.add_argument("--doc-number", dest="doc_number", default="")
    parser.add_argument("--version", default="A0")
    parser.add_argument("--revision-note", dest="revision_note", default="1 期方案初版")
    parser.add_argument("--date", default="")
    args = parser.parse_args()
    if not args.date:
        from datetime import date

        args.date = date.today().strftime("%Y.%m.%d")

    try:
        result = build(args)
    except Exception as exc:  # noqa: BLE001 - 需要把可读错误回传给插件
        print("JSWJ_RESULT " + json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        traceback.print_exc()
        sys.exit(1)

    print("JSWJ_RESULT " + json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

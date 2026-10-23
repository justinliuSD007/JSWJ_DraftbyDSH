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
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Emu, Pt, RGBColor

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

        m = re.match(r"^(图|表)\s*([0-9A-Za-z][0-9A-Za-z.-]*)\s*(.*)$", s)
        if m:
            blocks.append(("caption", m.group(1), m.group(2), m.group(3).strip()))
            i += 1
            continue

        # 少数源文件图题不带编号（如“图 安全性评估过程”），同样按模板图题排版
        m = re.match(r"^(图|表)\s+([^。；，,]{2,40})$", s)
        if m:
            blocks.append(("caption", m.group(1), "", m.group(2).strip()))
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
            while i < len(lines):
                current = lines[i].strip()
                if re.match(r"^\d+\.\s", current):
                    items.append(current)
                    i += 1
                    continue
                if not current:
                    j = i
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and re.match(r"^\d+\.\s", lines[j].strip()):
                        i = j
                        continue
                break
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


def shade(cell, hex_color="F1F1F1"):
    tcPr = cell._tc.get_or_add_tcPr()
    old = tcPr.find(qn("w:shd"))
    if old is not None:
        tcPr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tcPr.append(shd)


# GY-F003 模板正文表格：Normal Table 底样式 + 单线 0.5 磅边框、固定列宽 8124 dxa
# （14.33 cm）、表头 F1F1F1 底纹、表头垂直居中、单元格段落用「正文表格内容」。
TBL_W_DXA = 8124
TBL_CELL_STYLE = "正文表格内容"
IMG_STYLE = "图片"


def apply_template_table_format(table):
    """按 GY-F003 模板正文表格的 tblPr 重写表格属性。"""
    tblPr = table._tbl.tblPr
    for tag in ("w:tblW", "w:jc", "w:tblBorders", "w:shd", "w:tblLayout",
                "w:tblCellMar", "w:tblLook", "w:tblInd"):
        el = tblPr.find(qn(tag))
        if el is not None:
            tblPr.remove(el)

    style = tblPr.find(qn("w:tblStyle"))
    if style is None:
        style = OxmlElement("w:tblStyle")
        tblPr.insert(0, style)
    style.set(qn("w:val"), "26")

    def add_child(tag):
        el = OxmlElement(tag)
        tblPr.append(el)
        return el

    tblW = add_child("w:tblW")
    tblW.set(qn("w:w"), str(TBL_W_DXA))
    tblW.set(qn("w:type"), "dxa")

    jc = add_child("w:jc")
    jc.set(qn("w:val"), "center")

    borders = add_child("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        e = OxmlElement("w:" + edge)
        e.set(qn("w:val"), "single")
        e.set(qn("w:color"), "auto")
        e.set(qn("w:sz"), "4")
        e.set(qn("w:space"), "0")
        borders.append(e)

    shd = add_child("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), "auto")

    layout = add_child("w:tblLayout")
    layout.set(qn("w:type"), "fixed")

    cell_mar = add_child("w:tblCellMar")
    for name, width in (("top", "0"), ("left", "108"), ("bottom", "0"), ("right", "108")):
        m = OxmlElement("w:" + name)
        m.set(qn("w:w"), width)
        m.set(qn("w:type"), "dxa")
        cell_mar.append(m)


def add_table(doc, rows):
    cells = []
    for r in rows:
        cells.append([c.strip() for c in r.strip("|").split("|")])
    if len(cells) < 2:
        return
    # 只把真正的 Markdown 分隔行（|---|---|）当分隔行跳过，其余行都是内容，
    # 避免多行表头的第二行被误当分隔行丢掉。
    def is_sep(row):
        return bool(row) and all(re.fullmatch(r":?-{2,}:?", c or "") for c in row)

    header = cells[0]
    body = [r for r in cells[1:] if not is_sep(r)]
    ncols = len(header)

    # 字号与行距沿用模板「正文表格内容」样式（五号、单倍行距），不再压缩字号。
    table = doc.add_table(rows=1 + len(body), cols=ncols)
    apply_template_table_format(table)
    cell_style = TBL_CELL_STYLE

    trPr = table.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:tblHeader"))

    for c, text in enumerate(header):
        cell = table.rows[0].cells[c]
        cell.text = ""
        par = cell.paragraphs[0]
        try:
            par.style = doc.styles[cell_style]
        except KeyError:
            pass
        par.paragraph_format.first_line_indent = Cm(0)
        par.paragraph_format.left_indent = Cm(0)
        par.paragraph_format.space_before = Pt(0)
        par.paragraph_format.space_after = Pt(0)
        par.paragraph_format.line_spacing = 1.0
        par.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
        cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        add_runs(par, text, base_bold=True, color=RGBColor(0x00, 0x00, 0x00))
        shade(cell)

    for row_obj in table.rows:
        row_obj._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))

    for r, row in enumerate(body, start=1):
        for c in range(ncols):
            text = row[c] if c < len(row) else ""
            cell = table.rows[r].cells[c]
            cell.text = ""
            par = cell.paragraphs[0]
            try:
                par.style = doc.styles[cell_style]
            except KeyError:
                pass
            par.paragraph_format.first_line_indent = Cm(0)
            par.paragraph_format.left_indent = Cm(0)
            par.paragraph_format.space_before = Pt(0)
            par.paragraph_format.space_after = Pt(0)
            par.paragraph_format.line_spacing = 1.0
            par.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE
            cell.vertical_alignment = WD_ALIGN_VERTICAL.TOP
            add_runs(par, text, color=RGBColor(0x00, 0x00, 0x00))

    def weight(s):
        return sum(2 if ord(ch) > 127 else 1 for ch in s)

    weights = []
    min_widths = []
    for c in range(ncols):
        texts = [header[c]] + [r[c] if c < len(r) else "" for r in body]
        longest = max(weight(t) for t in texts)
        weights.append(min(max(longest, 10), 45))
        # 列宽下限按“最长不可断词”（英文单词/编号）估算，避免 Integration 这类
        # 单词被逐字母折断；中文列至少留出约 2 cm 的版面。
        token = 1
        for t in texts:
            for word in re.findall(r"[A-Za-z0-9][A-Za-z0-9./+-]*", t):
                token = max(token, len(word))
        # 表头必须尽量一行放得下，不能出现“时间进度安/排”这种拆字换行。
        header_min = min(2600, int(weight(header[c]) * 0.19 * 567) + 220)
        min_widths.append(max(1100, header_min, int(token * 0.19 * 567) + 220))

    total_dxa = TBL_W_DXA
    if sum(min_widths) >= total_dxa:
        # 最小宽度本身已超版面：按最小宽度等比压缩
        k = total_dxa / sum(min_widths)
        widths_dxa = [m * k for m in min_widths]
    else:
        # 迭代分配：先冻结放不下最小宽度的列，剩余宽度按权重分给其余列
        widths = [0.0] * ncols
        pending = set(range(ncols))
        remaining = float(total_dxa)
        while pending:
            share_sum = sum(weights[c] for c in pending)
            narrow = [c for c in pending if remaining * weights[c] / share_sum < min_widths[c]]
            if not narrow:
                break
            for c in narrow:
                widths[c] = min_widths[c]
                remaining -= min_widths[c]
                pending.discard(c)
        if pending:
            share_sum = sum(weights[c] for c in pending)
            for c in pending:
                widths[c] = remaining * weights[c] / share_sum
        widths_dxa = widths

    for idx, dxa in enumerate(widths_dxa):
        table.columns[idx].width = Emu(int(round(dxa * 635)))  # 1 dxa = 635 EMU
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            cell.width = Emu(int(round(widths_dxa[idx] * 635)))

    # 整表尽量落在同一页：放得下的小表把各行“与下段同页”串起来，Word 会把整表
    # 移到下一页，避免被换页截断；超过一页的大表不整表锁定（否则会把表题/引导句
    # 甩在上一页页末），只把表头行与首行数据锁在一起，分页处 repeat 表头。
    total_chars = sum(len("".join(r)) for r in body) + sum(len(x) for x in header)
    rows_list = list(table.rows)
    keep_whole = len(rows_list) <= 7 and total_chars <= 900
    chain = rows_list[:-1] if keep_whole else rows_list[:1]
    for row_obj in chain:
        for cell in row_obj.cells:
            for par in cell.paragraphs:
                par.paragraph_format.keep_with_next = True
    if rows_list:
        for cell in rows_list[-1].cells:
            for par in cell.paragraphs:
                par.paragraph_format.keep_together = True


def add_field(paragraph, instruction, result_text="—"):
    def run_with(child):
        run = OxmlElement("w:r")
        run.append(child)
        paragraph._p.append(run)

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    run_with(begin)

    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {instruction} "
    run_with(instr)

    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    run_with(separate)

    result = OxmlElement("w:t")
    result.text = str(result_text)
    run_with(result)

    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run_with(end)


def add_bookmark(paragraph, name):
    ident = str(abs(hash(name)) % 100000)
    start = OxmlElement("w:bookmarkStart")
    start.set(qn("w:id"), ident)
    start.set(qn("w:name"), name)
    end = OxmlElement("w:bookmarkEnd")
    end.set(qn("w:id"), ident)
    pPr = paragraph._p.pPr
    if pPr is not None:
        pPr.addnext(start)
    else:
        paragraph._p.insert(0, start)
    paragraph._p.append(end)


def add_caption(doc, kind, number, text, bookmark, chapter):
    """图/表题：题注样式 + SEQ 域；章号用正文标题号，供模板图目录/表目录汇总。"""
    paragraph = doc.add_paragraph(style="Caption")
    paragraph.add_run(f"{kind} {chapter}-")
    seq = str(number).split("-")[-1] if number else "1"
    add_field(paragraph, f"SEQ {kind} \\* ARABIC \\s 1", result_text=seq)
    if text:
        paragraph.add_run(f" {text}")
    paragraph.paragraph_format.keep_together = True
    if kind == "表":
        paragraph.paragraph_format.keep_with_next = True


def add_toc_entry(doc, heading, text, bookmark):
    paragraph = doc.add_paragraph(style="table of figures")
    paragraph.add_run(text)
    paragraph.add_run("\t")
    add_field(paragraph, f"PAGEREF {bookmark} \\h")
    heading._p.addnext(paragraph._p)
    return paragraph


def fill_static_toc(doc, headings, figures, tables):
    paragraphs = list(doc.paragraphs)
    fig_heading = tab_heading = None
    for p in paragraphs:
        normalized = p.text.replace(" ", "").replace("\u3000", "")
        if normalized == "图目录":
            fig_heading = p
        elif normalized == "表目录":
            tab_heading = p
    if fig_heading is None or tab_heading is None:
        return

    # 删掉模板自带的图目录、表目录示例条目和目录域
    fig_idx = paragraphs.index(fig_heading)
    tab_idx = paragraphs.index(tab_heading)
    for p in paragraphs[fig_idx + 1 : tab_idx]:
        p._element.getparent().remove(p._element)
    idx = tab_idx + 1
    while idx < len(paragraphs):
        candidate = paragraphs[idx]
        style_name = candidate.style.name
        if style_name == "table of figures" or (not candidate.text.strip() and style_name == "Normal"):
            candidate._element.getparent().remove(candidate._element)
            idx += 1
            continue
        break

    for caption in reversed(figures):
        add_toc_entry(doc, fig_heading, f"图 {caption['number']} {caption['text']}".strip(), caption["bookmark"])
    for caption in reversed(tables):
        add_toc_entry(doc, tab_heading, f"表 {caption['number']} {caption['text']}".strip(), caption["bookmark"])


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

    targets = children[body_start:]
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


def fill_headers(doc, number):
    """把文件编号写入页眉；模板页眉占位为「文件编号：XXXXXXXXXXX」。"""
    if not number:
        return
    for section in doc.sections:
        for paragraph in section.header.paragraphs:
            if "文件编号" not in paragraph.text:
                continue
            new_text = re.sub(r"文件编号\s*[:：]\s*X+", f"文件编号：{number}", paragraph.text)
            if new_text == paragraph.text:
                continue
            if paragraph.runs:
                paragraph.runs[0].text = new_text
                for run in paragraph.runs[1:]:
                    run.text = ""
            else:
                paragraph.add_run(new_text)


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

    blocks = parse(md_path.read_text(encoding="utf-8").lstrip("\ufeff"))
    doc = Document(str(template))
    trim_front_matter(doc)

    meta = {
        "title": args.title,
        "密级": args.classification,
        "编制": args.author or "待定",
        "校对": args.checker or "待定",
        "审核": args.reviewer or "待定",
        "批准": args.approver or "待定",
        "版本": args.version,
    }
    if args.doc_number:
        meta["文件编号"] = args.doc_number

    fill_cover(doc, meta)
    fill_headers(doc, args.doc_number)
    fill_revision(doc, args)

    started = False
    headings = []
    heading_seq = 0
    figures = []
    tables = []
    caption_seq = 0
    current_chapter = "1"
    for bi, blk in enumerate(blocks):
        kind = blk[0]

        if kind == "h":
            level, text = blk[1], blk[2]
            if level == 1:
                continue  # 文档标题已在封面体现
            nlevel = {2: 1, 3: 2, 4: 3}.get(level, 3)
            clean = LINK_RE.sub(lambda m: m.group(1), text).replace("`", "").replace("**", "")
            chapter_match = re.match(r"\s*(\d+)", clean)
            if nlevel == 1 and chapter_match:
                current_chapter = chapter_match.group(1)
            h = doc.add_heading(clean, level=nlevel)
            cancel_numbering(h)
            # 标题不与正文分页：章/节标题不落在页末
            h.paragraph_format.keep_with_next = True
            h.paragraph_format.keep_together = True
            heading_seq += 1
            bookmark = f"_JswjH{heading_seq}"
            add_bookmark(h, bookmark)
            headings.append({"level": nlevel, "text": clean, "bookmark": bookmark})
            started = True
            continue

        if not started:
            continue

        if kind == "p":
            par = doc.add_paragraph(style=BODY_STYLE)
            par.paragraph_format.first_line_indent = Cm(0.74)
            par.paragraph_format.widow_control = True
            add_runs(par, blk[1])

        elif kind == "ul":
            for item in blk[1]:
                par = doc.add_paragraph(style=BODY_STYLE)
                par.paragraph_format.left_indent = Cm(0.74)
                par.paragraph_format.first_line_indent = Cm(-0.37)
                add_runs(par, "· " + item)

        elif kind == "ol":
            for idx, item in enumerate(blk[1], start=1):
                par = doc.add_paragraph(style=BODY_STYLE)
                par.paragraph_format.left_indent = Cm(0.74)
                par.paragraph_format.first_line_indent = Cm(-0.37)
                text = re.sub(r"^\s*\d+\.\s*", "", item)
                add_runs(par, f"{idx}. {text}")

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

        elif kind == "caption":
            caption_seq += 1
            bookmark = f"_JswjCap{caption_seq}"
            add_caption(doc, blk[1], blk[2], blk[3], bookmark, current_chapter)
            entry = {"number": blk[2], "text": blk[3], "bookmark": bookmark}
            if blk[1] == "图":
                figures.append(entry)
            else:
                tables.append(entry)

        elif kind == "table":
            # 表题、以及紧贴表格的引导句（如“……见下表。”）都要与表格同页，
            # 避免引导句单独留在上一页页末。
            if doc.paragraphs:
                cap = doc.paragraphs[-1]
                lead = cap.text.strip()
                if lead.startswith("表") or (len(lead) <= 60 and "表" in lead):
                    cap.paragraph_format.keep_with_next = True
                    cap.paragraph_format.keep_together = True
            add_table(doc, blk[1])

        elif kind == "img":
            raw = blk[1]
            path = Path(raw)
            if not path.is_absolute():
                path = Path(args.base_dir) / raw if args.base_dir else (md_path.parent / raw)
            if path.exists():
                par = doc.add_paragraph(style=IMG_STYLE)
                par.add_run().add_picture(str(path), width=Cm(blk[2]))
                par.paragraph_format.keep_together = True
                # 只有紧跟图题时才“与下段同页”，避免图片和后续正文/表格绑成一块，
                # 把插图顶到单独一页（留出整页空白）。
                nxt = blocks[bi + 1][0] if bi + 1 < len(blocks) else None
                if nxt == "caption":
                    par.paragraph_format.keep_with_next = True
            else:
                print(f"warning: missing image {path}", file=sys.stderr)

    # fill_static_toc(doc, headings, figures, tables)

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
    parser.add_argument("--approver", default="待定")
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

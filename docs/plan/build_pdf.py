#!/usr/bin/env python
"""Render the docs/plan/*.md files into one styled PDF using reportlab."""
import os
import re
import html

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    ListFlowable, ListItem, Preformatted, HRFlowable, KeepTogether
)
from reportlab.pdfgen import canvas as pdfcanvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = r"C:\Windows\Fonts"
pdfmetrics.registerFont(TTFont("Segoe", os.path.join(FONT_DIR, "segoeui.ttf")))
pdfmetrics.registerFont(TTFont("SegoeBold", os.path.join(FONT_DIR, "segoeuib.ttf")))
pdfmetrics.registerFont(TTFont("SegoeItalic", os.path.join(FONT_DIR, "segoeuii.ttf")))
pdfmetrics.registerFont(TTFont("SegoeBoldItalic", os.path.join(FONT_DIR, "segoeuiz.ttf")))
pdfmetrics.registerFontFamily(
    "Segoe", normal="Segoe", bold="SegoeBold", italic="SegoeItalic", boldItalic="SegoeBoldItalic"
)
pdfmetrics.registerFont(TTFont("Consolas", os.path.join(FONT_DIR, "consola.ttf")))
pdfmetrics.registerFont(TTFont("ConsolasBold", os.path.join(FONT_DIR, "consolab.ttf")))
pdfmetrics.registerFontFamily("Consolas", normal="Consolas", bold="ConsolasBold")

PLAN_DIR = r"E:\downloads edge\ultron-by-sagar-builds-main\ultron-by-sagar-builds-main\docs\plan"
OUT_PATH = r"E:\downloads edge\ultron-by-sagar-builds-main\ultron-by-sagar-builds-main\docs\plan\ULTRON-Advanced-Assistant-Plan.pdf"

FILES = [
    "00-overview.md",
    "01-file-system-access.md",
    "02-app-control.md",
    "03-whatsapp-automation.md",
    "04-voice-command-engine.md",
    "05-reactive-animation.md",
    "06-object-detection.md",
    "06b-screen-vision.md",
    "07-gesture-detection.md",
    "08-safety-and-permissions.md",
    "09-roadmap-milestones.md",
]

ACCENT = colors.HexColor("#0f6e7a")      # teal accent (Jarvis-ish)
ACCENT_DARK = colors.HexColor("#0a2a33")
TEXT_DARK = colors.HexColor("#1c1c1c")
MUTED = colors.HexColor("#5a5a5a")
CODE_BG = colors.HexColor("#f3f4f4")
TABLE_HEAD_BG = colors.HexColor("#0f6e7a")
TABLE_ROW_ALT = colors.HexColor("#f2f7f8")

styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    name="DocTitle", fontName="SegoeBold", fontSize=26, leading=30,
    textColor=ACCENT_DARK, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="DocSubtitle", fontName="Segoe", fontSize=12.5, leading=17,
    textColor=MUTED, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="H1", fontName="SegoeBold", fontSize=19, leading=23,
    textColor=ACCENT_DARK, spaceBefore=4, spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="H2", fontName="SegoeBold", fontSize=14.5, leading=18,
    textColor=ACCENT, spaceBefore=14, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H3", fontName="SegoeBold", fontSize=11.5, leading=15,
    textColor=TEXT_DARK, spaceBefore=10, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Body", fontName="Segoe", fontSize=9.8, leading=14.5,
    textColor=TEXT_DARK, spaceAfter=7, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="BulletItem", parent=styles["Body"], leftIndent=0, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="TOCEntry", fontName="Segoe", fontSize=11, leading=20,
    textColor=TEXT_DARK,
))
styles.add(ParagraphStyle(
    name="TableCell", fontName="Segoe", fontSize=8.6, leading=11.5,
    textColor=TEXT_DARK,
))
styles.add(ParagraphStyle(
    name="TableHead", fontName="SegoeBold", fontSize=8.8, leading=11.5,
    textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="CodeBlock", fontName="Consolas", fontSize=8, leading=11,
    textColor=TEXT_DARK, backColor=CODE_BG,
))

INLINE_CODE_RE = re.compile(r"`([^`]+)`")
BOLD_RE = re.compile(r"\*\*([^*]+)\*\*")
ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def inline_markup(text: str) -> str:
    text = html.escape(text, quote=False)

    # Protect inline code spans from bold/italic reinterpretation (e.g. `"*name*"`).
    code_spans = []

    def stash_code(m):
        code_spans.append(m.group(1))
        return f"\x00CODE{len(code_spans) - 1}\x00"

    text = INLINE_CODE_RE.sub(stash_code, text)
    text = LINK_RE.sub(lambda m: f'<link href="{html.escape(m.group(2))}" color="#0f6e7a"><u>{m.group(1)}</u></link>', text)
    text = BOLD_RE.sub(lambda m: f"<b>{m.group(1)}</b>", text)
    text = ITALIC_RE.sub(lambda m: f"<i>{m.group(1)}</i>", text)

    def restore_code(m):
        idx = int(m.group(1))
        return f'<font face="Consolas" size="8.6" backColor="#f3f4f4">{code_spans[idx]}</font>'

    text = re.sub(r"\x00CODE(\d+)\x00", restore_code, text)
    return text


def parse_table(lines):
    rows = []
    for line in lines:
        line = line.strip()
        if line.startswith("|"):
            line = line[1:]
        if line.endswith("|"):
            line = line[:-1]
        cells = [c.strip() for c in line.split("|")]
        rows.append(cells)
    return rows


def is_separator_row(cells):
    return all(re.fullmatch(r":?-{2,}:?", c.strip()) for c in cells if c.strip() != "")


def build_table_flowable(rows):
    header = rows[0]
    body = [r for i, r in enumerate(rows) if i != 1]  # drop separator row (index 1)
    data = []
    for r_idx, row in enumerate(body):
        style = styles["TableHead"] if r_idx == 0 else styles["TableCell"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])

    ncols = len(header)
    avail_width = 6.6 * inch
    col_width = avail_width / ncols
    t = Table(data, colWidths=[col_width] * ncols, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEAD_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cfd8d9")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TABLE_ROW_ALT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


LIST_MARKER_RE = re.compile(r"^([-*]\s+|\d+\.\s+)")
BLOCK_STARTER_RE = re.compile(r"^(#{1,3}\s|```|\|)")


def consume_continuation_lines(lines, i, n):
    """Collect soft-wrapped continuation lines that belong to the list item
    the caller just started (a line that isn't blank, isn't a new list
    marker, and isn't the start of another block construct)."""
    parts = []
    while i < n:
        s = lines[i].strip()
        if s == "" or LIST_MARKER_RE.match(s) or BLOCK_STARTER_RE.match(s):
            break
        parts.append(s)
        i += 1
    return parts, i


def parse_markdown_to_flowables(md_text, first_file=False):
    flow = []
    lines = md_text.split("\n")
    i = 0
    n = len(lines)
    para_buf = []

    def flush_para():
        if para_buf:
            text = " ".join(para_buf).strip()
            if text:
                flow.append(Paragraph(inline_markup(text), styles["Body"]))
            para_buf.clear()

    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            flush_para()
            i += 1
            continue

        # Fenced code block
        if stripped.startswith("```"):
            flush_para()
            i += 1
            code_lines = []
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            code_text = "\n".join(code_lines)
            pre = Preformatted(code_text, styles["CodeBlock"])
            code_table = Table([[pre]], colWidths=[6.6 * inch])
            code_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#d8dedf")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            flow.append(code_table)
            flow.append(Spacer(1, 8))
            continue

        # Headings
        m = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if m:
            flush_para()
            level = len(m.group(1))
            text = inline_markup(m.group(2))
            if level == 1:
                if not first_file or flow:
                    flow.append(PageBreak())
                flow.append(Paragraph(text, styles["H1"]))
                flow.append(HRFlowable(width="100%", thickness=1.4, color=ACCENT, spaceAfter=10))
            elif level == 2:
                flow.append(Paragraph(text, styles["H2"]))
            else:
                flow.append(Paragraph(text, styles["H3"]))
            i += 1
            continue

        # Table
        if stripped.startswith("|"):
            flush_para()
            table_lines = []
            while i < n and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = parse_table(table_lines)
            flow.append(Spacer(1, 4))
            flow.append(build_table_flowable(rows))
            flow.append(Spacer(1, 10))
            continue

        # Checklist item
        m = re.match(r"^[-*]\s+\[( |x|X)\]\s+(.*)$", stripped)
        if m:
            flush_para()
            checked = m.group(1).lower() == "x"
            box = '<font face="ConsolasBold" color="#0f6e7a">[x]</font>' if checked else '<font face="Consolas">[&nbsp;&nbsp;]</font>'
            text = inline_markup(m.group(2))
            flow.append(Paragraph(f"{box}&nbsp;&nbsp;{text}", styles["BulletItem"]))
            i += 1
            continue

        # Bullet list item
        m = re.match(r"^[-*]\s+(.*)$", stripped)
        if m:
            flush_para()
            items = []
            while i < n and re.match(r"^[-*]\s+(.*)$", lines[i].strip()):
                item_text = re.match(r"^[-*]\s+(.*)$", lines[i].strip()).group(1)
                i += 1
                cont, i = consume_continuation_lines(lines, i, n)
                full_text = " ".join([item_text] + cont)
                items.append(Paragraph(inline_markup(full_text), styles["BulletItem"]))
            flow.append(ListFlowable(
                [ListItem(p, leftIndent=14, bulletColor=ACCENT) for p in items],
                bulletType="bullet", start="circle", leftIndent=14, spaceBefore=2, spaceAfter=8,
            ))
            continue

        # Numbered list item
        m = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if m:
            flush_para()
            items = []
            while i < n and re.match(r"^\d+\.\s+(.*)$", lines[i].strip()):
                item_text = re.match(r"^\d+\.\s+(.*)$", lines[i].strip()).group(1)
                i += 1
                cont, i = consume_continuation_lines(lines, i, n)
                full_text = " ".join([item_text] + cont)
                items.append(Paragraph(inline_markup(full_text), styles["BulletItem"]))
            flow.append(ListFlowable(
                [ListItem(p, leftIndent=14) for p in items],
                bulletType="1", start=1, leftIndent=14, spaceBefore=2, spaceAfter=8,
            ))
            continue

        # Regular paragraph line
        para_buf.append(stripped)
        i += 1

    flush_para()
    return flow


def make_cover_and_toc(entries):
    flow = []
    flow.append(Spacer(1, 1.6 * inch))
    flow.append(Paragraph("ULTRON", ParagraphStyle(
        name="CoverBrand", fontName="SegoeBold", fontSize=42, leading=50,
        textColor=ACCENT, alignment=TA_CENTER, spaceAfter=10,
    )))
    flow.append(Paragraph("Advanced Personal Assistant", ParagraphStyle(
        name="CoverTitle", fontName="SegoeBold", fontSize=20, leading=25,
        textColor=ACCENT_DARK, alignment=TA_CENTER, spaceAfter=8,
    )))
    flow.append(Paragraph("Master Plan &amp; Feature Roadmap", ParagraphStyle(
        name="CoverSub", fontName="Segoe", fontSize=13, leading=17,
        textColor=MUTED, alignment=TA_CENTER, spaceAfter=40,
    )))
    flow.append(HRFlowable(width="60%", thickness=1.2, color=ACCENT, hAlign="CENTER", spaceAfter=40))

    flow.append(Paragraph("Contents", styles["H2"]))
    toc_items = []
    for label, title in entries:
        toc_items.append(Paragraph(f"{label}&nbsp;&nbsp;&nbsp;{inline_markup(title)}", styles["TOCEntry"]))
    flow.append(ListFlowable(
        [ListItem(p, leftIndent=6, value=None, bulletColor=ACCENT) for p in toc_items],
        bulletType="bullet", start="-", leftIndent=6,
    ))
    return flow


def extract_title(md_text):
    m = re.search(r"^#\s+(.*)$", md_text, re.MULTILINE)
    return m.group(1).strip() if m else "Untitled"


def add_page_furniture(canv: pdfcanvas.Canvas, doc):
    canv.saveState()
    canv.setFont("Helvetica", 8)
    canv.setFillColor(MUTED)
    canv.drawString(0.75 * inch, 0.5 * inch, "ULTRON — Advanced Personal Assistant Plan")
    canv.drawRightString(LETTER[0] - 0.75 * inch, 0.5 * inch, f"Page {doc.page}")
    canv.setStrokeColor(colors.HexColor("#dfe6e7"))
    canv.line(0.75 * inch, 0.68 * inch, LETTER[0] - 0.75 * inch, 0.68 * inch)
    canv.restoreState()


def main():
    doc = SimpleDocTemplate(
        OUT_PATH, pagesize=LETTER,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch,
        title="ULTRON — Advanced Personal Assistant Plan",
        author="ULTRON Project",
    )

    all_flow = []
    entries = []
    file_flows = []

    for fname in FILES:
        path = os.path.join(PLAN_DIR, fname)
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        title = extract_title(text)
        label = re.match(r"^([0-9]+[a-z]?)-", fname).group(1)
        entries.append((label, title))
        file_flows.append(parse_markdown_to_flowables(text))

    all_flow.extend(make_cover_and_toc(entries))

    for idx, flows in enumerate(file_flows):
        all_flow.extend(flows)

    doc.build(all_flow, onFirstPage=add_page_furniture, onLaterPages=add_page_furniture)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()

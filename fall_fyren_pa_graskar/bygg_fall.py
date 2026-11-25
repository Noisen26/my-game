#!/usr/bin/env python3
"""Bygger fallet "Fyren på Gråskär" som en uppsättning PDF-filer med ReportLab.

Kör:  python3 bygg_fall.py            (skriver till ./utdata)
      python3 bygg_fall.py --ut mapp

Fallet är helt fiktivt. Alla personer, företag och händelser är påhittade.
"""
from __future__ import annotations

import argparse
import math
import os
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, CondPageBreak, Flowable, Frame, KeepTogether, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.lib.fonts import addMapping

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"

ARENDE = "K-2019-1047"
FALLNAMN = "Fyren på Gråskär"

# --------------------------------------------------------------------------
# Typsnitt
# --------------------------------------------------------------------------

def registrera_typsnitt() -> None:
    reg = {
        "Plex": "IBMPlexSans_400Regular.ttf",
        "Plex-It": "IBMPlexSans_400Regular_Italic.ttf",
        "Plex-Semi": "IBMPlexSans_600SemiBold.ttf",
        "Plex-Bold": "IBMPlexSans_700Bold.ttf",
        "Mono": "IBMPlexMono_400Regular.ttf",
        "Mono-It": "IBMPlexMono_400Regular_Italic.ttf",
        "Mono-Bold": "IBMPlexMono_700Bold.ttf",
        "Serif": "IBMPlexSerif_400Regular.ttf",
        "Serif-It": "IBMPlexSerif_400Regular_Italic.ttf",
        "Serif-Bold": "IBMPlexSerif_700Bold.ttf",
        "Elite": "SpecialElite_400Regular.ttf",
        "Hand": "Caveat_400Regular.ttf",
        "Hand-Bold": "Caveat_700Bold.ttf",
    }
    for namn, fil in reg.items():
        pdfmetrics.registerFont(TTFont(namn, str(FONTS / fil)))
    for fam, r, b, i in [("Plex", "Plex", "Plex-Bold", "Plex-It"),
                         ("Mono", "Mono", "Mono-Bold", "Mono-It"),
                         ("Serif", "Serif", "Serif-Bold", "Serif-It"),
                         ("Hand", "Hand", "Hand-Bold", "Hand")]:
        addMapping(fam, 0, 0, r)
        addMapping(fam, 1, 0, b)
        addMapping(fam, 0, 1, i)
        addMapping(fam, 1, 1, b)
    addMapping("Elite", 0, 0, "Elite")
    addMapping("Elite", 1, 0, "Elite")
    addMapping("Elite", 0, 1, "Elite")
    addMapping("Elite", 1, 1, "Elite")


# --------------------------------------------------------------------------
# Färger
# --------------------------------------------------------------------------
BLAK = colors.HexColor("#1B2428")       # bläck
GRA = colors.HexColor("#5B686D")        # dämpad text
LINJE = colors.HexColor("#B8C2C4")      # linjer
PAPPER = colors.HexColor("#FBFBF8")     # standardpapper
FORMULAR = colors.HexColor("#EEF2F2")   # myndighetsblankett
TIDNING = colors.HexColor("#F3F0E8")    # tidningspapper
LAB = colors.HexColor("#F4F6F8")        # labbrapport
HAV = colors.HexColor("#14232B")        # omslag
HAV_LJUS = colors.HexColor("#DCE5E7")   # vatten på kartan
LAND = colors.HexColor("#F1EEE4")       # land på kartan
GUL = colors.HexColor("#E3A800")        # regnrockens gula
STAMPEL = colors.HexColor("#B3261E")    # stämpelrött
BLA_PENNA = colors.HexColor("#22408A")  # kulspetspenna

PAGE_W, PAGE_H = A4
MARG = 20 * mm

# --------------------------------------------------------------------------
# Stilar
# --------------------------------------------------------------------------

def stilar():
    s = {}
    s["brod"] = ParagraphStyle("brod", fontName="Plex", fontSize=10, leading=14.5, textColor=BLAK, spaceAfter=6)
    s["brod_liten"] = ParagraphStyle("brod_liten", parent=s["brod"], fontSize=8.5, leading=12, textColor=GRA)
    s["h1"] = ParagraphStyle("h1", fontName="Plex-Bold", fontSize=17, leading=21, textColor=BLAK, spaceAfter=4)
    s["h2"] = ParagraphStyle("h2", fontName="Plex-Semi", fontSize=11.5, leading=15, textColor=BLAK, spaceBefore=8, spaceAfter=4, keepWithNext=1)
    s["etikett"] = ParagraphStyle("etikett", fontName="Plex-Semi", fontSize=7.2, leading=9, textColor=GRA)
    s["falt"] = ParagraphStyle("falt", fontName="Mono", fontSize=9.2, leading=12.5, textColor=BLAK)
    s["mono"] = ParagraphStyle("mono", fontName="Mono", fontSize=9.2, leading=13.5, textColor=BLAK, spaceAfter=5)
    s["mono_liten"] = ParagraphStyle("mono_liten", parent=s["mono"], fontSize=8, leading=11)
    s["fraga"] = ParagraphStyle("fraga", fontName="Mono-Bold", fontSize=9.2, leading=13.5, textColor=BLAK, leftIndent=24, firstLineIndent=-24, spaceBefore=5, spaceAfter=1)
    s["svar"] = ParagraphStyle("svar", fontName="Mono", fontSize=9.2, leading=13.5, textColor=BLAK, leftIndent=24, firstLineIndent=-24, spaceAfter=3)
    s["serif"] = ParagraphStyle("serif", fontName="Serif", fontSize=10.2, leading=15, textColor=BLAK, spaceAfter=7)
    s["serif_rubrik"] = ParagraphStyle("serif_rubrik", fontName="Serif-Bold", fontSize=22, leading=25, textColor=BLAK, spaceAfter=6)
    s["ingress"] = ParagraphStyle("ingress", fontName="Serif-Bold", fontSize=10.6, leading=15, textColor=BLAK, spaceAfter=7)
    s["tidning_spalt"] = ParagraphStyle("tidning_spalt", fontName="Serif", fontSize=9.4, leading=13.2, textColor=BLAK, spaceAfter=5, firstLineIndent=10)
    s["elite_stor"] = ParagraphStyle("elite_stor", fontName="Elite", fontSize=30, leading=34, textColor=BLAK)
    s["elite"] = ParagraphStyle("elite", fontName="Elite", fontSize=13, leading=17, textColor=BLAK)
    s["cell"] = ParagraphStyle("cell", fontName="Plex", fontSize=8.6, leading=11.2, textColor=BLAK)
    s["cell_mono"] = ParagraphStyle("cell_mono", fontName="Mono", fontSize=8.4, leading=11, textColor=BLAK)
    s["cell_head"] = ParagraphStyle("cell_head", fontName="Plex-Semi", fontSize=7.6, leading=9.5, textColor=GRA)
    s["hand"] = ParagraphStyle("hand", fontName="Hand", fontSize=17, leading=20, textColor=BLA_PENNA)
    s["uppdrag_nr"] = ParagraphStyle("uppdrag_nr", fontName="Elite", fontSize=15, leading=18, textColor=STAMPEL)
    s["uppdrag_fraga"] = ParagraphStyle("uppdrag_fraga", fontName="Plex-Bold", fontSize=20, leading=25, textColor=BLAK, spaceAfter=8)
    return s


S = None  # sätts i main()

# --------------------------------------------------------------------------
# Sidmallar
# --------------------------------------------------------------------------

def rita_stampel(c, text, x, y, vinkel=12, storlek=22, farg=STAMPEL, under=None):
    c.saveState()
    c.translate(x, y)
    c.rotate(vinkel)
    c.setFillColor(farg)
    c.setStrokeColor(farg)
    c.setFillAlpha(0.78)
    c.setStrokeAlpha(0.78)
    c.setFont("Elite", storlek)
    w = pdfmetrics.stringWidth(text, "Elite", storlek)
    pad = storlek * 0.4
    h = storlek * 1.25 + (storlek * 0.55 if under else 0)
    c.setLineWidth(2.2)
    c.roundRect(-w / 2 - pad, -h / 2, w + 2 * pad, h, 3, stroke=1, fill=0)
    bas = h / 2 - storlek * 1.0
    c.drawCentredString(0, bas, text)
    if under:
        c.setFont("Elite", storlek * 0.42)
        c.drawCentredString(0, bas - storlek * 0.5, under)
    c.restoreState()


class Akt(BaseDocTemplate):
    """Ett dokument i akten med gemensam sidhuvud/sidfot och valfri pappersfärg och stämpel."""

    def __init__(self, filnamn, bevisnr, titel, papper=PAPPER, stampel=None, sidhuvud=True, omslag=False, **kw):
        self.bevisnr = bevisnr
        self.titel = titel
        self.papper = papper
        self.stampel = stampel
        self.visa_sidhuvud = sidhuvud
        super().__init__(str(filnamn), pagesize=A4, leftMargin=MARG, rightMargin=MARG,
                         topMargin=MARG + 10 * mm, bottomMargin=MARG,
                         title=f"{bevisnr} {titel}" if bevisnr else titel,
                         author="Skuggarkivet", subject=f"{FALLNAMN} – ärende {ARENDE}", **kw)
        ram = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal",
                    leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        hel = Frame(0, 0, PAGE_W, PAGE_H, id="hel", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        mallar = [
            PageTemplate(id="akt", frames=[ram], onPage=self._sida, onPageEnd=self._sida_slut),
            PageTemplate(id="omslag", frames=[hel], onPage=self._omslag_bg),
        ]
        self.addPageTemplates(mallar[::-1] if omslag else mallar)

    def _omslag_bg(self, c, doc):
        pass

    def _sida(self, c, doc):
        c.saveState()
        c.setFillColor(self.papper)
        c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        if self.visa_sidhuvud:
            y = PAGE_H - MARG + 2 * mm
            c.setFont("Plex-Semi", 7.5)
            c.setFillColor(GRA)
            c.drawString(MARG, y, f"SKUGGARKIVET  ·  ÄRENDE {ARENDE}  ·  {FALLNAMN.upper()}")
            if self.bevisnr:
                c.setFillColor(BLAK)
                c.setFont("Elite", 13)
                tw = pdfmetrics.stringWidth(self.bevisnr, "Elite", 13)
                c.rect(PAGE_W - MARG - tw - 10, y - 4, tw + 10, 17, stroke=1, fill=0)
                c.drawString(PAGE_W - MARG - tw - 5, y + 0.5, self.bevisnr)
            c.setStrokeColor(LINJE)
            c.setLineWidth(0.6)
            c.line(MARG, y - 7, PAGE_W - MARG, y - 7)
            c.setFont("Plex", 7)
            c.setFillColor(GRA)
            c.drawString(MARG, MARG - 9 * mm, "Fiktivt fall. Alla personer, företag och händelser är påhittade.")
            c.drawRightString(PAGE_W - MARG, MARG - 9 * mm, f"{self.titel}  ·  sida {doc.page}")
        c.restoreState()

    def _sida_slut(self, c, doc):
        if self.stampel and doc.page == self.stampel[5] and doc.pageTemplate.id == "akt":
            text, under, x, y, v, _ = self.stampel
            rita_stampel(c, text, x, y, vinkel=v, under=under)


def bygg(filnamn, bevisnr, titel, story, **kw):
    filnamn.parent.mkdir(parents=True, exist_ok=True)
    doc = Akt(filnamn, bevisnr, titel, **kw)
    doc.build(story)
    return filnamn


# --------------------------------------------------------------------------
# Byggstenar
# --------------------------------------------------------------------------

def P(text, stil="brod"):
    return Paragraph(text, S[stil] if isinstance(stil, str) else stil)


def luft(h=4):
    return Spacer(1, h * mm)


def faltrutor(rader, kolumner=2, bredd=None):
    """Blankettliknande rutor: [(etikett, värde), ...]."""
    bredd = bredd or (PAGE_W - 2 * MARG)
    celler = []
    rad = []
    for etikett, varde in rader:
        rad.append([P(etikett.upper(), "etikett"), P(varde, "falt")])
        if len(rad) == kolumner:
            celler.append(rad)
            rad = []
    if rad:
        while len(rad) < kolumner:
            rad.append("")
        celler.append(rad)
    t = Table(celler, colWidths=[bredd / kolumner] * kolumner)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BLAK),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINJE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def tabell(huvud, rader, bredder, mono=False, zebra=True, hl=None):
    st = "cell_mono" if mono else "cell"
    data = [[P(h, "cell_head") for h in huvud]]
    for r in rader:
        data.append([P(str(x), st) for x in r])
    t = Table(data, colWidths=bredder, repeatRows=1)
    stil = [
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, BLAK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINJE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]
    if zebra:
        for i in range(1, len(data)):
            if i % 2 == 0:
                stil.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F0F3F3")))
    for (rad) in (hl or []):
        stil.append(("BACKGROUND", (0, rad), (-1, rad), colors.HexColor("#FFF4CC")))
    t.setStyle(TableStyle(stil))
    return t


def forhor(rader):
    """Förhörsutskrift. rader = [('F', text) | ('S', text) | ('A', anteckning)]"""
    ut = []
    for vem, text in rader:
        if vem == "F":
            ut.append(P(f"F:&nbsp;&nbsp;{text}", "fraga"))
        elif vem == "S":
            ut.append(P(f"S:&nbsp;&nbsp;{text}", "svar"))
        else:
            ut.append(P(f"<i>[{text}]</i>", "mono_liten"))
    return ut


def forhorshuvud(namn, roll, datum, plats, forhorsledare, typ="Förhör med upplysningsperson", langd="–"):
    return [
        P(typ.upper(), "etikett"),
        P(namn, "h1"),
        faltrutor([
            ("Roll", roll), ("Datum och tid", datum),
            ("Plats", plats), ("Förhörsledare", forhorsledare),
            ("Ärende", f"{ARENDE} – dödsfall, Henrik Lindqvist"), ("Längd enl. körkorts- och passregister", langd),
        ]),
        luft(5),
    ]


class Ritning(Flowable):
    """Flowable som ritar med en funktion f(canvas, w, h)."""

    def __init__(self, w, h, f):
        super().__init__()
        self.w, self.h, self.f = w, h, f

    def wrap(self, aw, ah):
        return self.w, self.h

    def draw(self):
        self.f(self.canv, self.w, self.h)


# --------------------------------------------------------------------------
# Ritningar: karta, situationsskiss, anteckningsbok, kvitto, omslag
# --------------------------------------------------------------------------

def mjuk_kurva(c, pts, sluten=True):
    """Catmull–Rom till Bézier."""
    p = c.beginPath()
    n = len(pts)
    p.moveTo(*pts[0])
    rng = range(n) if sluten else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n] if sluten or i > 0 else pts[i]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if sluten or i + 2 < n else pts[(i + 1) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        p.curveTo(c1[0], c1[1], c2[0], c2[1], p2[0], p2[1])
    if sluten:
        p.close()
    return p


def rita_karta(c, w, h):
    # koordinatsystem 600 x 540 med y nedåt
    sk = min(w / 600, h / 540)
    ox = (w - 600 * sk) / 2

    def T(x, y):
        return ox + x * sk, h - y * sk

    c.saveState()
    c.setFillColor(HAV_LJUS)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    # vågstreck
    c.setStrokeColor(colors.HexColor("#B9C9CD"))
    c.setLineWidth(0.5)
    for i in range(14):
        y = 30 + i * 37
        for j in range(5):
            x = 20 + ((i * 53 + j * 131) % 560)
            x1, y1 = T(x, y)
            c.line(x1, y1, x1 + 14, y1)

    o = [(300, 18), (352, 34), (388, 92), (372, 160), (428, 206), (520, 246), (548, 300), (512, 352),
         (470, 402), (420, 444), (360, 484), (290, 506), (205, 492), (148, 452), (118, 392), (138, 330),
         (172, 282), (198, 228), (236, 168), (248, 100), (268, 44)]
    c.setFillColor(LAND)
    c.setStrokeColor(BLAK)
    c.setLineWidth(1.2)
    c.drawPath(mjuk_kurva(c, [T(*p) for p in o]), stroke=1, fill=1)

    # berghällar (enkla skraffer)
    c.setStrokeColor(colors.HexColor("#CFC8B5"))
    c.setLineWidth(0.6)
    for (x, y) in [(330, 50), (342, 62), (318, 120), (480, 300), (495, 315), (180, 360), (170, 375)]:
        a, b = T(x, y)
        c.line(a, b, a + 10 * sk, b - 4 * sk)

    def stig(pts, streck=(4, 3), bredd=1.3, farg=colors.HexColor("#7A6E55")):
        c.setStrokeColor(farg)
        c.setLineWidth(bredd)
        c.setDash(*streck) if streck else c.setDash()
        c.drawPath(mjuk_kurva(c, [T(*p) for p in pts], sluten=False), stroke=1, fill=0)
        c.setDash()

    # Fyrstigen (grind -> fyr)
    stig([(236, 226), (246, 170), (272, 118), (298, 84)], streck=None, bredd=2.2, farg=colors.HexColor("#8C7F62"))
    # Strandstigen (båthus -> öster -> fyr)
    stig([(300, 442), (378, 426), (452, 372), (482, 300), (430, 214), (362, 146), (312, 84)], streck=(5, 3))
    # gångar
    stig([(345, 285), (420, 318)], streck=(2, 2), bredd=1)
    stig([(300, 293), (300, 440)], streck=(2, 2), bredd=1)
    stig([(300, 440), (205, 420)], streck=(2, 2), bredd=1)
    stig([(345, 270), (470, 290), (530, 300)], streck=(2, 2), bredd=1)

    def hus(x, y, bw, bh, fyll=colors.white):
        a, b = T(x - bw / 2, y + bh / 2)
        c.setFillColor(fyll)
        c.setStrokeColor(BLAK)
        c.setLineWidth(1)
        c.rect(a, b, bw * sk, bh * sk, stroke=1, fill=1)

    def text(x, y, s, f="Plex", fs=7.4, farg=BLAK, align="l"):
        a, b = T(x, y)
        c.setFillColor(farg)
        c.setFont(f, fs)
        if align == "c":
            c.drawCentredString(a, b, s)
        elif align == "r":
            c.drawRightString(a, b, s)
        else:
            c.drawString(a, b, s)

    # Huvudbyggnad + gästflygel
    hus(305, 272, 112, 44)
    hus(207, 278, 52, 36)
    text(305, 270, "Huvudbyggnad", "Plex-Semi", 7.6, align="c")
    text(305, 280, "hall · kontor · salong · kök", fs=6.3, farg=GRA, align="c")
    text(207, 276, "Gästflygel", "Plex-Semi", 7, align="c")
    text(207, 285, "rum 1–4", fs=6.3, farg=GRA, align="c")
    # fönster rum 4 mot norr (mot grinden)
    a, b = T(203, 260)
    c.setFillColor(colors.HexColor("#9AA7AB"))
    c.rect(a, b - 1.2, 10 * sk, 3, stroke=0, fill=1)
    # rum 1 mot havet söderut
    a, b = T(219, 296)
    c.setFillColor(colors.HexColor("#9AA7AB"))
    c.rect(a, b - 1.2, 10 * sk, 3, stroke=0, fill=1)

    # Grind med rosenbåge
    gx, gy = T(236, 228)
    c.setStrokeColor(colors.HexColor("#8A3B4A"))
    c.setLineWidth(1.6)
    c.arc(gx - 7, gy - 5, gx + 7, gy + 9, 0, 180)
    c.line(gx - 7, gy + 2, gx - 7, gy - 4)
    c.line(gx + 7, gy + 2, gx + 7, gy - 4)
    # lykta
    c.setFillColor(GUL)
    c.circle(gx + 12, gy + 3, 2.2, stroke=0, fill=1)
    text(118, 210, "Grind med rosenbåge", "Plex-Semi", 7)
    text(118, 218, "lykta", fs=6.3, farg=GRA)

    # Personalhuset
    hus(420, 322, 72, 30)
    text(420, 320, "Personalhuset", "Plex-Semi", 7, align="c")
    text(420, 329, "rum 1 · rum 2", fs=6.3, farg=GRA, align="c")
    # fönster mot öster
    for dy in (-8, 2):
        a, b = T(456, 322 + dy)
        c.setFillColor(colors.HexColor("#9AA7AB"))
        c.rect(a - 1.5, b - 6, 3, 6, stroke=0, fill=1)

    # Båthuset
    hus(300, 452, 50, 26, fyll=colors.HexColor("#E8DCCB"))
    text(300, 455, "Båthuset", "Plex-Semi", 7, align="c")
    text(300, 476, "(kamin, båten Tärnan på land)", fs=6.3, farg=GRA, align="c")
    # Lotsstugan
    hus(200, 420, 46, 22)
    text(200, 423, "Lotsstugan", "Plex-Semi", 6.6, align="c")
    text(200, 442, "(Anders Holm)", fs=6.3, farg=GRA, align="c")
    # Brygga
    a, b = T(540, 296)
    c.setFillColor(colors.HexColor("#8C7F62"))
    c.rect(a, b - 3, 48 * sk, 6, stroke=0, fill=1)
    text(512, 282, "Ångbåtsbryggan", "Plex-Semi", 7)
    text(512, 290, "färja till Tranvik", fs=6.3, farg=GRA)

    # Fyren
    fx, fy = T(300, 72)
    c.setFillColor(colors.white)
    c.setStrokeColor(BLAK)
    c.setLineWidth(1.3)
    c.circle(fx, fy, 9, stroke=1, fill=1)
    c.setFillColor(GUL)
    c.circle(fx, fy, 3.2, stroke=0, fill=1)
    c.setStrokeColor(BLAK)
    c.setLineWidth(0.6)
    for k in range(10):
        ang = math.radians(200 + k * 14)
        c.line(fx + 11 * math.cos(ang), fy + 11 * math.sin(ang), fx + 15 * math.cos(ang), fy + 15 * math.sin(ang))
    text(316, 66, "Gråskärs fyr", "Plex-Semi", 7.6)
    text(316, 75, "yttre spiraltrappa (gjutjärn)", fs=6.3, farg=GRA)
    text(330, 30, "Norra udden", "Plex-It", 6.8, farg=GRA)
    text(330, 38, "(planerad vindkraft)", "Plex-It", 6.3, farg=GRA)

    # stiganteckningar
    text(196, 160, "Fyrstigen", "Plex-It", 6.8, farg=GRA)
    text(196, 168, "ca 350 m", "Plex-It", 6.3, farg=GRA)
    text(452, 220, "Strandstigen", "Plex-It", 6.8, farg=GRA)
    text(452, 228, "ca 600 m", "Plex-It", 6.3, farg=GRA)

    # fönster på övriga hus (horisontella = norr/söder, vertikala = öster/väster)
    def fonster(x, y, liggande=True):
        a, b = T(x, y)
        c.setFillColor(colors.HexColor("#9AA7AB"))
        if liggande:
            c.rect(a, b - 1.2, 9 * sk, 3, stroke=0, fill=1)
        else:
            c.rect(a - 1.5, b - 6, 3, 6, stroke=0, fill=1)
    for x in (262, 290, 318, 346):
        fonster(x, 250)
        fonster(x, 294)
    fonster(361, 268, False)
    fonster(184, 278, False)
    fonster(223, 402, False)
    fonster(196, 431)
    # dörrar: personalentré (söder), huvudbyggnadens ytterdörr (norr), köksdörr (öster)
    c.setFillColor(BLAK)
    for (dx, dy) in ((412, 337), (300, 251)):
        a, b = T(dx, dy)
        c.rect(a, b - 1.5, 7 * sk, 3, stroke=0, fill=1)
    a, b = T(361, 286)
    c.rect(a - 1.5, b - 7, 3, 7, stroke=0, fill=1)
    # teckenförklaring
    lx, ly = T(40, 470)
    c.setFillColor(colors.HexColor("#9AA7AB"))
    c.rect(lx, ly, 9, 3, stroke=0, fill=1)
    c.setFillColor(BLAK)
    c.rect(lx, ly - 10, 9, 3, stroke=0, fill=1)
    c.setFont("Plex", 6.5)
    c.drawString(lx + 13, ly - 0.5, "fönster")
    c.drawString(lx + 13, ly - 10.5, "dörr")

    # Nordpil
    nx, ny = T(560, 60)
    c.setFillColor(BLAK)
    p = c.beginPath()
    p.moveTo(nx, ny + 16)
    p.lineTo(nx - 6, ny - 6)
    p.lineTo(nx, ny - 1)
    p.lineTo(nx + 6, ny - 6)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFont("Plex-Bold", 9)
    c.drawCentredString(nx, ny + 20, "N")

    # Skala: 100 m ≈ 57 enheter
    sx, sy = T(40, 515)
    c.setStrokeColor(BLAK)
    c.setLineWidth(1)
    l = 57 * sk
    c.line(sx, sy, sx + 2 * l, sy)
    for k in range(3):
        c.line(sx + k * l, sy - 3, sx + k * l, sy + 3)
    c.setFillColor(BLAK)
    c.rect(sx, sy - 1.5, l, 3, stroke=0, fill=1)
    c.setFont("Plex", 6.5)
    c.drawString(sx - 2, sy + 6, "0")
    c.drawString(sx + l - 8, sy + 6, "100")
    c.drawString(sx + 2 * l - 8, sy + 6, "200 m")
    c.setStrokeColor(BLAK)
    c.setLineWidth(0.8)
    c.rect(0, 0, w, h, stroke=1, fill=0)
    c.restoreState()


def rita_situationsskiss(c, w, h):
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(BLAK)
    c.rect(0, 0, w, h, stroke=1, fill=1)
    # rutnät
    c.setStrokeColor(colors.HexColor("#E3E8E9"))
    c.setLineWidth(0.4)
    step = 14
    for x in range(0, int(w), step):
        c.line(x, 0, x, h)
    for y in range(0, int(h), step):
        c.line(0, y, w, y)

    cx, cy = w * 0.68, h * 0.62
    # fyrtornets bas
    c.setStrokeColor(BLAK)
    c.setLineWidth(1.6)
    c.setFillColor(colors.HexColor("#F1F1EE"))
    c.circle(cx, cy, 62, stroke=1, fill=1)
    c.setFont("Plex-Semi", 8)
    c.setFillColor(BLAK)
    c.drawCentredString(cx, cy + 4, "FYRTORNET")
    c.setFont("Plex", 7)
    c.setFillColor(GRA)
    c.drawCentredString(cx, cy - 7, "dörr låst, nyckel i H:s ficka")
    # dörr
    c.setStrokeColor(BLAK)
    c.setLineWidth(3)
    c.line(cx - 12, cy + 62, cx + 12, cy + 62)
    # spiraltrappa: steg runt tornet på västra sidan
    c.setLineWidth(0.8)
    for k in range(9):
        a = math.radians(170 + k * 13)
        r1, r2 = 64, 84
        c.line(cx + r1 * math.cos(a), cy + r1 * math.sin(a), cx + r2 * math.cos(a), cy + r2 * math.sin(a))
    c.arc(cx - 84, cy - 84, cx + 84, cy + 84, 165, 110)
    # nedersta steget
    a = math.radians(170 + 8 * 13)
    bx, by = cx + 74 * math.cos(a), cy + 74 * math.sin(a)

    kx, ky = bx - 110, by - 40

    # kroppskontur (ryggläge, huvudet mot nedersta steget)
    c.setStrokeColor(BLAK)
    c.setLineWidth(1.4)
    hx, hy = kx + 124, ky
    c.circle(hx, hy, 9, stroke=1, fill=0)
    c.line(hx - 10, hy, hx - 64, hy + 2)              # bål
    c.line(hx - 64, hy + 2, hx - 112, hy + 12)       # ben
    c.line(hx - 64, hy + 2, hx - 112, hy - 8)
    c.line(hx - 18, hy + 3, hx - 40, hy + 20)        # armar
    c.line(hx - 18, hy - 3, hx - 42, hy - 18)
    # blod
    c.setFillColor(STAMPEL)
    c.setFillAlpha(0.65)
    c.circle(hx + 7, hy - 3, 3.4, stroke=0, fill=1)
    c.setFillAlpha(1)

    def etikett(x, y, txt, tx, ty):
        c.setStrokeColor(BLAK)
        c.setLineWidth(0.5)
        c.line(x, y, tx, ty)
        c.setFillColor(BLAK)
        c.setFont("Plex", 7)
        c.drawString(tx + 2, ty - 2, txt)

    a2 = math.radians(200)
    etikett(cx + 84 * math.cos(a2), cy + 84 * math.sin(a2), "Yttre spiraltrappa, gjutjärn, vitmålad", 24, cy + 40)
    etikett(bx + 6, by, "Nedersta trappsteget", cx + 70, by - 4)
    etikett(kx + 40, ky + 2, "Den avlidne, ryggläge", 24, ky + 75)
    etikett(hx + 8, hy - 4, "Blod", hx - 20, ky - 62)

    # nordpil och skala
    c.setFillColor(BLAK)
    nx, ny = 26, h - 30
    p = c.beginPath()
    p.moveTo(nx, ny + 14)
    p.lineTo(nx - 5, ny - 5)
    p.lineTo(nx, ny - 1)
    p.lineTo(nx + 5, ny - 5)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFont("Plex-Bold", 8)
    c.drawCentredString(nx, ny + 17, "N")
    c.setFont("Plex", 6.8)
    c.drawString(14, 12, "Rutnät 0,5 m. Ej skalenlig i detalj. Ritad av insp. E. Lund 2019-10-12.")
    c.restoreState()


def rita_anteckningsbok(rader):
    def f(c, w, h):
        c.saveState()
        c.setFillColor(colors.HexColor("#FFFDF5"))
        c.setStrokeColor(colors.HexColor("#C9C2AE"))
        c.setLineWidth(0.8)
        c.rect(0, 0, w, h, stroke=1, fill=1)
        # spiral
        c.setFillColor(colors.HexColor("#8E8E8E"))
        for y in range(18, int(h) - 10, 22):
            c.circle(12, y, 3.2, stroke=0, fill=1)
        # linjer
        c.setStrokeColor(colors.HexColor("#BCD1E0"))
        c.setLineWidth(0.5)
        rad_h = 22
        y0 = h - 44
        y = y0
        while y > 14:
            c.line(30, y, w - 12, y)
            y -= rad_h
        c.setStrokeColor(colors.HexColor("#E8A0A0"))
        c.line(58, 4, 58, h - 4)
        # text
        y = y0 + 4
        for rad in rader:
            if isinstance(rad, tuple):
                txt, opt = rad
            else:
                txt, opt = rad, {}
            if txt is None:
                y -= rad_h
                continue
            font = "Hand-Bold" if opt.get("fet") else "Hand"
            fs = opt.get("fs", 17)
            c.setFont(font, fs)
            c.setFillColor(opt.get("farg", BLA_PENNA))
            x = 66 + opt.get("indrag", 0)
            c.drawString(x, y, txt)
            if opt.get("understruken"):
                tw = pdfmetrics.stringWidth(txt, font, fs)
                c.setStrokeColor(BLA_PENNA)
                c.setLineWidth(1)
                c.line(x, y - 3, x + tw, y - 2)
            if opt.get("ringad"):
                tw = pdfmetrics.stringWidth(txt, font, fs)
                c.setStrokeColor(BLA_PENNA)
                c.setLineWidth(1)
                c.ellipse(x - 6, y - 8, x + tw + 6, y + fs - 2)
            if opt.get("overstruken"):
                tw = pdfmetrics.stringWidth(txt, font, fs)
                c.setStrokeColor(BLA_PENNA)
                c.setLineWidth(1.2)
                c.line(x - 2, y + 5, x + tw + 2, y + 7)
            y -= rad_h
        c.restoreState()
    return f


def rita_kvitto(c, w, h):
    c.saveState()
    c.setFillColor(colors.white)
    c.setStrokeColor(LINJE)
    # tandad underkant
    p = c.beginPath()
    p.moveTo(0, h)
    p.lineTo(w, h)
    p.lineTo(w, 8)
    n = 16
    for i in range(n):
        x1 = w - (i + 0.5) * w / n
        x2 = w - (i + 1) * w / n
        p.lineTo(x1, 0)
        p.lineTo(x2, 8)
    p.close()
    c.drawPath(p, stroke=1, fill=1)
    rader = [
        ("Mono-Bold", 9, "c", "BAR KAJEN"),
        ("Mono", 7.4, "c", "Hamngatan 4, Norrtälje"),
        ("Mono", 7.4, "c", "Org.nr 559012-0000"),
        ("Mono", 7.4, "l", ""),
        ("Mono", 7.4, "l", "2019-10-11  23:52   Kassa 2"),
        ("Mono", 7.4, "l", "Bord 7"),
        ("Mono", 7.4, "l", "----------------------------"),
        ("Mono", 7.4, "l", "2 x Stor stark        176,00"),
        ("Mono", 7.4, "l", "1 x Pommes             60,00"),
        ("Mono", 7.4, "l", "----------------------------"),
        ("Mono-Bold", 8, "l", "TOTALT               236,00"),
        ("Mono", 7.4, "l", "Kort ************4471"),
        ("Mono", 7.4, "l", "Kontaktlös  GODKÄND"),
        ("Mono", 7.4, "l", ""),
        ("Mono", 7.4, "c", "Kopia ur kassasystem,"),
        ("Mono", 7.4, "c", "hämtad av polisen 2019-10-16"),
    ]
    y = h - 18
    for f, fs, al, t in rader:
        c.setFont(f, fs)
        c.setFillColor(BLAK)
        if al == "c":
            c.drawCentredString(w / 2, y, t)
        else:
            c.drawString(12, y, t)
        y -= fs + 4
    c.restoreState()


def rita_omslag_bild(c, w, h):
    """Omslag: natthav, fyr och ljuskägla."""
    c.saveState()
    c.setFillColor(HAV)
    c.rect(0, 0, w, h, stroke=0, fill=1)
    # ljuskägla
    c.setFillColor(GUL)
    c.setFillAlpha(0.16)
    fx, fy = w * 0.74, h * 0.585
    p = c.beginPath()
    p.moveTo(fx, fy)
    p.lineTo(-20, fy + 150)
    p.lineTo(-20, fy - 40)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillAlpha(0.08)
    p = c.beginPath()
    p.moveTo(fx, fy)
    p.lineTo(-20, fy + 250)
    p.lineTo(-20, fy - 120)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillAlpha(1)
    # klippa
    c.setFillColor(colors.HexColor("#0B161B"))
    p = c.beginPath()
    p.moveTo(w * 0.52, h * 0.36)
    p.curveTo(w * 0.6, h * 0.42, w * 0.7, h * 0.45, w * 0.78, h * 0.445)
    p.curveTo(w * 0.86, h * 0.44, w * 0.94, h * 0.41, w + 5, h * 0.39)
    p.lineTo(w + 5, h * 0.36)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    # torn
    c.setFillColor(colors.HexColor("#D9DEDF"))
    bas = h * 0.44
    p = c.beginPath()
    p.moveTo(fx - 16, bas)
    p.lineTo(fx - 10, fy - 10)
    p.lineTo(fx + 10, fy - 10)
    p.lineTo(fx + 16, bas)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillColor(STAMPEL)
    for k in range(3):
        yb = bas + 18 + k * 34
        t = (yb - bas) / (fy - 10 - bas)
        hw = 16 - 6 * t
        c.rect(fx - hw, yb, 2 * hw, 10, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0B161B"))
    c.rect(fx - 13, fy - 12, 26, 4, stroke=0, fill=1)
    c.setFillColor(GUL)
    c.rect(fx - 8, fy - 8, 16, 14, stroke=0, fill=1)
    c.setFillColor(colors.HexColor("#0B161B"))
    p = c.beginPath()
    p.moveTo(fx - 11, fy + 6)
    p.lineTo(fx, fy + 18)
    p.lineTo(fx + 11, fy + 6)
    p.close()
    c.drawPath(p, stroke=0, fill=1)
    # regnstreck
    c.setStrokeColor(colors.HexColor("#6F8790"))
    c.setStrokeAlpha(0.35)
    c.setLineWidth(0.6)
    for i in range(170):
        x = (i * 73) % int(w)
        y = (i * 151) % int(h)
        c.line(x, y, x - 4, y - 14)
    c.restoreState()


# --------------------------------------------------------------------------
# Innehåll
# --------------------------------------------------------------------------

def sida_omslag(rubrik_ovan, rubrik, under, rad3=None):
    """Helsidesomslag (använder sidmallen 'omslag')."""
    def f(c, w, h):
        rita_omslag_bild(c, w, h)
        c.setFillColor(colors.HexColor("#E6ECEC"))
        c.setFont("Plex-Semi", 9)
        c.drawString(MARG, h - MARG - 4, "SKUGGARKIVET")
        c.setFillColor(colors.HexColor("#9FB1B6"))
        c.setFont("Plex", 9)
        c.drawRightString(w - MARG, h - MARG - 4, f"ÄRENDE {ARENDE}")
        c.setStrokeColor(colors.HexColor("#3A4F58"))
        c.line(MARG, h - MARG - 12, w - MARG, h - MARG - 12)
        c.setFillColor(GUL)
        c.setFont("Elite", 13)
        c.drawString(MARG, h * 0.30, rubrik_ovan)
        c.setFillColor(colors.HexColor("#F2F4F3"))
        storlek = 44 if len(rubrik) < 18 else 36
        y = h * 0.30 - 50
        for rad in rubrik.split("\n"):
            c.setFont("Elite", storlek)
            c.drawString(MARG, y, rad)
            y -= storlek + 4
        c.setFillColor(colors.HexColor("#B8C7CB"))
        c.setFont("Plex", 11)
        for i, rad in enumerate(under.split("\n")):
            c.drawString(MARG, y - 10 - i * 15, rad)
        if rad3:
            c.setFillColor(colors.HexColor("#8197A0"))
            c.setFont("Plex", 8)
            c.drawString(MARG, MARG, rad3)
    return Ritning(PAGE_W, PAGE_H, f)




# ==========================================================================
# Svarsblad och koder
# ==========================================================================

import random as _random

PERSONER = [
    ("A", "Maria Lindqvist"), ("B", "Lukas Lindqvist"), ("C", "Jonas Ek"),
    ("D", "Anders Holm"), ("E", "Bengt Gunnarsson"),
]
MOTIV = [
    ("1", "Livförsäkringen och arvet"),
    ("2", "Henrik vägrade sälja pensionatet"),
    ("3", "Striden om vindkraften på norra udden"),
    ("4", "Henrik hade upptäckt att pengar förts ut ur pensionatet"),
    ("5", "En gammal oförrätt: krogkonkursen 1998"),
]
_rnd = _random.Random(1047)
PKOD = dict(zip([b for b, _ in PERSONER], _rnd.sample(range(10, 100), len(PERSONER))))
MKOD = dict(zip([b for b, _ in MOTIV], _rnd.sample(range(10, 100), len(MOTIV))))
RATT = ("C", "4")
_FORE = ["STORM", "DIM", "KOBB", "TÅNG", "MÅS"]
_EFTER = ["LJUS", "STEN", "SPÅR", "KLOCKA", "FÅGEL"]
_ord = [f + e for f in _FORE for e in _EFTER]
_random.Random(19).shuffle(_ord)
KONTROLLORD = {(b, m): _ord.pop() for b, _ in PERSONER for m, _ in MOTIV}


def svarsblad():
    def alt_tabell(rubrik, alternativ, koder):
        rader = [[P(f"<b>{b}</b>", "cell"), P(a, "cell"), P(f"<font name='Mono-Bold'>{koder[b]}</font>", "cell")]
                 for b, a in alternativ]
        t = Table([[P("", "cell_head"), P(rubrik, "cell_head"), P("Kod", "cell_head")]] + rader,
                  colWidths=[10 * mm, 125 * mm, 35 * mm])
        t.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, 0), 0.9, BLAK),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINJE),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    ruta = Table([[P("Personens kod", "etikett"), P("Motivets kod", "etikett"), P("Din svarskod", "etikett")],
                  ["", "", ""]], colWidths=[50 * mm, 50 * mm, 70 * mm], rowHeights=[12, 16 * mm])
    ruta.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, BLAK), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINJE),
                              ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return [
        P("SVARSBLAD", "uppdrag_nr"),
        luft(2),
        P("Vem dödade Henrik Lindqvist, och varför?", "uppdrag_fraga"),
        P("Välj en person och ett motiv. Du får bara ett svar som är rätt om båda delarna är rätt."),
        P("Fråga 1: Vem är skyldig?", "h2"),
        alt_tabell("Person", PERSONER, PKOD),
        luft(3),
        P("Fråga 2: Varför?", "h2"),
        alt_tabell("Motiv", MOTIV, MKOD),
        luft(4),
        P("Skriv personens kod följd av motivets kod. Person 23 och motiv 45 ger svarskoden 2345. Slå upp svarskoden i <b>Svarskontroll</b>.", "brod"),
        luft(1),
        ruta,
    ]


# ==========================================================================
# Akten
# ==========================================================================

def dok_las_forst(ut):
    story = [sida_omslag("ETT FALL UR SKUGGARKIVET", "FYREN PÅ\nGRÅSKÄR",
                         "Roslagen, oktober 2019.\nEn pensionatsvärd hittas död vid fyren. Polisen kallar det en olycka.",
                         "Svårighetsgrad: extremt svår. Fiktivt fall. Alla personer, företag och händelser är påhittade."),
             NextPageTemplate("akt"), PageBreak()]
    story += [
        P("PM", "etikett"),
        P("Ärende K-2019-1047 återupptas", "h1"),
        faltrutor([
            ("Till", "Utredare, Skuggarkivet"),
            ("Från", "Kerstin Wall, samordnare kalla fall"),
            ("Datum", "2026-11-12"),
            ("Gäller", "Henrik Lindqvist, f. 1961, död 2019-10-12 på Gråskär"),
        ]),
        luft(5),
        P("Natten mellan den 11 och 12 oktober 2019 dog pensionatsvärden Henrik Lindqvist, 58 år, på ön Gråskär i Roslagens skärgård. Han hittades på lördagsmorgonen vid foten av fyrens yttre spiraltrappa. Polisen bedömde att han fallit i trappan i mörkret, och förundersökningen lades ned tre veckor senare."),
        P("I september skickade Henriks änka, Maria Lindqvist, oss en kopia av akten. Hon har aldrig trott på olycksteorin. Vi har sedan dess låtit analysera beslagen från 2019 och tagit fram delar av pensionatets bokföring. Allt finns här."),
        P("Under hösten har jag också pratat med alla inblandade igen. De nya samtalen ligger i samma bevis som förhören från 2019. Fem personer hade skäl att vilja Henrik illa. En av dem dödade honom. Jag har inte skrivit några slutsatser i akten, och det har inte polisen heller. Det är ditt jobb. Läs allt, jämför allt och lita inte på någon uppgift bara för att den står i ett förhörsprotokoll."),
        P("<font name='Hand' size='18' color='#22408A'>Kerstin</font>"),
        luft(3),
        P("Så spelar du", "h2"),
        P("1.&nbsp;&nbsp;Läs akten, bevis <b>B01–B21</b>. Det finns ingen bestämd ordning."),
        P("2.&nbsp;&nbsp;Välj en person och ett motiv på svarsbladet och räkna fram din svarskod."),
        P("3.&nbsp;&nbsp;Slå upp svarskoden i <b>Svarskontroll</b> och skriv ner kontrollordet. Titta sedan <b>bara på omslaget</b> till <b>Lösningen</b>. Står ditt kontrollord där är du klar. Annars stänger du filen och fortsätter utreda."),
        P("4.&nbsp;&nbsp;<b>Ledtrådar</b> finns i en egen fil. Använd dem bara om du har kört fast helt."),
        luft(3),
        P("Innehåll i akten", "h2"),
        tabell(["Bevis", "Dokument", "Bevis", "Dokument"], [
            ["B01", "Polisrapport och beslag 2019", "B12", "Förhör: Aisha Haddad"],
            ["B02", "Situationsskiss och fotoprotokoll", "B13", "Förhör: Bengt och Inger Gunnarsson"],
            ["B03", "Obduktionsprotokoll", "B14", "Henriks anteckningsbok"],
            ["B04", "Väderobservationer", "B15", "Henriks telefon"],
            ["B05", "Karta över Gråskär", "B16", "Färjelogg, sjötaxi, kortköp"],
            ["B06", "Personalregister, internlista, bokningar", "B17", "Tidningsklipp"],
            ["B07", "Förhör: Maria Lindqvist", "B18", "Brev om livförsäkring"],
            ["B08", "Förhör: Lukas Lindqvist", "B19", "Analys av beslagen, 2026"],
            ["B09", "Förhör: Jonas Ek", "B20", "Leverantörsreskontra, kök"],
            ["B10", "Förhör: Sofia Berg", "B21", "Lönefil och bankuppgifter"],
            ["B11", "Förhör: Anders Holm", "", ""],
        ], [14 * mm, 71 * mm, 14 * mm, 71 * mm], zebra=False),
        PageBreak(),
    ]
    story += svarsblad()
    return bygg(ut / "00_Las_forst.pdf", None, "Läs först", story, omslag=True)


def dok_b01(ut):
    story = [
        P("POLISEN · REGION STOCKHOLM · LOKALPOLISOMRÅDE NORRTÄLJE", "etikett"),
        P("Anmälan och promemoria – dödsfall", "h1"),
        faltrutor([
            ("Diarienummer", "5000-K1047-19"),
            ("Händelse", "Dödsfall, oklar orsak"),
            ("Plats", "Gråskärs fyr, Gråskär, Norrtälje kommun"),
            ("Anmäld", "2019-10-12 kl. 06.58 (112)"),
            ("Anmälare", "Anders Holm, f. 1956, Lotsstugan, Gråskär"),
            ("Avliden", "Henrik Lindqvist, f. 1961-03-04"),
            ("Upprättad av", "Insp. Elsa Lund, patrull 2140 (båt)"),
            ("Förundersökningsledare", "Kriminalkommissarie Per Ahlgren"),
        ]),
        luft(4),
        P("Händelseförlopp", "h2"),
        P("Patrull 2140 anlände med polisbåt till Gråskär kl. 08.05. Anmälaren mötte vid ångbåtsbryggan och visade vägen till fyren via fyrstigen.", "mono"),
        P("Den avlidne låg på rygg på berghällen vid foten av fyrens yttre spiraltrappa, med huvudet mot trappans nedersta steg. Trappan är av gjutjärn och vitmålad. Den avlidne var klädd i blå ylletröja, jeans och seglarskor. Kläderna var genomblöta. Hällen var blöt efter nattens regn. Över överkroppen låg en grön fleecejacka som anmälaren uppger att han lagt dit. Ingen regnjacka, mössa eller ficklampa på platsen.", "mono"),
        P("Skada i bakhuvudet. Ringa mängd blod på hällen under huvudet. Inga blodspår i trappan eller på räcket.", "mono"),
        P("Fyrens dörr var låst. Nyckel i den avlidnes högra byxficka. Fyrens utebelysning var tänd när patrullen kom fram.", "mono"),
        P("Den avlidnes mobiltelefon hittades senare på skrivbordet i pensionatets kontor.", "mono"),
        P("Bedömning", "h2"),
        P("Den avlidne har sannolikt fallit i trappan i mörker och halka och slagit bakhuvudet mot nedersta steget. Inga tecken på yttre våld från annan person. Rättsmedicinsk undersökning begärd.", "mono"),
        P("Beslag (insp. Lund)", "h2"),
        P("Undertecknad gick under förmiddagen igenom pensionatets byggnader. Följande togs i beslag:", "mono"),
        tabell(["Nr", "Föremål", "Fyndplats", "Anm."], [
            ["1", "Regnrock, gul, storlek M", "Krok i hallen, huvudbyggnaden", "Fuktig"],
            ["2", "Gummistövlar, gröna, storlek 46", "Personalentrén, personalhuset", "Röda fläckar"],
            ["3", "Åra, tjärad furu", "Båthuset", "Skadad bladkant"],
            ["4", "Skottkärra", "Båthuset", ""],
            ["5", "Askrester", "Kaminen i båthuset", ""],
            ["6", "Fleecejacka, grön", "Över den avlidne", "Anmälarens"],
        ], [9 * mm, 58 * mm, 57 * mm, 46 * mm], mono=True),
        luft(4),
        P("Beslut 2019-11-04", "h2"),
        P("Förundersökningen läggs ned. Brott kan inte styrkas. Rättsmedicinska fynd bedöms förenliga med fall. Beslagen förvaras tills vidare. /P. Ahlgren", "mono"),
    ]
    return bygg(ut / "B01_Polisrapport.pdf", "B01", "Polisrapport", story, papper=FORMULAR,
                stampel=("NEDLAGD", "2019-11-04", PAGE_W - 70 * mm, PAGE_H - 95 * mm, 9, 2))


def dok_b02(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("BILAGA TILL ANMÄLAN 5000-K1047-19", "etikett"),
        P("Situationsskiss och fotoprotokoll", "h1"),
        P("Skissen är upprättad på platsen 2019-10-12 kl. 09.00–09.45, innan kroppen flyttades.", "brod_liten"),
        luft(3),
        Ritning(bredd, 115 * mm, rita_situationsskiss),
        luft(5),
        P("Fotoprotokoll (fotograf: insp. Lund)", "h2"),
        tabell(["Bild", "Tid", "Motiv"], [
            ["F0", "08.15", "Grinden vid huvudbyggnaden, på väg mot fyren. Rosenbåge. Måttstock mot bågens underkant: 178 cm."],
            ["F1", "08.22", "Översikt från fyrstigen mot fyren. Utebelysningen tänd."],
            ["F2", "08.25", "Den avlidne i ryggläge, fleecejacka över överkroppen."],
            ["F3", "08.27", "Som F2, jackan borttagen."],
            ["F4", "08.31", "Närbild bakhuvud. Skada med rak kant, ca 7 cm."],
            ["F5", "08.34", "Seglarskornas klackar, båda fötterna."],
            ["F6", "08.40", "Trappan, steg 1–6. Vit färg, inga skador, inget blod."],
            ["F7", "09.41", "Hällen efter flytt. Ljusare yta i kroppens form."],
            ["F8", "10.05", "Hallen i huvudbyggnaden. Regnrock på krok, tom krok bredvid."],
            ["F9", "10.40", "Båthuset, interiör. Båten Tärnan på bockar med lapp: ”RÖR EJ”. Årorna lutade mot relingen."],
        ], [14 * mm, 16 * mm, bredd - 30 * mm], mono=True, zebra=True),
    ]
    return bygg(ut / "B02_Situationsskiss.pdf", "B02", "Situationsskiss och fotoprotokoll", story, papper=FORMULAR)


def dok_b03(ut):
    story = [
        P("RÄTTSMEDICINSKA AVDELNINGEN", "etikett"),
        P("Obduktionsprotokoll (utdrag)", "h1"),
        faltrutor([
            ("Den döde", "Henrik Lindqvist, f. 1961-03-04"),
            ("Obduktion", "2019-10-14"),
            ("Obducent", "Leg. läkare R. Sandell"),
            ("Remiss", "Polisen, 5000-K1047-19"),
            ("Längd / vikt", "169 cm / 74 kg"),
            ("Kläder vid ankomst", "Blöta: ylletröja, jeans, seglarskor"),
        ]),
        luft(4),
        P("Yttre undersökning", "h2"),
        P("1. Krosskada i bakhuvudet, vänster sida. Linjär, 7 cm lång, med rak och skarp kant och underliggande impressionsfraktur.", "mono"),
        P("2. Inga skador på handflator, armbågar, knän, höfter eller rygg.", "mono"),
        P("3. Ytliga skrapsår på båda hälarna. Seglarskornas klackar nötta i riktning bakåt.", "mono"),
        P("4. Likfläckar på ryggsidan, fixerade.", "mono"),
        P("Fynd i såret", "h2"),
        P("I sårkanterna fanns träflisor av barrträ, impregnerade med trätjära, samt enstaka röda färgpartiklar med hög kopparhalt. Proverna sparas (prov 19-4412).", "mono"),
        P("Övrigt", "h2"),
        P("Alkohol i blod: 0,3 promille. Inga tecken på sjukdom som kan ha orsakat fall.", "mono"),
        P("Dödstidpunkt: uppskattningsvis mellan kl. 22.00 den 11 oktober och kl. 01.00 den 12 oktober.", "mono"),
        P("Dödsorsak: Krosskada mot skallen med hjärnskada.", "mono"),
        P("Bedömning", "h2"),
        P("Skadan är förenlig med att den döde slagit bakhuvudet mot ett kantigt föremål.", "mono"),
        P("R. Sandell", "mono"),
    ]
    return bygg(ut / "B03_Obduktionsprotokoll.pdf", "B03", "Obduktionsprotokoll", story, papper=LAB)


def dok_b04(ut):
    tim = [["18.00", "9,8", "4", "SV", "0,0"], ["19.00", "9,4", "4", "SV", "0,0"], ["20.00", "9,1", "5", "SV", "0,0"],
           ["21.00", "8,9", "6", "S", "0,0"], ["22.00", "8,7", "7", "S", "0,0"]]
    tio = [("22.10", "0,0"), ("22.20", "0,0"), ("22.30", "0,0"), ("22.40", "0,0"), ("22.50", "0,0"), ("23.00", "0,0"),
           ("23.10", "0,0"), ("23.20", "0,0"), ("23.30", "0,4"), ("23.40", "0,7"), ("23.50", "0,5"), ("24.00", "0,5"),
           ("00.10", "0,8"), ("00.20", "0,9"), ("00.30", "0,8"), ("00.40", "0,7"), ("00.50", "0,8"), ("01.00", "0,8")]
    sen = [["02.00", "7,7", "12", "SO", "5,2"], ["03.00", "7,6", "10", "O", "3,9"], ["04.00", "7,4", "8", "O", "1,1"],
           ["05.00", "7,2", "6", "O", "0,0"], ["06.00", "7,0", "5", "O", "0,0"], ["07.00", "7,3", "5", "O", "0,0"]]
    bredd = PAGE_W - 2 * MARG
    t1 = tabell(["Tim. slut", "Temp °C", "Vind m/s", "Riktn.", "Nederb. mm"], tim + [["—", "", "", "", ""]] + sen,
                [18 * mm, 16 * mm, 16 * mm, 14 * mm, 18 * mm], mono=True)
    t2 = tabell(["10 min, slut", "Nederb. mm"], [list(r) for r in tio], [24 * mm, 20 * mm], mono=True)
    story = [
        P("GRÅSKÄRS FYRFÖRENING · AUTOMATISK VÄDERSTATION VID FYREN", "etikett"),
        P("Väderobservationer 11–12 oktober 2019", "h1"),
        P("Utdrag ur stationens logg. Nederbörden anges som summan för perioden som slutar vid angiven tid. Mellan 22.00 och 01.00 loggar regnmätaren var tionde minut.", "brod_liten"),
        luft(3),
        Table([[t1, t2]], colWidths=[90 * mm, bredd - 90 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP")]),
        luft(4),
        P("Solnedgång 11 okt kl. 18.12. Soluppgång 12 okt kl. 07.41. Heltäckande moln hela natten.", "brod_liten"),
    ]
    return bygg(ut / "B04_Vaderobservationer.pdf", "B04", "Väderobservationer", story)


def dok_b05(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("GRÅSKÄR · NORRTÄLJE KOMMUN", "etikett"),
        P("Karta över Gråskär", "h1"),
        P("Ritad av Skuggarkivet efter fastighetskarta och byggnadsritningar. Fönstrens placering är kontrollerad på plats 2026. Det finns inga bilar på ön.", "brod_liten"),
        luft(2),
        Ritning(bredd, bredd * 540 / 600, rita_karta),
        luft(3),
        P("Heldragen stig: Fyrstigen (grusad, från grinden). Streckad: Strandstigen (stenig, längs östra stranden). Prickad: gångar mellan husen.", "brod_liten"),
    ]
    return bygg(ut / "B05_Karta.pdf", "B05", "Karta över Gråskär", story)


def dok_b06(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("GRÅSKÄRS PENSIONAT HB · UR PÄRMEN ”PERSONAL”", "etikett"),
        P("Personalregister 2019", "h1"),
        tabell(["Anst.nr", "Namn", "Befattning", "Anställd", "Arbetskläder", "Anhörig"], [
            ["0007", "Jonas Ek", "Kökschef", "2013-04-01", "Kockrock XL, skyddsskor 46", "L. Sjöberg, Rimbo"],
            ["0012", "Aisha Haddad", "Servering, städ", "2019-04-15", "Kockrock S, skyddsskor 37", "Samir Haddad (bror)"],
            ["0013", "Elin Svärd", "Kök, säsong", "2019-06-03 – 08-25", "Kockrock M, skyddsskor 39", "–"],
            ["0014", "Oskar Nyberg", "Servering, säsong", "2019-06-10 – 08-18", "Förkläde, skor 44", "–"],
        ], [15 * mm, 26 * mm, 26 * mm, 30 * mm, 42 * mm, bredd - 139 * mm]),
        luft(1),
        P("Henrik och Maria Lindqvist är delägare i handelsbolaget och står inte på lönelistan.", "brod_liten"),
        luft(4),
        P("Internlista, uppsatt i receptionen", "h2"),
        tabell(["Ankn.", "Plats"], [
            ["101", "Reception och kontor"], ["102", "Köket"], ["103", "Salongen"],
            ["104", "Personalhuset, rum 1"], ["105", "Personalhuset, rum 2"],
            ["111", "Gästrum 1"], ["112", "Gästrum 2"], ["113", "Gästrum 3"], ["114", "Gästrum 4"],
            ["120", "Båthuset"],
        ], [20 * mm, 80 * mm], mono=True),
        luft(4),
        P("Bokningar 10–13 oktober 2019", "h2"),
        tabell(["Rum", "Namn i bokningen", "Ankomst", "Avresa", "Anm."], [
            ["1", "B. och I. Gunnarsson", "fre 11/10", "lör 12/10", "Mot havet. Hämtas vid 12-båten."],
            ["2", "–", "", "", ""],
            ["3", "–", "", "", "Stängt, målning"],
            ["4", "S. Lind", "tors 10/10", "sön 13/10", ""],
        ], [12 * mm, 40 * mm, 22 * mm, 22 * mm, bredd - 96 * mm], mono=True),
    ]
    return bygg(ut / "B06_Personalregister.pdf", "B06", "Personalregister och bokningar", story)


def samtal_huvud(namn, roll, datum, plats, langd):
    return [CondPageBreak(90 * mm), luft(6)] + forhorshuvud(
        namn, roll, datum, plats, "Kerstin Wall, Skuggarkivet",
        typ="Samtal med Skuggarkivet 2026 (frivilligt, ljudupptaget)", langd=langd)


def dok_b07(ut):
    story = forhorshuvud("Maria Lindqvist", "Hustru till den avlidne, delägare", "2019-10-13 kl. 14.10",
                         "Polisstationen, Norrtälje", "Insp. Elsa Lund", langd="165 cm")
    story += forhor([
        ("F", "Var befann du dig på fredagen?"),
        ("S", "Jag åkte in till Norrtälje med färjan tio över tre. Jag skulle sova hos min syster Ulla och gå på hennes sextioårsfest på lördagen. Henrik skulle komma efter."),
        ("F", "Kan någon bekräfta var du var under kvällen och natten?"),
        ("S", "Ulla och hennes man. Vi satt uppe och dukade till festen till efter midnatt. Jag sov i deras gästrum."),
        ("F", "När hade du kontakt med Henrik senast?"),
        ("S", "Vi pratade i telefon vid fyra. Sedan skickade han ett sms på kvällen. Jag ringde honom strax före midnatt, men han svarade inte. Jag tänkte att han hade somnat i soffan på kontoret, det gjorde han ibland."),
        ("F", "Hur lät han i telefon vid fyra?"),
        ("S", "Stressad. Men det har han varit hela hösten. Taket, lånet, vindkraften, Lukas."),
        ("F", "Vem sköter ekonomin i pensionatet?"),
        ("S", "Vi hade en redovisningskonsult, men han gick i pension i juni. Sedan dess har Henrik gjort det själv. Han satt med pärmarna varje kväll den sista veckan."),
        ("F", "Hur fungerar inköpen?"),
        ("S", "Köket beställer och godkänner sina egna inköp, så har det alltid varit. Henrik betalade det som var godkänt. Han brydde sig mer om tak och bryggor än om fisk."),
        ("F", "Hade Henrik några rutiner på kvällarna?"),
        ("S", "Han gick till fyren vid midnatt och släckte utebelysningen. Det har vi lovat fyrföreningen. Strömbrytaren sitter innanför fyrens dörr, och nyckeln hade han alltid i fickan. Han lät ingen annan gå dit. Om det regnade tog han den gula regnrocken. Och ficklampan, den stora gula. Han var faktiskt mörkrädd."),
        ("F", "Hade Henrik någon konflikt med någon?"),
        ("S", "Med Anders, om vindkraften. Och med Lukas, som vill att vi säljer. Han har skulder. Och sedan har vi ju Gunnarssons."),
        ("F", "Gästerna i rum 1?"),
        ("S", "Henrik och Bengt drev en krog i Uppsala på nittiotalet. Det slutade med konkurs, och Bengt förlorade sitt hus. De pratade inte med varandra på tjugo år. I somras skrev Henrik till honom och bjöd hit dem. Jag tyckte att det var en dålig idé."),
        ("F", "Vi har sett att Henriks livförsäkring höjdes i våras."),
        ("S", "Banken krävde det när vi lånade till det nya taket. Det förstår jag att ni måste fråga om."),
        ("F", "Något annat?"),
        ("S", "Henrik bottenmålade Tärnan i torsdags. Han ville inte ha hjälp."),
        ("A", "Förhöret avslutat kl. 14.52. Upplästes och godkändes."),
    ])
    story += samtal_huvud("Maria Lindqvist", "Änka", "2026-09-30 kl. 10.00", "Hennes lägenhet, Norrtälje", "165 cm")
    story += forhor([
        ("F", "Varför skickade du akten till oss nu, sju år senare?"),
        ("S", "Jag fick tillbaka Henriks telefon av polisen 2019 och lade den i en låda utan att orka titta på den. När jag flyttade i somras hittade jag den och läste sms:en igen. Han skrev att han skulle ta det i kväll. Ta vad? Det har jag aldrig fått veta."),
        ("F", "Vad hände med pensionatet?"),
        ("S", "Jag sålde till Nordhamn Hotell 2021, samma kedja som Lukas ville sälja till. Jag orkade inte. Ni kan skriva att änkan sålde till den som sonen ville. Det har folk på ön redan sagt."),
        ("F", "Och livförsäkringen?"),
        ("S", "Den betalades ut 2020, när polisen hade lagt ned. Hälften gick till banklånet."),
        ("F", "Du sa 2019 att Henrik lät stressad vid fyra. Minns du vad han sa?"),
        ("S", "Han sa att han hade hittat något konstigt i fakturorna och att han inte ville prata om det i telefon. Jag tänkte inte mer på det då. Fakturor var alltid konstiga för Henrik."),
        ("F", "Berätta om personalen 2019."),
        ("S", "Jonas hade varit hos oss sedan 2013. Henrik litade fullständigt på honom. Han hade det tufft, skilde sig 2018 och fick lösa ut sin fru ur huset i Rimbo. Aisha kom i april, hon var duktig. På sommaren hade vi två säsongsanställda."),
        ("F", "Säger namnet Kobbskär dig något?"),
        ("S", "Kobbskär? Det är en holme norr om Väddö. Jonas morfar hade ett torp där. Jonas pratade alltid om att han skulle ta över det och röka fisk när han blev gammal. Varför frågar ni?"),
        ("F", "Vi återkommer om det. Berätta om regnrocken."),
        ("S", "Jag köpte den på rea, i storlek M fast han borde ha haft S. Den räckte honom ända ner på smalbenen. Han vägrade byta, han sa att den var lagom stor för att ha tröja under."),
        ("F", "Eldade Henrik i båthuset?"),
        ("S", "Aldrig efter augusti. Han var rädd för brand när det stod färgburkar och nymålade båtar där."),
        ("F", "Vad hände med Gunnarssons efteråt?"),
        ("S", "Bengt skrev ett fint kort. Henrik hade lovat honom pengar, förresten. I brevet i somras skrev han att han skulle betala tillbaka Bengts del av krogskulden när arrendet från vindkraften började komma in. Det blev ju inget av det."),
        ("A", "Samtalet avslutat kl. 11.15."),
    ])
    return bygg(ut / "B07_Forhor_Maria_Lindqvist.pdf", "B07", "Förhör Maria Lindqvist", story)


def dok_b08(ut):
    story = forhorshuvud("Lukas Lindqvist", "Son till den avlidne", "2019-10-14 kl. 10.30",
                         "Per telefon", "Insp. Elsa Lund", typ="Telefonförhör med upplysningsperson", langd="184 cm")
    story += forhor([
        ("F", "Var var du på fredagskvällen den 11 oktober?"),
        ("S", "I Norrtälje. På Bar Kajen med två kompisar från ungefär halv tio. Sedan tog jag taxi hem."),
        ("F", "När var du senast på Gråskär?"),
        ("S", "I onsdags. Jag åkte ut med middagsbåten och hem med eftermiddagsbåten."),
        ("F", "Varför åkte du ut?"),
        ("S", "För att prata om försäljningen. Det gick inte bra."),
        ("F", "Kl. 21.12 skrev du till din pappa: ”Du kommer att ångra det här, pappa.” Vad menade du?"),
        ("S", "Det fanns en köpare till pensionatet, en hotellkedja. Pappa sa nej utan att träffa dem. Jag har lån som jag inte klarar, och han visste om det. Jag menade att han skulle ångra att han inte lyssnade."),
        ("F", "Hur stora är dina skulder?"),
        ("S", "Runt sexhundratusen. Det är inte hela världen. Det är inget man dödar för, om det är det du undrar."),
        ("F", "Har du egen båt?"),
        ("S", "Nej."),
        ("F", "Vet du om din pappa var orolig för något?"),
        ("S", "Pengar. Han sa i onsdags att det fattades pengar och att han inte fattade vart de tog vägen. Jag trodde att han ville få mig att sluta tjata om försäljningen."),
        ("A", "Förhöret avslutat kl. 10.48."),
    ])
    story += samtal_huvud("Lukas Lindqvist", "Son till den avlidne", "2026-10-08 kl. 15.30", "Kafé vid hamnen, Norrtälje", "184 cm")
    story += forhor([
        ("F", "Vad sa du inte till polisen 2019?"),
        ("S", "Att Nordhamn hade lovat mig ett förmedlingsarvode, tvåhundrafemtio tusen, om affären blev av. Det blev den, 2021, när mamma sålde. Så ja, jag tjänade på att pappa dog. Det har jag fått leva med."),
        ("F", "Berätta om onsdagen på Gråskär."),
        ("S", "Vi bråkade i köket. Han frågade rakt ut om jag hade tagit pengar ur kassan. Han sa att det fattades nästan en halv miljon sedan nyår. Jag blev så arg att jag gick ner till bryggan och satt där i två timmar och väntade på båten."),
        ("F", "Var det någon som hörde bråket?"),
        ("S", "Jonas kom in mitt i. Han vände i dörren."),
        ("F", "Hade du något med pensionatets ekonomi att göra?"),
        ("S", "Jag skötte betalningarna i internetbanken från januari till april 2019, när pappa hade ryggskott. Jag betalade det som låg i attestpärmen. Det var därför han frågade mig först. Jag förstår honom."),
        ("F", "Kommer du ihåg några särskilda leverantörer?"),
        ("S", "Nej. Grossisten, bageriet, fisk. Det var en hög varje fredag."),
        ("F", "Vilka var du med på fredagen?"),
        ("S", "Ali Rahimi och Max Lindgren. Vi satt på Bar Kajen till efter halv ett. Sedan tog jag taxi hem. Ni kan prata med dem."),
        ("F", "Hade du kontakt med någon från pensionatet efter begravningen?"),
        ("S", "Jonas ringde mig. Jag tror att det var dagen efter begravningen. Han frågade om mamma hade tagit hand om pappas pärmar från kontoret. Han sa att han behövde recepten och leverantörslistorna. Jag sa att polisen hade gått igenom kontoret och att resten stod kvar där."),
        ("F", "Vad tänker du om Anders Holm?"),
        ("S", "Han är en arg gammal man. Men han älskade pappa, på sitt sätt."),
        ("A", "Samtalet avslutat kl. 16.05."),
    ])
    return bygg(ut / "B08_Forhor_Lukas_Lindqvist.pdf", "B08", "Förhör Lukas Lindqvist", story)


def dok_b09(ut):
    story = forhorshuvud("Jonas Ek", "Kökschef, Gråskärs pensionat", "2019-10-12 kl. 11.20",
                         "Salongen, Gråskärs pensionat", "Insp. Elsa Lund", langd="191 cm")
    story += forhor([
        ("F", "Berätta om fredagskvällen."),
        ("S", "Vi hade tre gäster på middag. Gunnarssons och journalisten. Jag stängde köket vid halv elva, städade klart och gick till personalhuset. Sedan låg jag och läste."),
        ("F", "Hade du kontakt med Henrik under kvällen?"),
        ("S", "Inte efter middagen. Han satt på kontoret med sina pärmar. Ingen ringde mig heller, om det är det du menar."),
        ("F", "Var du i huvudbyggnaden efter halv elva?"),
        ("S", "Nej."),
        ("F", "Gick du ut igen under kvällen?"),
        ("S", "Nej. Men jag satt vid fönstret och rökte vid tjugo i tolv, ungefär. Det hade börjat ösregna. Då såg jag Henrik gå mot fyren i den gula regnrocken. Han gick dit varje kväll."),
        ("F", "Är du säker på att det var Henrik?"),
        ("S", "Vem annars? Det är hans rock. Den syns på långt håll."),
        ("F", "När somnade du?"),
        ("S", "Strax efter tolv."),
        ("F", "När var du senast i båthuset?"),
        ("S", "Det var flera veckor sedan. Båthuset är Henriks ställe."),
        ("F", "Hur var ditt förhållande till Henrik?"),
        ("S", "Bra. Han var en bra chef. Han lade sig aldrig i köket."),
        ("A", "Förhöret avslutat kl. 11.41."),
    ])
    story += samtal_huvud("Jonas Ek", "Tidigare kökschef. Driver i dag restaurangen Ek & Salt, Norrtälje",
                          "2026-10-20 kl. 14.30", "Ek & Salt, Norrtälje", "191 cm")
    story += forhor([
        ("F", "Hur länge arbetade du kvar på Gråskär?"),
        ("S", "Till mars 2020. Det var inte samma sak utan Henrik. Jag öppnade Ek & Salt året därpå, med sparpengar och ett lån."),
        ("F", "Berätta igen om det du såg den natten."),
        ("S", "Jag satt vid fönstret i mitt rum och rökte. Henrik kom gående i den gula rocken med ficklampan tänd, som han alltid gjorde, och gick upp mot fyren. Det är sista gången jag såg honom."),
        ("F", "Märkte du något särskilt hos Henrik den sista veckan?"),
        ("S", "Han satt med pärmarna. Han hatade bokföring. Annars inget."),
        ("F", "Frågade han dig någon gång om köksfakturorna?"),
        ("S", "Nej. Han lade sig aldrig i köket. Det var därför det fungerade så bra."),
        ("F", "Vem tog emot leveranserna till köket?"),
        ("S", "Jag, eller den som var i köket. Fisken kom med Grisslehamnsbåten på torsdagarna."),
        ("F", "Säger Kobbskär Fisk & Vilt AB dig något?"),
        ("S", "Nej. Aldrig hört talas om dem."),
        ("F", "Säger Kobbskär dig något?"),
        ("S", "Det finns hundra kobbar och skär i Roslagen."),
        ("F", "Vems var de gröna gummistövlarna i personalentrén?"),
        ("S", "Inte mina. Jag hade svarta. De gröna kan ha varit Oskars, säsongskillens."),
        ("F", "Hörde du bråket mellan Henrik och Lukas på onsdagen?"),
        ("S", "Jag gick in i köket mitt i. Henrik skrek om pengar som fattades. Jag tänkte att Lukas hade tagit dem. Det tror jag fortfarande."),
        ("F", "Hade du kontakt med familjen efter begravningen?"),
        ("S", "Jag beklagade sorgen. Annars inte. Jag har aldrig rört Henriks pärmar, om det är det ni menar."),
        ("A", "Samtalet avslutat kl. 15.10. Jonas Ek bad att få veta vad Skuggarkivet hade hittat. Det fick han inte."),
    ])
    return bygg(ut / "B09_Forhor_Jonas_Ek.pdf", "B09", "Förhör Jonas Ek", story)


def dok_b10(ut):
    story = forhorshuvud("Sofia Berg", "Gäst, rum 4. Vittne", "2019-10-12 kl. 12.05",
                         "Salongen, Gråskärs pensionat", "Insp. Elsa Lund", langd="170 cm")
    story += forhor([
        ("F", "Du står som S. Lind i bokningen."),
        ("S", "Lind är min sambos efternamn. Jag är frilansjournalist och skriver om vindkraftsplanerna. Jag ville höra hur folk pratar när de inte vet vem jag är."),
        ("F", "Visste Henrik vem du var?"),
        ("S", "Ja, sedan i går. Han kom fram till mig efter middagen och sa att han visste att jag var journalist. Han var inte arg, mest trött. Han sa att vi kunde prata om vindkraften på lördag."),
        ("F", "Berätta om resten av kvällen."),
        ("S", "Jag satt i salongen och läste. Henrik satt på kontoret bredvid med dörren på glänt. Någon gång vid kvart i elva pratade han kort i telefon. Ungefär tio i elva kom han ut med en tjock pärm under armen och den stora ficklampan i handen. Han sa: ”Jag ska bara ut en sväng. Det finns kaffe i termosen.” Strax efter kvart över elva gick jag till mitt rum."),
        ("F", "Såg du något mer under kvällen?"),
        ("S", "Vid tjugo i tolv stod jag vid fönstret och tittade på regnet. Lyktan vid grinden var tänd. En person i en gul regnrock med luvan uppe kom gående längs huvudbyggnadens framsida och gick ut genom grinden mot fyren. Jag tänkte att det var Henrik."),
        ("F", "Såg du ansiktet?"),
        ("S", "Nej. Personen gick fort med händerna i fickorna. När han gick under rosenbågen skakade rosorna och det stänkte vatten. Jag minns det för att lyktan lyste i dropparna."),
        ("F", "Hade personen ficklampa?"),
        ("S", "Nej. Det var konstigt, för det var becksvart bortom lyktan."),
        ("F", "Såg du personen komma tillbaka?"),
        ("S", "Nej, jag gick och lade mig."),
        ("A", "Förhöret avslutat kl. 12.30."),
    ])
    story += samtal_huvud("Sofia Berg", "Journalist. Vittne", "2026-10-03 kl. 09.00", "Per telefon", "170 cm")
    story += forhor([
        ("F", "Du sa 2019 att Henrik pratade i telefon vid kvart i elva. Hörde du vad han sa?"),
        ("S", "Bara slutet. Han sa: ”Du vet precis vad jag menar. Klockan elva. Ta inte med någon.” Sedan lade han på. Jag tänkte att det handlade om vindkraften och att jag inte skulle höra det. Därför sa jag inget till polisen. Jag har ångrat det."),
        ("F", "Vad sa Henrik till dig efter middagen?"),
        ("S", "Att han visste vem jag var och att han inte brydde sig. Han sa: ”Jag har viktigare saker än vindkraften att tänka på i kväll.”"),
        ("F", "Tänk tillbaka på personen i regnrocken. Finns det något mer?"),
        ("S", "Rocken såg kort ut. Den slutade ovanför knäna. Jag har tänkt på det i efterhand, för på Henrik brukade den nästan släpa i marken. Jag skämtade om det på torsdagen."),
        ("F", "Varifrån kom personen?"),
        ("S", "Längs framsidan, från det östra hållet. Inte ut genom ytterdörren, för då hade ljuset från hallen fallit ut på gruset, och det gjorde det inte. Det är jag ganska säker på."),
        ("F", "Hur var vädret just då?"),
        ("S", "Det öste ner, men det var nästan vindstilla en stund. Regnet föll rakt. Därför la jag märke till rosorna."),
        ("A", "Samtalet avslutat kl. 09.25."),
    ])
    return bygg(ut / "B10_Forhor_Sofia_Berg.pdf", "B10", "Förhör Sofia Berg", story)


def dok_b11(ut):
    story = forhorshuvud("Anders Holm", "Anmälare. Hamnfogde, ordförande i Gråskärs fyrförening", "2019-10-12 kl. 09.55",
                         "Lotsstugan, Gråskär", "Insp. Elsa Lund", langd="172 cm")
    story += forhor([
        ("F", "Berätta hur du hittade Henrik."),
        ("S", "Jag går ut med hunden varje morgon vid kvart i sju. I dag såg jag att utebelysningen vid fyren fortfarande var tänd. Det har aldrig hänt förut. Så jag gick upp dit, och där låg han. Jag kände på halsen, han var kall. Jag lade min jacka över honom och ringde 112."),
        ("F", "Vad gjorde du under fredagskvällen?"),
        ("S", "Jag var hemma ensam. Vid fem över elva, ungefär, såg jag ljus i båthusets fönster från köket. Henrik pysslar ofta där på kvällarna. Kanske fem minuter senare hörde jag en duns, som när en åra välter. Jag gick och lade mig när regnet kom."),
        ("F", "Gick du ut under kvällen?"),
        ("S", "Nej."),
        ("F", "Såg du någon på stigarna?"),
        ("S", "Från Lotsstugan ser man inte fyrstigen. Jag drog ner rullgardinen när jag gick och lade mig."),
        ("F", "Det har stått i tidningen att du och Henrik var ovänner om vindkraften."),
        ("S", "Ja. Jag sa en dum sak till Roslagsposten. Men vi har känt varandra i trettio år. Han ringde mig i torsdags och ville prata innan mötet med bolaget. Det blev aldrig av."),
        ("F", "Vet du något om båten Tärnan?"),
        ("S", "Henrik bottenmålade henne i torsdags. Samma röda kopparfärg som alla här ute använder. Han hängde en lapp på henne."),
        ("A", "Förhöret avslutat kl. 10.20."),
    ])
    story += samtal_huvud("Anders Holm", "Hamnfogde, ordförande i Gråskärs fyrförening", "2026-10-12 kl. 13.00",
                          "Lotsstugan, Gråskär", "172 cm")
    story += forhor([
        ("F", "Är det något i ditt förhör 2019 som inte stämmer?"),
        ("S", "Ja. Jag gick ut. Jag har burit på det i sju år."),
        ("F", "Berätta."),
        ("S", "Efter dunsen satt jag och väntade på att ljuset i båthuset skulle tändas igen. Det gjorde det inte. Vid kvart över elva tog jag hunden och gick ner. Båthuset var mörkt och dörren stängd. Jag ropade på Henrik men fick inget svar."),
        ("F", "Vad hände sedan?"),
        ("S", "Hunden drog mot strandstigen och morrade. En bit bort hörde jag något som rullade och skramlade över sten, som en kärra. Jag tänkte att Henrik var på väg till fyren med något och att han inte ville prata med mig, efter det jag hade sagt i tidningen. Så jag gick hem. Det började regna när jag kom in."),
        ("F", "Varför sa du inte det till polisen?"),
        ("S", "Därför att jag hade sagt ”över min döda kropp, eller hans” i tidningen två veckor tidigare. Och så var jag ute ensam i mörkret nere vid båthuset samma kväll som han dog. Vad tror ni att de hade trott?"),
        ("F", "Vad ville Henrik när han ringde på torsdagen?"),
        ("S", "Han sa att han kanske skulle dra sig ur vindkraften. Han sa att han hade större problem just nu, att han inte visste vem han kunde lita på längre. Jag trodde att han menade mig."),
        ("F", "Rörde du något vid fyren på morgonen, förutom jackan?"),
        ("S", "Nej. Jag såg att hällen var ljus under honom när polisen lyfte honom. Jag sa det till fotografen. Hon skrev upp det."),
        ("A", "Samtalet avslutat kl. 13.50."),
    ])
    return bygg(ut / "B11_Forhor_Anders_Holm.pdf", "B11", "Förhör Anders Holm", story)


def dok_b12(ut):
    story = forhorshuvud("Aisha Haddad", "Servering och städ, Gråskärs pensionat. Vittne", "2019-10-12 kl. 12.40",
                         "Köket, Gråskärs pensionat", "Insp. Elsa Lund", langd="162 cm")
    story += forhor([
        ("F", "Hur länge har du arbetat här?"),
        ("S", "Sedan i april. Jag bor i tvåan i personalhuset."),
        ("F", "Berätta om fredagen."),
        ("S", "När jag städade rum 4 på eftermiddagen låg ett presskort på nattduksbordet. Det stod Sofia Berg på det, inte Lind. Jag sa det till Henrik. Han nickade bara och sa att han skulle ta hand om det."),
        ("F", "Och på kvällen?"),
        ("S", "Jag serverade middagen och diskade. Jag var klar kvart över tio och gick till personalhuset. Jag sov med öronproppar."),
        ("F", "Hörde du något under natten?"),
        ("S", "Jag vaknade av regnet, det smattrar på plåttaket. Halv tolv ungefär. Jag låg vaken en lång stund. Strax efter kvart över tolv slog ytterdörren igen. Jag trodde att Jonas kom in efter att ha rökt på trappan. Han röker alltid där."),
        ("F", "Vad hände på morgonen?"),
        ("S", "Jag började med frukosten kvart över sex. I hallen hängde Henriks regnrock på sin krok, alldeles dyblöt, med en pöl under. Ficklampans krok var tom. Jag torkade upp pölen."),
        ("F", "Såg du Jonas på morgonen?"),
        ("S", "Han kom till köket vid halv sju. Han var blek och hade tofflor på sig i köket, det brukar han aldrig ha."),
        ("A", "Förhöret avslutat kl. 12.58."),
    ])
    story += samtal_huvud("Aisha Haddad", "Tidigare anställd. Vittne", "2026-10-05 kl. 18.00", "Per videosamtal", "162 cm")
    story += forhor([
        ("F", "Vem tog emot leveranserna till köket hösten 2019?"),
        ("S", "Jonas. Alltid. Jag fick inte ens öppna kylrummet när det kom varor, han ville ha ordning själv. Fisken kom med Grisslehamnsbåten på torsdagar, bröd och mejeri med färjan."),
        ("F", "Såg du någon gång leveranser från Kobbskär Fisk & Vilt?"),
        ("S", "Jag har aldrig hört det namnet. Vi hade ingen vilt på menyn alls under hösten."),
        ("F", "De gröna gummistövlarna i personalentrén, vems var de?"),
        ("S", "De stod där hela hösten. Jag tror att de var Oskars, säsongskillen. Han glömde en massa grejer när han slutade i augusti."),
        ("F", "Märkte du något hos Jonas den hösten?"),
        ("S", "Han köpte en ny bil i somras, en Volvo. Han sa att han hade ärvt pengar. Och han var nervös på ett sätt han inte brukade vara när Henrik satt med pärmarna."),
        ("F", "Du sa att du vaknade av regnet vid halv tolv. Hörde du dörren innan dess?"),
        ("S", "Nej. Men jag hade öronproppar fram till dess. Efter det låg jag vaken, och då slog den bara en gång, efter kvart över tolv."),
        ("F", "Var Jonas i personalhuset när du kom hem kvart över tio?"),
        ("S", "Hans dörr var stängd och det var mörkt under den. Jag tänkte att han sov."),
        ("A", "Samtalet avslutat kl. 18.30."),
    ])
    return bygg(ut / "B12_Forhor_Aisha_Haddad.pdf", "B12", "Förhör Aisha Haddad", story)


def dok_b13(ut):
    story = forhorshuvud("Bengt och Inger Gunnarsson", "Gäster, rum 1", "2019-10-12 kl. 07.20",
                         "Ångbåtsbryggan, Gråskär (före avresa)", "Insp. Elsa Lund (per telefon, ljudupptagning)",
                         typ="Förhör med upplysningspersoner", langd="Bengt 186 cm, Inger 163 cm")
    story += forhor([
        ("A", "Förhöret hölls per telefon när makarna väntade på färjan 07.50. Polisen var inte på ön ännu."),
        ("F", "Bengt, hur känner ni Henrik Lindqvist?"),
        ("S", "(Bengt) Vi drev Krogen Ågatan i Uppsala ihop till 1998. Den gick i konkurs. Jag förlorade huset och var arg på honom i många år. I somras skrev han ett långt brev och bad om ursäkt. Det var därför vi kom hit."),
        ("F", "Hur var stämningen i går?"),
        ("S", "(Bengt) Bra. Vi skålade. Jag har förlåtit honom."),
        ("S", "(Inger) Det har inte jag."),
        ("F", "Vad gjorde ni efter middagen?"),
        ("S", "(Inger) Vi gick till rummet vid tio. Bengt tog sin sömntablett, han har ont i knät sedan operationen. Jag läste till halv ett, och han snarkade hela tiden. Vi har inte gått ut."),
        ("F", "Bengt, hur rör du dig efter operationen?"),
        ("S", "(Bengt) Med två kryckor. Det är fyra veckor sedan de bytte knäet. Kocken fick bära våra väskor från bryggan i går, och det tog mig en kvart att gå upp."),
        ("F", "Hörde ni något under natten?"),
        ("S", "(Inger) Bara regnet. Vårt fönster vetter mot havet."),
        ("A", "Förhöret avslutat kl. 07.34."),
    ])
    story += samtal_huvud("Bengt Gunnarsson", "Tidigare delägare i Krogen Ågatan, Uppsala", "2026-10-15 kl. 11.00",
                          "Hemma hos makarna, Uppsala", "186 cm")
    story += forhor([
        ("F", "Vad stod i Henriks brev sommaren 2019?"),
        ("S", "Att han hade skött ekonomin på krogen för dåligt och dolt det för mig. Att han skämdes. Och att han skulle betala tillbaka min del av skulden, tre hundra tusen, när arrendet från vindkraften började komma. Han dog innan dess."),
        ("F", "Så du förlorade pengar på att han dog?"),
        ("S", "Ja. Det har ingen frågat förut."),
        ("F", "Hur mådde ditt knä den helgen?"),
        ("S", "Uselt. Jag kunde inte gå på toaletten på natten utan Inger. Jag tog mig mellan rummet, matsalen och salongen, längre än så kom jag aldrig. Fråga kocken, han fick hjälpa mig uppför trappan vid entrén när vi kom."),
        ("A", "Samtalet avslutat kl. 11.30."),
    ])
    story += samtal_huvud("Inger Gunnarsson", "Hustru till Bengt Gunnarsson. Vittne", "2026-10-15 kl. 11.35",
                          "Hemma hos makarna, Uppsala", "163 cm")
    story += forhor([
        ("F", "Du sa 2019 att du inte förlåtit Henrik."),
        ("S", "Det har jag fortfarande inte. Vi bodde i en tvåa i tio år efter konkursen. Men om jag hade velat göra honom illa hade jag gjort det 1998, inte tjugo år senare med en man på kryckor att ta hand om."),
        ("F", "Du sa att ni inte gick ut den natten."),
        ("S", "Vi gick inte ut. Gästflygeln sitter ihop med huvudbyggnaden. Men jag gick in i hallen strax efter tolv för att hämta mina läsglasögon, de låg kvar i salongen."),
        ("F", "Varför sa du inte det 2019?"),
        ("S", "Ni frågade om vi hade gått ut. Det hade vi inte. Och det var tidigt på morgonen och ingen hade sagt att Henrik var död."),
        ("F", "Vad såg du i hallen?"),
        ("S", "Den gula rocken hängde på kroken och droppade. Det var blöta fotspår på golvet, stora, mycket större än Bengts, från kroken bort mot köksdörren. Jag tänkte att Henrik hade kommit in från fyren och gått ut i köket för att äta något. Jag såg ingen."),
        ("F", "Var det ljus i köket?"),
        ("S", "Nej. Det var mörkt överallt utom i hallen."),
        ("A", "Samtalet avslutat kl. 12.05."),
    ])
    return bygg(ut / "B13_Forhor_Gunnarsson.pdf", "B13", "Förhör Bengt och Inger Gunnarsson", story)


def dok_b14(ut):
    bredd = PAGE_W - 2 * MARG
    sida = [
        ("tors 10/10", {"fet": True, "understruken": True}),
        "Tärnan – 2 lager. RÖR EJ t.o.m. lör",
        "tjära till årorna",
        "Havsvind 15/10 – ring A.H. före!",
        None,
        ("fre 11/10", {"fet": True, "understruken": True}),
        "B & I – 12-båten. Jonas bär.",
        "S. Lind = journalist (A.)  → prata lör",
        "K. F&V  14 st sedan jan",
        ("412,6", {"fet": True, "indrag": 24, "ringad": True}),
        ("fs?  kyl?  – inget", {"indrag": 12}),
        ("kst 30 ?   kto ??", {"indrag": 12}),
        ("→ Bh 23.00 – pärmen", {"fet": True}),
        ("fyren 24", {"farg": colors.HexColor("#5A6F9A")}),
    ]
    story = [
        P("BESLAG UR DEN AVLIDNES KAVAJ, KONTORET", "etikett"),
        P("Henriks anteckningsbok", "h1"),
        P("Svart anteckningsbok med spiral. Den sista sidan med text återges nedan. Tidigare sidor innehåller inköpslistor, tidvattentabeller och bokningar.", "brod_liten"),
        luft(3),
        Ritning(bredd, 150 * mm, rita_anteckningsbok(sida)),
    ]
    return bygg(ut / "B14_Anteckningsbok.pdf", "B14", "Anteckningsbok", story)


def dok_b15(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("UTDRAG UR OPERATÖRENS TRAFIKDATA OCH TELEFONENS MINNE", "etikett"),
        P("Henriks mobiltelefon, 10–12 oktober 2019", "h1"),
        P("Samtal till pensionatets växel visas med anknytning.", "brod_liten"),
        luft(3),
        tabell(["Datum", "Tid", "Typ", "Motpart", "Innehåll / längd"], [
            ["10/10", "17.20", "Samtal ut", "Anders Holm", "6 min 02 s"],
            ["10/10", "21.05", "Sms ut", "Lukas", "”Svaret är nej. Pensionatet säljs inte så länge jag lever.”"],
            ["11/10", "16.02", "Samtal in", "Maria", "4 min 10 s"],
            ["11/10", "16.40", "Samtal ut", "Ankn. 114", "0 min 00 s, ej besvarat"],
            ["11/10", "18.44", "Sms in", "Bengt Gunnarsson", "”Vi kommer till middagen kl 19. Mvh Bengt”"],
            ["11/10", "21.12", "Sms in", "Lukas", "”Du kommer att ångra det här, pappa.”"],
            ["11/10", "21.15", "Sms ut", "Lukas", "”Vi pratar när du har lugnat dig. Kram”"],
            ["11/10", "21.40", "Sms ut", "Maria", "”Hittade något i bokföringen som inte stämmer alls. Tar det ikväll. Berättar imorgon. Kram”"],
            ["11/10", "22.46", "Samtal ut", "Ankn. 104", "0 min 38 s"],
            ["11/10", "23.58", "Samtal in", "Maria", "Ej besvarat"],
            ["12/10", "00.02", "Sms in", "Maria", "”Sover du? God natt älskling”"],
            ["12/10", "07.31", "Samtal in", "Maria", "Ej besvarat"],
        ], [14 * mm, 14 * mm, 20 * mm, 30 * mm, bredd - 78 * mm], mono=True),
        luft(5),
        P("Polisens anteckning 2019: ”Inget av intresse för utredningen.”", "brod_liten"),
    ]
    return bygg(ut / "B15_Telefon.pdf", "B15", "Henriks telefon", story)


def dok_b16(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("TRANVIKSLINJEN · RESEKORTSREGISTRERINGAR", "etikett"),
        P("Färjelogg, Tranvik – Gråskär", "h1"),
        P("Färjan är det enda reguljära sättet att ta sig till och från ön. Resande som betalar med resekort registreras med namn.", "brod_liten"),
        luft(2),
        tabell(["Datum", "Avgång", "Sträcka", "Resande", "Registrerade resekort"], [
            ["ons 9/10", "12.00", "Tranvik → Gråskär", "1", "Lukas Lindqvist"],
            ["", "15.10", "Gråskär → Tranvik", "1", "Lukas Lindqvist"],
            ["tors 10/10", "16.30", "Tranvik → Gråskär", "1", "Sofia Berg"],
            ["fre 11/10", "07.10", "Tranvik → Gråskär", "0", ""],
            ["", "07.50", "Gråskär → Tranvik", "0", ""],
            ["", "12.00", "Tranvik → Gråskär", "2", "Bengt Gunnarsson, Inger Gunnarsson"],
            ["", "12.40", "Gråskär → Tranvik", "0", ""],
            ["", "15.10", "Gråskär → Tranvik", "1", "Maria Lindqvist"],
            ["", "16.30", "Tranvik → Gråskär", "0", ""],
            ["", "20.40", "Tranvik → Gråskär", "0", "Sista turen till ön"],
            ["", "21.20", "Gråskär → Tranvik", "0", "Sista turen från ön"],
            ["lör 12/10", "07.50", "Gråskär → Tranvik", "2", "Bengt Gunnarsson, Inger Gunnarsson"],
            ["", "09.00", "Tranvik → Gråskär", "2", "Extratur: Maria Lindqvist, Lukas Lindqvist"],
        ], [18 * mm, 15 * mm, 34 * mm, 15 * mm, bredd - 82 * mm], mono=True),
        luft(4),
        P("Roslagens sjötaxi, körjournal 11–12 oktober", "h2"),
        P("Inga körningar till eller från Gråskär mellan fredag kl. 12 och lördag kl. 12."),
        P("Båtar på Gråskär natten 11–12 oktober: Tärnan (pensionatet) på land i båthuset. Anders Holms snipa vid ångbåtsbryggan, upplagd för vintern sedan 1 oktober enligt hamnfogdens liggare."),
        luft(2),
        KeepTogether([
            P("Kortköp, Lukas Lindqvist (utdrag ur kontoutdrag)", "h2"),
            Table([[
                tabell(["Datum", "Tid", "Mottagare", "Belopp"], [
                    ["2019-10-11", "21.48", "Bar Kajen, Norrtälje", "168,00"],
                    ["2019-10-11", "23.52", "Bar Kajen, Norrtälje", "236,00"],
                    ["2019-10-12", "00.41", "Taxi Norrtälje", "189,00"],
                ], [20 * mm, 12 * mm, 44 * mm, 18 * mm], mono=True),
                Ritning(58 * mm, 82 * mm, rita_kvitto),
            ]], colWidths=[100 * mm, bredd - 100 * mm], style=[("VALIGN", (0, 0), (-1, -1), "TOP")]),
        ]),
    ]
    return bygg(ut / "B16_Farjelogg_och_kortkop.pdf", "B16", "Färjelogg och kortköp", story)


def _artikel(datum, rubrik, ingress, stycken, sidinfo):
    bredd = PAGE_W - 2 * MARG
    spalt = (bredd - 8 * mm) / 2
    huvud = [
        P(f"<font name='Serif-Bold'>{'UPSALA DAGBLAD' if '1998' in datum else 'ROSLAGSPOSTEN'}</font>&nbsp;&nbsp;·&nbsp;&nbsp;{datum}&nbsp;&nbsp;·&nbsp;&nbsp;{sidinfo}", "etikett"),
        luft(1),
        P(rubrik, "serif_rubrik"),
        P(ingress, "ingress"),
    ]
    halv = (len(stycken) + 1) // 2
    t = Table([[[P(x, "tidning_spalt") for x in stycken[:halv]], [P(x, "tidning_spalt") for x in stycken[halv:]]]],
              colWidths=[spalt, spalt], style=[
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 4 * mm),
        ("LINEAFTER", (0, 0), (0, 0), 0.4, LINJE),
        ("LEFTPADDING", (1, 0), (1, 0), 4 * mm),
    ])
    return huvud + [t]


def _avdelare():
    return [luft(4), Table([[""]], colWidths=[PAGE_W - 2 * MARG], style=[("LINEABOVE", (0, 0), (-1, -1), 1.2, BLAK)]), luft(2)]


def dok_b17(ut):
    story = _artikel(
        "torsdag 12 november 1998", "Uppsalakrog i konkurs – delägarna i bitter tvist",
        "Krogen Ågatan har stängt efter sex år. Nu anklagar delägarna varandra.",
        [
            "Det blev ingen julbord på Krogen Ågatan i år. Förra veckan begärdes restaurangen i konkurs, med skulder på över fyra miljoner kronor.",
            "Delägaren Bengt Gunnarsson har gått i personlig borgen för lånen och riskerar att förlora sin villa i Luthagen.",
            "”Henrik skötte ekonomin och sa att allt var under kontroll. Jag kommer aldrig att förlåta honom”, säger Bengt Gunnarsson.",
            "Den andre delägaren, Henrik Lindqvist, säger att han själv har förlorat allt han ägde. Han planerar att flytta ut i skärgården.",
        ], "Uppsala, sid. 9")
    story += _avdelare()
    story += _artikel(
        "lördag 28 september 2019", "Vindkraftsstrid splittrar Gråskär",
        "Pensionatsvärden vill arrendera ut norra udden till ett vindkraftsbolag. Fyrföreningen lovar att stoppa planerna.",
        [
            "Fyra vindkraftverk, vart och ett 150 meter högt, kan stå på Gråskärs norra udde om tre år. Bolaget Havsvind Roslagen har lämnat in en ansökan, och markägaren Henrik Lindqvist har skrivit på en avsiktsförklaring.",
            "”Ön behöver en inkomst året runt”, säger Henrik Lindqvist.",
            "Fyrföreningens ordförande Anders Holm har samlat in 412 namnunderskrifter mot planerna.",
            "”Det blir inga snurror på norra udden. Över min döda kropp, eller hans”, säger Anders Holm.",
        ], "Lokalt, sid. 6")
    story += _avdelare()
    story += _artikel(
        "tisdag 15 oktober 2019", "Pensionatsvärd hittad död vid fyren",
        "En 58-årig man hittades död vid Gråskärs fyr i lördags morse. Polisen misstänker inte brott.",
        [
            "Mannen, som drev pensionatet på ön, hittades av en granne strax före klockan sju. Han låg vid fyrens yttre trappa.",
            "”Vi tror att han har fallit i trappan i mörkret”, säger polisens presstalesperson.",
        ], "Lokalt, sid. 4")
    return bygg(ut / "B17_Tidningsklipp.pdf", "B17", "Tidningsklipp", story, papper=TIDNING)


def dok_b18(ut):
    story = [
        P("<font name='Serif-Bold' size='16'>Skärgårdens Försäkring</font>", "serif"),
        P("Box 112, 761 21 Norrtälje", "brod_liten"),
        luft(10),
        P("Henrik Lindqvist<br/>Gråskärs pensionat<br/>Gråskär<br/>761 99 Norrtälje", "serif"),
        luft(6),
        P("Norrtälje 2019-04-08", "serif"),
        luft(3),
        P("<b>Bekräftelse: ändrat försäkringsbelopp, livförsäkring nr 44-208815</b>", "serif"),
        P("Hej Henrik,", "serif"),
        P("Vi bekräftar att försäkringsbeloppet för din livförsäkring höjs från 800 000 kr till 3 000 000 kr från och med 2019-05-01. Höjningen görs på begäran av Roslagsbanken som säkerhet för lånet till takrenoveringen (lån nr 4402-118).", "serif"),
        P("Förmånstagare är oförändrat din make/maka, Maria Lindqvist.", "serif"),
        luft(4),
        P("Med vänlig hälsning<br/><font name='Hand' size='17' color='#22408A'>Lena Brandt</font><br/>Lena Brandt, rådgivare", "serif"),
    ]
    return bygg(ut / "B18_Forsakringsbrev.pdf", "B18", "Försäkringsbrev", story)


def dok_b19(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("FORENSISKA LABORATORIET · ANALYS AV BESLAG FRÅN 2019", "etikett"),
        P("Analysrapport, ärende 5000-K1047-19", "h1"),
        faltrutor([
            ("Beställare", "Skuggarkivet via åklagare, 2026-10-02"),
            ("Rapportdatum", "2026-11-06"),
            ("Material", "Beslag 1–6 från 2019, prov 19-4412 från obduktionen, färgprov från båten Tärnan (taget 2026), samt en ficklampa som Gråskärs fyrförening lämnade in 2026"),
            ("Referensprov", "Henrik Lindqvist, ur obduktionsprov"),
        ]),
        luft(4),
        P("Resultat", "h2"),
        tabell(["Beslag", "Resultat"], [
            ["1. Regnrock, gul, stl M",
             "Ryggsömmen sprucken på 11 cm. På bild från 2019-10-12 är trådändarna ljusa och osmutsade. Ärmarnas muddar är uttöjda. Inget blod."],
            ["2. Gummistövlar, stl 46",
             "Röd kopparoxidbaserad färg på sulor och skaft. Färgen har trängt ner i sulmönstret och dragits ut i strimmor. Inget användbart DNA."],
            ["3. Åra, tjärad furu",
             "Ett ca 2 cm stort stycke saknas i bladkanten. Brottytan passar mot flisorna i prov 19-4412. Blod i en spricka nära bladet: DNA från Henrik Lindqvist. Röd kopparoxidbaserad färg på bladets baksida."],
            ["4. Skottkärra",
             "Spår av blod på kärlets främre kant, trots spolning: DNA från Henrik Lindqvist. Röd kopparoxidbaserad färg på hjulet. Sand och tångrester i hjulets mönster."],
            ["5. Askrester",
             "Ved, delvis förkolnat papper och en smält plastrygg från en pärm. Läsbara fragment: ”…bbskär F…”, ”Faktura nr 10…” och ”…att betala: 38 4…”."],
            ["6. Fleecejacka, grön",
             "Ullfibrer, blå, förenliga med den avlidnes tröja. Inget blod."],
            ["Färgprov, Tärnan",
             "Röd kopparoxidbaserad bottenfärg. Samma sammansättning som färgen på beslag 2, 3 och 4."],
            ["7. Ficklampa, gul, stor",
             "Hittad 2021 av en sportdykare på ca 3 m djup nedanför strandstigen, 40 m söder om fyren. Förvarad av fyrföreningen sedan dess. Strömbrytaren i läge PÅ. Batterierna urladdade och korroderade. Gravyr: \u201dH.L. Gråskär\u201d. Inga användbara spår."],
            ["Prov 19-4412",
             "Röda partiklar: kopparoxidbaserad färg, samma sammansättning som färgprovet från Tärnan. Trä: furu, impregnerad med trätjära."],
        ], [36 * mm, bredd - 36 * mm]),
    ]
    return bygg(ut / "B19_Analysrapport.pdf", "B19", "Analysrapport", story, papper=LAB)


def dok_b20(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("GRÅSKÄRS PENSIONAT HB · ÅTERSKAPAD UR BANKENS BETALNINGSHISTORIK 2026", "etikett"),
        P("Leverantörsreskontra, kostnadsställe 30 (kök), jan–sep 2019", "h1"),
        P("Den ursprungliga pärmen med pappersfakturor för hösten 2019 har inte hittats. Uppgifterna nedan kommer från bankens betalningshistorik och leverantörernas egna kopior.", "brod_liten"),
        luft(3),
        tabell(["Leverantör", "Fakturor", "Belopp kr", "Betalas till", "Attest"], [
            ["Roslagens Grossist AB", "38", "286 400", "BG 5512-0931", "kst 30"],
            ["Fiskboden Grisslehamn", "9", "58 300", "BG 260-1188", "kst 30"],
            ["Kobbskär Fisk & Vilt AB", "14", "412 600", "Bankkonto 8327-9, 944 518 203-6", "kst 30"],
            ["Norrtälje Mejeri", "18", "41 200", "BG 448-2210", "kst 30"],
            ["Skärgårdsbageriet", "36", "33 900", "BG 5023-7714", "kst 30"],
            ["Vinkällaren i Roslagen AB", "12", "96 500", "BG 5871-3302", "kst 30"],
            ["Grönsakshallen Sorunda", "21", "64 700", "BG 330-9917", "kst 30"],
        ], [48 * mm, 18 * mm, 22 * mm, 58 * mm, bredd - 146 * mm], mono=True),
        luft(4),
        P("Fakturor från Kobbskär Fisk & Vilt AB, enligt bankens betalningshistorik", "h2"),
        tabell(["Faktura", "Betald", "Belopp kr"], [
            ["1001", "2019-01-28", "21 400"], ["1004", "2019-02-25", "28 900"], ["1007", "2019-03-22", "24 600"],
            ["1010", "2019-04-12", "31 200"], ["1013", "2019-05-03", "26 800"], ["1016", "2019-05-24", "29 700"],
            ["1019", "2019-06-14", "33 500"], ["1022", "2019-06-28", "38 400"], ["1025", "2019-07-12", "36 900"],
            ["1028", "2019-07-26", "32 100"], ["1031", "2019-08-09", "34 800"], ["1034", "2019-08-23", "29 300"],
            ["1037", "2019-09-13", "25 600"], ["1040", "2019-10-04", "19 400"],
        ], [24 * mm, 30 * mm, 26 * mm], mono=True),
        luft(3),
        P("Kobbskär Fisk & Vilt AB, org.nr 559188-0000, registrerat 2018-11-02. Bolaget har inga andra kända kunder och avregistrerades 2020-06-30.", "brod_liten"),
    ]
    return bygg(ut / "B20_Leverantorsreskontra.pdf", "B20", "Leverantörsreskontra", story)


def dok_b21(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("ROSLAGSBANKEN · LÖNEFIL FRÅN GRÅSKÄRS PENSIONAT HB", "etikett"),
        P("Löneutbetalning 2019-09-25", "h1"),
        P("Utskrift av den fil som pensionatets lönesystem skickade till banken. Filen innehåller bara anställningsnummer, inte namn.", "brod_liten"),
        luft(3),
        tabell(["Post", "Anst.nr", "Mottagarkonto", "Belopp kr", "Status"], [
            ["01", "0007", "8327-9, 931 207 554-2", "25 185,00", "Utförd"],
            ["02", "0012", "8214-9, 102 774 551-8", "17 940,00", "Utförd"],
        ], [14 * mm, 20 * mm, 62 * mm, 30 * mm, bredd - 126 * mm], mono=True),
        luft(3),
        P("Summa: 43 125,00 kr. Avsändarkonto: Roslagsbanken 7719-03 (pensionatets driftskonto).", "mono"),
        luft(8),
        P("SWEDBANK · SVAR PÅ ÅKLAGARENS BEGÄRAN OM KONTOUPPLYSNINGAR, 2026-11-03", "etikett"),
        P("Kontouppgifter, konto 8327-9, 944 518 203-6", "h2"),
        faltrutor([
            ("Kontoinnehavare", "Linda Sjöberg, f. 1981"),
            ("Folkbokförd 2019", "Rimbo"),
            ("Kontot öppnat", "2018-11-05"),
            ("Kontot avslutat", "2020-07-02"),
            ("Insättningar 2019", "14 st, totalt 412 600 kr, avsändare Gråskärs Pensionat HB"),
            ("Uttag 2019", "Kontantuttag och kortköp, bl.a. bilhandel i Norrtälje 2019-06-19, 186 000 kr"),
        ]),
        luft(2),
        P("Banken lämnar inga uppgifter om fullmakter eller om vem som har använt kontots kort.", "brod_liten"),
    ]
    return bygg(ut / "B21_Bankuppgifter.pdf", "B21", "Bankuppgifter", story)


# ==========================================================================
# Svarskontroll, ledtrådar, lösning
# ==========================================================================

def dok_svarskontroll(ut):
    bredd = PAGE_W - 2 * MARG
    rader = []
    for b, _ in PERSONER:
        for m, _ in MOTIV:
            kod = f"{PKOD[b]}{MKOD[m]}"
            rader.append((kod, KONTROLLORD[(b, m)]))
    rader.sort()
    halv = (len(rader) + 1) // 2
    v, h = rader[:halv], rader[halv:]
    while len(h) < len(v):
        h.append(("", ""))
    data = [[P("Kod", "cell_head"), P("Kontrollord", "cell_head"), P("Kod", "cell_head"), P("Kontrollord", "cell_head")]]
    for (k1, t1), (k2, t2) in zip(v, h):
        data.append([P(f"<b>{k1}</b>", "cell_mono"), P(t1, "cell_mono"), P(f"<b>{k2}</b>", "cell_mono"), P(t2, "cell_mono")])
    t = Table(data, colWidths=[20 * mm, 63 * mm, 20 * mm, 63 * mm], repeatRows=1)
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, 0), 0.9, BLAK),
        ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINJE),
        ("LINEAFTER", (1, 0), (1, -1), 0.6, LINJE),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story = [
        P("SVARSKONTROLL", "etikett"),
        P("Kontrollera din svarskod", "h1"),
        P("Leta upp din svarskod och skriv ner kontrollordet. Varje kod har ett eget ord, så listan avslöjar inte vilket svar som är rätt. Omslaget till <b>Lösningen</b> visar det rätta kontrollordet. Har du ett annat ord är svaret fel: stäng filen och gå tillbaka till akten. Ett fel svar ger ingen ledning om vilken del som var fel."),
        luft(3),
        t,
    ]
    return bygg(ut / "Svarskontroll.pdf", None, "Svarskontroll", story)


def dok_ledtradar(ut):
    story = [
        P("LEDTRÅDAR", "etikett"),
        P("Om du har kört fast helt", "h1"),
        P("Ta en ledtråd i taget. De blir tydligare ju längre ner du läser, och den sista i varje del gör fallet betydligt lättare."),
        luft(2),
    ]
    delar = {
        "Vem?": [
            "Polisen utgick från att Henrik levde kl. 23.40. Pröva den uppgiften mot allt annat i akten.",
            "Fotograferna 2019 såg mer än de förstod. Läs fotoprotokollet rad för rad tillsammans med väderloggen.",
            "Två personer beskriver vandraren i regnrocken. Vad säger vittnesmålen, och vad säger rocken själv, om hur stor personen var?",
            "Tre av de misstänkta var stora nog. En var inte på ön, och en kunde knappt gå.",
            "En av de misstänkta har berättat samma historia två gånger, med sju års mellanrum. Jämför versionerna med vad vittnena såg, och med kartan.",
        ],
        "Varför?": [
            "Henrik ägnade sina sista kvällar åt pärmarna.",
            "Allt som brändes i båthuset var inte ved.",
            "Köket godkände sina egna inköp. Vem i köket fanns på plats hela året? Och vad betyder bolagets namn?",
            "Pengarna gick inte till någons lönekonto. Vem står kökschefen nära, och var bor hon?",
        ],
    }
    for rubrik, lista in delar.items():
        story.append(P(rubrik, "h2"))
        for i, l in enumerate(lista, 1):
            story.append(P(f"<b>{i}.</b>&nbsp;&nbsp;{l}"))
    return bygg(ut / "Ledtradar.pdf", None, "Ledtrådar", story)


def dok_losning(ut):
    bredd = PAGE_W - 2 * MARG
    story = [sida_omslag("LÖSNINGEN", "LÖSNINGEN",
                         f"Rätt kontrollord: {KONTROLLORD[RATT]}\nHar du ett annat ord? Stäng filen och läs inte vidare.",
                         "Innehåll: Beviskedjan · Motiven · Tidslinje · Epilog"),
             NextPageTemplate("akt"), PageBreak()]
    story += [
        P("LÖSNING", "etikett"),
        P("Jonas Ek dödade Henrik Lindqvist för att dölja en förskingring", "h1"),
        P("Sedan januari 2019 hade Jonas Ek fört ut 412 600 kr ur pensionatet med fakturor från Kobbskär Fisk & Vilt AB, ett bolag utan verksamhet. Köket attesterade sina egna inköp, och Henrik betalade utan att granska. När Henrik tog över bokföringen hittade han fakturorna. Han kallade Jonas till båthuset kl. 23 för att konfrontera honom."),
        P("Beviskedjan", "h2"),
        P("<b>1. Henrik låg vid fyren före 23.30.</b> Regnmätaren registrerar det första regnet mellan 23.20 och 23.30 (B04), och Aisha vaknar av det vid halv tolv (B12). Hällen under kroppen var ljusare än omgivningen, det vill säga torr (B02 F7, B11), medan allt annat var blött (B01). Henrik låg alltså där redan när regnet började. Han kan inte ha gått förbi Sofias fönster 23.40."),
        P("<b>2. Han dog i båthuset.</b> Fyrens trappa är vitmålat gjutjärn (B01, B02 F6). I såret fanns tjärat furuträ och kopparoxidfärg (B03), samma färg som på Tärnan, som målades på torsdagen (B11, B14, B19). Den tjärade åran från båthuset saknar en flisa som passar i såret och har Henriks blod på sig (B19). Sofia hörde Henrik säga \u201dKlockan elva. Ta inte med någon\u201d i telefon (B10), och Anders såg ljus och hörde en duns i båthuset 23.05–23.10 (B11). Vid kvart över elva var båthuset mörkt, och Anders hörde en kärra skramla på strandstigen (B11). Hälarna var skrapade bakåt (B03), och skottkärran har Henriks blod och tång från strandstigen i hjulet (B19). Henrik eldade aldrig i båthuset efter augusti (B07), men kaminen var full av aska och brända papper (B01, B19)."),
        P("<b>3. Personen i regnrocken var lång.</b> Rosorna skakade när personen gick under bågen (B10), vars underkant sitter på 178 cm (B02, F0). Henrik var 169 cm (B03). På Henrik räckte rocken ner på smalbenen, men på personen slutade den ovanför knäna (B07, B10). Ryggsömmen sprack (B19). Personen hade ingen ficklampa (B10), trots att Henrik aldrig gick utan (B07)."),
        P("<b>4. Bara Jonas är möjlig.</b> Längre än 178 cm är Jonas (191), Bengt (186) och Lukas (184) (B08, B09, B13). Lukas var i Norrtälje, och inga båtar gick till ön (B08, B16). Bengt gick med två kryckor och kunde inte ens ta sig till toaletten på natten utan hjälp (B13), men personen i rocken gick fort med händerna i fickorna (B10)."),
        P("<b>5. Jonas ljuger.</b> Han säger att ingen ringde honom, men Henrik ringde ankn. 104 kl. 22.46 (B15). 104 är rum 1 i personalhuset (B06), och Aisha bor i tvåan (B12). Han säger att han såg Henrik från sitt fönster, men personalhuset har bara fönster mot öster, bort från grinden (B05). 2026 lägger han till att Henrik hade ficklampan tänd, men personen hade ingen (B09, B10). Han säger att han inte var i huvudbyggnaden, men Inger såg stora blöta fotspår från rockens krok till köksdörren strax efter tolv (B13). Han säger att han aldrig varit i båthuset på veckor, men stövlarna i hans storlek (B06) har våt färg från Tärnan (B01, B19). Han säger att han aldrig rört Henriks pärmar, men frågade Lukas efter dem efter begravningen (B08). Han har aldrig hört talas om Kobbskär, men hans morfar hade ett torp där (B07)."),
        P("<b>6. Motivet.</b> Henrik antecknade \u201dK. F&V 14 st sedan jan, 412,6, fs? kyl? – inget, kst 30? kto??\u201d och \u201dBh 23.00 – pärmen\u201d (B14), sa till Maria att han hittat något konstigt i fakturorna (B07) och skrev att han skulle ta det i kväll (B15). Kobbskär Fisk & Vilt fick 412 600 kr via kostnadsställe 30, köket, som attesterade sina egna inköp (B07, B20). Lukas betalade fakturor januari–april men bara det som redan var attesterat (B08), och Aisha började först i april (B06). Den som attesterade hela året var kökschefen, och Jonas tog emot alla leveranser (B12). Pengarna gick inte till Jonas lönekonto (B21). De gick till Linda Sjöberg i Rimbo (B21), och L. Sjöberg i Rimbo är Jonas anhöriga, hans syster (B06). Kobbskär är holmen där Jonas morfar hade sitt torp (B07). Från kontot köptes en bil i juni 2019 (B21), samma sommar som Jonas skaffade ny Volvo (B12). Jonas hörde på onsdagen att Henrik letade efter pengarna (B08)."),
        CondPageBreak(70 * mm),
        P("Vilka motiv fanns?", "h2"),
        tabell(["Person", "Motiv", "Varför personen inte är skyldig"], [
            ["Maria Lindqvist", "Livförsäkringen på 3 miljoner kronor och arvet. Sålde pensionatet 2021 (B07, B18).", "I Norrtälje från 15.10 till extraturen 09.00, med sin syster (B07, B16). Höjningen krävdes av banken."],
            ["Lukas Lindqvist", "Skulder, ett förmedlingsarvode på 250 000 kr och ett hotfullt sms. Skötte betalningarna jan–apr och anklagades av Henrik (B08, B15).", "Kortköp i Norrtälje 23.52 och taxi 00.41. Inga båtar till ön (B16)."],
            ["Anders Holm", "Vindkraften: \u201dÖver min döda kropp, eller hans\u201d (B17). Ljög om att han inte gick ut (B11).", "172 cm, rosorna hade inte rörts. Han var vid båthuset efter dådet och hörde kärran på strandstigen (B11)."],
            ["Bengt Gunnarsson", "Krogkonkursen 1998. Förlorade sitt hus (B13, B17).", "Två kryckor, kunde inte gå själv. Han förlorade dessutom pengar på att Henrik dog (B07, B13)."],
            ["<b>Jonas Ek</b>", "<b>Henrik hade upptäckt förskingringen på 412 600 kr.</b>", "<b>Skyldig.</b>"],
        ], [32 * mm, 66 * mm, bredd - 98 * mm], hl=[5]),
        P("Sofia Berg, Aisha Haddad och Inger Gunnarsson är vittnen. Ingen av dem är tillräckligt lång för att ha rört rosorna.", "brod_liten"),
        PageBreak(),
        P("Tidslinje", "h2"),
        tabell(["Tid", "Händelse", "Bevis"], [
            ["tors 10/10", "Henrik bottenmålar Tärnan med röd kopparfärg.", "B07, B11, B14"],
            ["fre 21.40", "Henrik skriver till Maria att något i bokföringen inte stämmer.", "B15"],
            ["22.46", "Henrik ringer Jonas på anknytning 104 och ber honom komma till båthuset kl. 23.", "B06, B14, B15"],
            ["22.50", "Henrik går från kontoret med pärmen och ficklampan.", "B10"],
            ["ca 23.05", "Jonas kommer till båthuset. Anders ser ljus i fönstret.", "B11"],
            ["ca 23.10", "Henrik konfronterar Jonas. Jonas slår honom i bakhuvudet med den tjärade åran, som lutat mot den nymålade båten. Anders hör en duns.", "B03, B11, B19"],
            ["23.10–23.20", "Jonas kör Henrik i skottkärran längs strandstigen till fyren och lägger honom vid trappan. Han lyser med Henriks ficklampa och kastar den i vattnet nedanför fyren innan han vänder.", "B03, B05, B19"],
            ["23.20–23.30", "Regnet börjar. Hällen under Henrik förblir torr.", "B02, B04"],
            ["ca 23.30", "Jonas är tillbaka i båthuset med den tomma kärran och lägger pärmen i kaminen.", "B11, B19"],
            ["ca 23.40", "Jonas tar Henriks regnrock från hallen och går förbi Sofias fönster mot fyren, utan ficklampa. Rocken spricker i ryggen. Han går bara tills han är utom synhåll och vänder. Utebelysningen kan han inte släcka: strömbrytaren sitter innanför den låsta dörren och nyckeln ligger i Henriks ficka.", "B01, B07, B10, B19"],
            ["ca 23.55", "Jonas hänger tillbaka den dyblöta rocken i hallen.", "B12"],
            ["00.00–00.15", "Jonas spolar kärran och sopar båthuset. Han går in i personalhuset, och Aisha hör dörren.", "B12, B19"],
            ["lör 06.45", "Anders ser att utebelysningen är tänd och hittar Henrik.", "B11"],
            ["11.20", "Jonas ger polisen en falsk tidpunkt och en falsk iakttagelse.", "B09"],
        ], [22 * mm, bredd - 54 * mm, 32 * mm]),
        PageBreak(),
    ]
    story += forhorshuvud("Jonas Ek", "Tidigare kökschef, Gråskärs pensionat", "2026-11-21 kl. 13.00",
                          "Polisstationen, Norrtälje", "Krinsp. Mira Sahlén, med Skuggarkivet närvarande",
                          typ="Epilog · Förhör med misstänkt", langd="191 cm")
    story += forhor([
        ("F", "Henrik ringde din anknytning, 104, kl. 22.46. Du sa 2019 att ingen ringde dig."),
        ("S", "Jag minns inte. Det är sju år sedan."),
        ("F", "Ditt fönster vetter mot havet. Grinden ligger på andra sidan huset."),
        ("S", "Jag kanske stod på trappan."),
        ("F", "Konto 944 518 203-6 tillhör din syster Linda. Dit gick Kobbskär Fisk & Vilts pengar. Samma sommar köptes en bil från kontot, och du skaffade en ny Volvo."),
        ("A", "Förhörspersonen tiger i 40 sekunder."),
        ("S", "Linda har inget med det här att göra. Han skulle aldrig ha märkt något om inte konsulten slutat. Jag vill prata med en advokat nu."),
        ("A", "Förhöret avbrutet kl. 13.26."),
    ])
    story += [
        luft(4),
        P("Åklagaren beslutade samma vecka att Jonas Ek ska delges misstanke om mord, alternativt dråp, och grov trolöshet mot huvudman.", "brod"),
        luft(4),
        P("Tack för att du utredde fallet. Hur många ledtrådar behövde du?", "elite"),
    ]
    return bygg(ut / "Losning.pdf", None, "Lösning", story, omslag=True)


# ==========================================================================

AKT = [dok_b01, dok_b02, dok_b03, dok_b04, dok_b05, dok_b06, dok_b07, dok_b08, dok_b09, dok_b10, dok_b11,
       dok_b12, dok_b13, dok_b14, dok_b15, dok_b16, dok_b17, dok_b18, dok_b19, dok_b20, dok_b21]


def main():
    global S
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ut", default=str(HERE / "utdata"), help="mapp för PDF-filerna")
    ap.add_argument("--ingen-samlingsfil", action="store_true", help="hoppa över utskriftsfilen med alla dokument")
    args = ap.parse_args()

    registrera_typsnitt()
    S = stilar()
    ut = Path(args.ut)
    (ut / "Akt").mkdir(parents=True, exist_ok=True)

    filer = [dok_las_forst(ut)]
    filer += [f(ut / "Akt") for f in AKT]
    filer += [dok_svarskontroll(ut), dok_ledtradar(ut), dok_losning(ut)]

    if not args.ingen_samlingsfil:
        try:
            from pypdf import PdfWriter
        except ImportError:
            print("pypdf saknas: hoppar över samlingsfilen (pip install pypdf)")
        else:
            w = PdfWriter()
            for f in filer:
                w.append(str(f))
            samling = ut / "Fyren_pa_Graskar_alla_dokument.pdf"
            with open(samling, "wb") as fh:
                w.write(fh)
            filer.append(samling)

    print(f"Rätt svarskod: {PKOD[RATT[0]]}{MKOD[RATT[1]]}, kontrollord: {KONTROLLORD[RATT]}")
    for f in filer:
        print(os.path.relpath(f, Path.cwd()))


if __name__ == "__main__":
    main()

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


def forhorshuvud(namn, roll, datum, plats, forhorsledare, typ="Förhör med upplysningsperson"):
    return [
        P(typ.upper(), "etikett"),
        P(namn, "h1"),
        faltrutor([
            ("Roll", roll), ("Datum och tid", datum),
            ("Plats", plats), ("Förhörsledare", forhorsledare),
            ("Ärende", f"{ARENDE} – dödsfall, Henrik Lindqvist"), ("Form", "Ljudupptagning, utskrift i sammandrag"),
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
    c.setFillColor(GUL)
    c.rect(a, b - 1.2, 10 * sk, 3, stroke=0, fill=1)
    text(118, 244, "Rum 4: fönster mot", fs=6.3, farg=GRA)
    text(118, 252, "grinden (norrut)", fs=6.3, farg=GRA)
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
    text(118, 218, "fri höjd 1,78 m · lykta", fs=6.3, farg=GRA)

    # Personalhuset
    hus(420, 322, 72, 30)
    text(420, 320, "Personalhuset", "Plex-Semi", 7, align="c")
    text(420, 329, "rum 1 · rum 2", fs=6.3, farg=GRA, align="c")
    # fönster mot öster
    for dy in (-8, 2):
        a, b = T(456, 322 + dy)
        c.setFillColor(colors.HexColor("#9AA7AB"))
        c.rect(a - 1.5, b - 6, 3, 6, stroke=0, fill=1)
    text(392, 350, "Fönster endast mot öster (havet).", fs=6.3, farg=GRA)
    text(392, 358, "Västra gaveln saknar fönster.", fs=6.3, farg=GRA)
    text(392, 366, "Personalentré mot söder.", fs=6.3, farg=GRA)

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
    text(316, 83, "utebelysning släcks kl. 24", fs=6.3, farg=GRA)
    text(330, 30, "Norra udden", "Plex-It", 6.8, farg=GRA)
    text(330, 38, "(planerad vindkraft)", "Plex-It", 6.3, farg=GRA)

    # stiganteckningar
    text(196, 160, "Fyrstigen", "Plex-It", 6.8, farg=GRA)
    text(196, 168, "ca 350 m", "Plex-It", 6.3, farg=GRA)
    text(452, 220, "Strandstigen", "Plex-It", 6.8, farg=GRA)
    text(452, 228, "ca 600 m", "Plex-It", 6.3, farg=GRA)

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

    # torr fläck under kroppen (skraffering)
    kx, ky = bx - 110, by - 40
    c.saveState()
    p = c.beginPath()
    p.roundRect(kx - 8, ky - 22, 150, 46, 18)
    c.clipPath(p, stroke=0, fill=0)
    c.setStrokeColor(colors.HexColor("#C9A54A"))
    c.setLineWidth(0.7)
    for i in range(-60, 220, 6):
        c.line(kx - 8 + i, ky - 22, kx - 8 + i + 46, ky + 24)
    c.restoreState()
    c.setStrokeColor(colors.HexColor("#C9A54A"))
    c.setLineWidth(0.9)
    c.setDash(3, 2)
    c.roundRect(kx - 8, ky - 22, 150, 46, 18, stroke=1, fill=0)
    c.setDash()

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
    etikett(kx + 20, ky + 18, "Torr berghäll under kroppen vid flytt kl. 09.40", 24, ky + 75)
    etikett(hx - 110, hy + 11, "Seglarskor, klackarna nötta bakåt", 24, ky - 50)
    etikett(hx + 8, hy - 4, "Blod, ringa mängd (endast under huvudet)", hx - 60, ky - 62)

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


def svarsblad():
    """Det enda svarsbladet: vem är skyldig, och varför?"""
    def alt_tabell(rubrik, alternativ):
        rader = [[P(f"<b>{b}</b>", "cell"), P(a, "cell"), P(f"<font name='Mono-Bold'>{k}</font>", "cell")]
                 for b, a, k in alternativ]
        t = Table([[P("", "cell_head"), P(rubrik, "cell_head"), P("Kod", "cell_head")]] + rader,
                  colWidths=[10 * mm, 125 * mm, 35 * mm])
        t.setStyle(TableStyle([
            ("LINEBELOW", (0, 0), (-1, 0), 0.9, BLAK),
            ("LINEBELOW", (0, 1), (-1, -1), 0.3, LINJE),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        return t

    return [
        P("SVARSBLAD", "uppdrag_nr"),
        luft(2),
        P("Vem dödade Henrik Lindqvist, och varför?", "uppdrag_fraga"),
        P("Henrik dog inte av ett fall. Någon på Gråskär dödade honom och fick det att se ut som en olycka. Flera personer i akten hade skäl att vilja honom illa, men bara en av dem gjorde det. Välj en person och ett motiv. Var beredd att visa vilka bevis som stöder ditt svar."),
        luft(3),
        P("Fråga 1: Vem är skyldig?", "h2"),
        alt_tabell("Person", VEM),
        luft(5),
        P("Fråga 2: Varför?", "h2"),
        alt_tabell("Motiv", VARFOR),
        luft(5),
        P("Kontrollera först koden för personen i <b>Svarskontroll</b>. Är personen rätt kontrollerar du koden för motivet. När båda är rätt får du öppna <b>Lösningen</b>.", "brod_liten"),
    ]


# --- Svarsalternativ och svarskoder ----------------------------------------

VEM = [("A", "Maria Lindqvist, hustru", "146"),
       ("B", "Lukas Lindqvist, son", "673"),
       ("C", "Jonas Ek, kökschef", "509"),
       ("D", "Aisha Haddad, servering och städ", "287"),
       ("E", "Sofia Berg, gäst", "934"),
       ("F", "Anders Holm, hamnfogde", "358")]
VARFOR = [("1", "Livförsäkringen på 3 miljoner kronor", "461"),
          ("2", "Henrik vägrade sälja pensionatet, trots sonens skulder", "642"),
          ("3", "Striden om vindkraften på norra udden", "725"),
          ("4", "Henrik hade upptäckt att pengar förts ut ur pensionatet med falska fakturor", "183")]

SVAR = {
    # Vem
    "146": ("Vem", "Fel. Maria tjänade på dödsfallet, men hon lämnade ön med färjan 15.10 och kom tillbaka först med extraturen 09.00 på lördagen (B15). Det gick inga andra båtar till ön den natten."),
    "673": ("Vem", "Fel. Lukas hade motiv, och han är lång nog för att ha fått böja sig under rosenbågen. Men han betalade på Bar Kajen i Norrtälje kl. 23.52 och tog taxi hem 00.41. Inga färjor eller sjötaxi gick till ön (B15)."),
    "509": ("Vem", "Rätt person. Kontrollera nu koden för motivet."),
    "287": ("Vem", "Fel. Aisha är 1,62 m och hade inte behövt böja sig under rosenbågen (B05, B06, B10). Hon har heller inget motiv i akten."),
    "934": ("Vem", "Fel. Sofia är vittnet som såg personen i regnrocken från rum 4. Hon bodde under falskt namn för sitt arbete, men har inget motiv."),
    "358": ("Vem", "Fel. Anders hade motiv och var på ön, men han är 1,72 m och hade inte behövt böja sig under rosenbågen. Stövlarna med våt bottenfärg är storlek 46, och Anders har 43 (B06, B18)."),
    # Varför
    "461": ("Varför", "Fel motiv. Livförsäkringen var Marias motiv, och höjningen gjordes på bankens krav (B17). Varför skulle den skyldige bränna en pärm med fakturor?"),
    "642": ("Varför", "Fel motiv. Att Henrik vägrade sälja gav Lukas ett motiv, inte den skyldige. Vad bar Henrik med sig till båthuset (B10, B13)?"),
    "725": ("Varför", "Fel motiv. Vindkraftsstriden var Anders motiv. Den förklarar inte varför en pärm med fakturor brändes i båthusets kamin (B18)."),
    "183": ("Varför", "Rätt. Henrik hade upptäckt att 412 600 kr betalats till Kobbskär Fisk & Vilt AB för varor som aldrig levererades. Jonas Ek attesterade fakturorna, och pengarna gick till samma konto som hans lön (B07, B13, B19, B20). Fallet är löst. Öppna Lösningen."),
}


# --- Grundakt --------------------------------------------------------------

def dok_las_forst(ut):
    story = [sida_omslag("ETT FALL UR SKUGGARKIVET", "FYREN PÅ\nGRÅSKÄR",
                         "Roslagen, oktober 2019.\nEn pensionatsvärd hittas död vid fyren. Polisen kallar det en olycka.",
                         "Fiktivt fall. Alla personer, företag och händelser är påhittade."),
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
        P("I september skickade Henriks änka, Maria Lindqvist, oss en kopia av akten. Hon har aldrig trott på olycksteorin. Efter en första genomläsning tror inte jag heller på den. En del saker i akten stämmer inte med varandra, och ingen tog tag i dem 2019."),
        P("Vi har fått beslagen från 2019 analyserade och har tagit fram pensionatets bokföring. Allt ligger i akten. Nu behöver jag att du svarar på två frågor: vem dödade Henrik, och varför?"),
        P("Lycka till.<br/><font name='Hand' size='18' color='#22408A'>Kerstin</font>"),
        luft(4),
        P("Så spelar du", "h2"),
        P("1.&nbsp;&nbsp;Läs akten, bevis <b>B01–B20</b>. Anteckna gärna, och skriv ut kartan (B05) så att du har den framför dig."),
        P("2.&nbsp;&nbsp;Välj en person och ett motiv på <b>svarsbladet</b> på nästa sida."),
        P("3.&nbsp;&nbsp;Leta upp koden för personen i <b>Svarskontroll</b> och läs bara den raden. Är personen rätt kontrollerar du motivet på samma sätt."),
        P("4.&nbsp;&nbsp;När båda svaren är rätt öppnar du <b>Lösningen</b>. Fastnar du finns det ledtrådar i slutet av Svarskontroll. Ta en i taget."),
        luft(3),
        P("Innehåll i akten", "h2"),
        tabell(["Bevis", "Dokument", "Bevis", "Dokument"], [
            ["B01", "Polisrapport och beslag 2019", "B11", "Förhör: Anders Holm"],
            ["B02", "Situationsskiss vid fyren", "B12", "Förhör: Aisha Haddad"],
            ["B03", "Obduktionsprotokoll", "B13", "Henriks anteckningsbok"],
            ["B04", "Väderobservationer 11–12 okt", "B14", "Henriks telefon: samtal och sms"],
            ["B05", "Karta över Gråskär", "B15", "Färjelogg, sjötaxi, kortköp"],
            ["B06", "Personuppgifter", "B16", "Tidningsklipp, Roslagsposten"],
            ["B07", "Förhör: Maria Lindqvist", "B17", "Brev om livförsäkring"],
            ["B08", "Förhör: Lukas Lindqvist", "B18", "Analys av beslagen, 2026"],
            ["B09", "Förhör: Jonas Ek", "B19", "Leverantörsfakturor"],
            ["B10", "Förhör: Sofia Berg", "B20", "Lönespecifikation"],
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
        P("Patrull 2140 anlände med polisbåt till Gråskär kl. 08.05. Anmälaren Anders Holm mötte vid ångbåtsbryggan och visade vägen till fyren, ca 350 m norr om pensionatet.", "mono"),
        P("Den avlidne låg på rygg på berghällen vid foten av fyrens yttre spiraltrappa, med huvudet mot trappans nedersta steg. Trappan är av gjutjärn och vitmålad. Den avlidne var klädd i blå ylletröja, jeans och seglarskor. Kläderna var genomblöta. Ingen regnjacka, mössa eller ficklampa på platsen.", "mono"),
        P("Skada i bakhuvudet. Ringa mängd blod på hällen under huvudet. Inga blodspår i trappan eller på räcket.", "mono"),
        P("Fyrens dörr var låst. Nyckel i den avlidnes högra byxficka. Fyrens utebelysning var tänd när patrullen kom fram. Enligt anmälaren släcker den avlidne den varje kväll kl. 24.00.", "mono"),
        P("Den avlidnes mobiltelefon hittades senare på skrivbordet i pensionatets kontor.", "mono"),
        P("Vid flytt av kroppen kl. 09.40 noterade fotografen att berghällen under kroppen var torr. Övriga ytor var blöta efter nattens regn. Se situationsskiss B02.", "mono"),
        P("Bedömning", "h2"),
        P("Den avlidne har sannolikt fallit i trappan i mörker och halka och slagit bakhuvudet mot nedersta steget. Inga tecken på yttre våld från annan person. Rättsmedicinsk undersökning begärd.", "mono"),
        P("Beslag (insp. Lund)", "h2"),
        P("Undertecknad gick under förmiddagen igenom pensionatets byggnader. I båthuset fanns färsk aska i kaminen, fast ingen i personalen kände till att någon eldat där den veckan. Golvet var nysopat. Följande togs i beslag:", "mono"),
        tabell(["Nr", "Föremål", "Fyndplats", "Anm."], [
            ["1", "Regnrock, gul, storlek M (den avlidnes enligt personalen)", "Krok i hallen, huvudbyggnaden", "Fortfarande fuktig kl. 10.15"],
            ["2", "Gummistövlar, gröna, storlek 46", "Personalentrén, personalhuset", "Röda fläckar på sulorna"],
            ["3", "Åra, tjärad furu", "Båthuset, stod lutad mot båten Tärnan", "Kant på bladet avbruten"],
            ["4", "Skottkärra", "Båthuset", "Nyligen spolad"],
            ["5", "Askrester", "Kaminen i båthuset", "Färsk aska"],
        ], [9 * mm, 60 * mm, 55 * mm, 46 * mm], mono=True),
        luft(4),
        P("Beslut 2019-11-04", "h2"),
        P("Förundersökningen läggs ned. Brott kan inte styrkas. Rättsmedicinska fynd bedöms förenliga med fall. Beslagen ska inte analyseras. De förvaras tills vidare. /P. Ahlgren", "mono"),
    ]
    return bygg(ut / "B01_Polisrapport.pdf", "B01", "Polisrapport", story, papper=FORMULAR,
                stampel=("NEDLAGD", "2019-11-04", PAGE_W - 70 * mm, PAGE_H - 95 * mm, 9, 2))


def dok_b02(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("BILAGA TILL ANMÄLAN 5000-K1047-19", "etikett"),
        P("Situationsskiss: fyndplatsen vid Gråskärs fyr", "h1"),
        P("Skissen är upprättad på platsen 2019-10-12 kl. 09.00–09.45, innan kroppen flyttades.", "brod_liten"),
        luft(3),
        Ritning(bredd, 125 * mm, rita_situationsskiss),
        luft(5),
        P("Utdrag ur fotoprotokoll", "h2"),
        tabell(["Bild", "Tid", "Motiv"], [
            ["F1", "08.22", "Översikt från fyrstigen mot fyren. Utebelysningen tänd."],
            ["F2", "08.25", "Kroppen i ryggläge, huvudet mot nedersta trappsteget."],
            ["F3", "08.31", "Närbild bakhuvud. Skada med rak kant, ca 7 cm."],
            ["F4", "08.34", "Seglarskornas klackar. Nötning bakåt på båda."],
            ["F5", "08.40", "Trappan, steg 1–6. Ingen synlig skada på färgen, inget blod."],
            ["F6", "09.41", "Hällen efter flytt. Torr yta i kroppens form, omgivande häll blöt."],
        ], [14 * mm, 16 * mm, bredd - 30 * mm], mono=True, hl=[6]),
    ]
    return bygg(ut / "B02_Situationsskiss.pdf", "B02", "Situationsskiss", story, papper=FORMULAR)


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
        P("2. Inga skador på handflator, armbågar, knän, höfter eller rygg. Inga försvarsskador.", "mono"),
        P("3. Ytliga skrapsår på båda hälarna. Motsvarande nötning bakåt på seglarskornas klackar.", "mono"),
        P("4. Likfläckar på ryggsidan, fixerade, förenliga med ryggläge efter döden.", "mono"),
        P("Fynd i såret", "h2"),
        P("I sårkanterna fanns <b>träflisor av barrträ (furu) impregnerade med trätjära</b> samt <b>röda färgpartiklar</b>. Färgen är preliminärt bestämd som kopparoxidbaserad båtbottenfärg. Inga partiklar av vit metallfärg eller järnoxid.", "mono"),
        P("Övrigt", "h2"),
        P("Alkohol i blod: 0,3 promille. Inga tecken på sjukdom som kan ha orsakat fall.", "mono"),
        P("Dödstidpunkt: uppskattningsvis mellan kl. 22.00 den 11 oktober och kl. 01.00 den 12 oktober.", "mono"),
        P("Dödsorsak: Krosskada mot skallen med hjärnskada.", "mono"),
        P("Sammanfattande bedömning", "h2"),
        P("Skadan är förenlig med att den döde slagit bakhuvudet mot ett kantigt föremål. Ett slag med ett trubbigt, kantigt föremål kan inte uteslutas. Avsaknaden av skador på armar och höfter är ovanlig vid fall i trappa. Fynden i såret bör jämföras med materialet på fyndplatsen.", "mono"),
        P("R. Sandell", "mono"),
    ]
    return bygg(ut / "B03_Obduktionsprotokoll.pdf", "B03", "Obduktionsprotokoll", story, papper=LAB)


def dok_b04(ut):
    rader = [
        ["11 okt 18.00", "9,8", "4", "SV", "0,0", ""],
        ["19.00", "9,4", "4", "SV", "0,0", ""],
        ["20.00", "9,1", "5", "SV", "0,0", "Mulet"],
        ["21.00", "8,9", "6", "S", "0,0", ""],
        ["22.00", "8,7", "7", "S", "0,0", "Mycket mörkt, ingen måne"],
        ["23.00", "8,6", "8", "S", "0,0", ""],
        ["23.25", "", "", "", "", "<b>Regnmätaren registrerar första nederbörd</b>"],
        ["24.00", "8,1", "11", "SO", "2,1", "Kraftigt regn från 23.30"],
        ["12 okt 01.00", "7,9", "12", "SO", "4,8", ""],
        ["02.00", "7,7", "12", "SO", "5,2", ""],
        ["03.00", "7,6", "10", "O", "3,9", ""],
        ["04.00", "7,4", "8", "O", "1,1", "Regnet upphör 03.40"],
        ["05.00", "7,2", "6", "O", "0,0", ""],
        ["06.00", "7,0", "5", "O", "0,0", ""],
        ["07.00", "7,3", "5", "O", "0,0", "Gryning 07.12"],
    ]
    story = [
        P("GRÅSKÄRS FYRFÖRENING · AUTOMATISK VÄDERSTATION VID FYREN", "etikett"),
        P("Väderobservationer 11–12 oktober 2019", "h1"),
        P("Utdrag ur stationens logg, lämnat till polisen av föreningens ordförande Anders Holm. Nederbörden anges som summan för timmen som slutar vid angiven tid.", "brod_liten"),
        luft(3),
        tabell(["Tid", "Temp °C", "Vind m/s", "Riktning", "Nederbörd mm", "Anmärkning"], rader,
               [28 * mm, 18 * mm, 18 * mm, 18 * mm, 24 * mm, 64 * mm], mono=True, hl=[7]),
        luft(5),
        P("Solnedgång 11 okt kl. 18.12. Soluppgång 12 okt kl. 07.41.", "brod_liten"),
    ]
    return bygg(ut / "B04_Vaderobservationer.pdf", "B04", "Väderobservationer", story)


def dok_b05(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("GRÅSKÄR · NORRTÄLJE KOMMUN", "etikett"),
        P("Karta över Gråskär", "h1"),
        P("Ritad av Skuggarkivet efter fastighetskarta och polisens skisser. Ön är ca 1 km lång. Det finns inga bilar på ön, bara gångstigar.", "brod_liten"),
        luft(2),
        Ritning(bredd, bredd * 540 / 600, rita_karta),
        luft(3),
        P("Heldragen stig: Fyrstigen (grusad, från grinden). Streckad: Strandstigen (stenig, längs östra stranden). Prickad: gångar mellan husen.", "brod_liten"),
    ]
    return bygg(ut / "B05_Karta.pdf", "B05", "Karta över Gråskär", story)


def dok_b06(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("SAMMANSTÄLLNING · SKUGGARKIVET", "etikett"),
        P("Personuppgifter", "h1"),
        P("Personer med koppling till Gråskär helgen 11–13 oktober 2019. Längd och skostorlek kommer från körkortsregistret, polisens förhör och pensionatets personalregister.", "brod_liten"),
        luft(3),
        tabell(["Namn", "Född", "Roll", "Längd", "Sko", "Bostad"], [
            ["Henrik Lindqvist", "1961", "Ägare av Gråskärs pensionat", "1,69", "42", "Huvudbyggnaden"],
            ["Maria Lindqvist", "1965", "Hustru, delägare", "1,65", "38", "Huvudbyggnaden"],
            ["Lukas Lindqvist", "1992", "Son", "1,84", "44", "Lägenhet i Norrtälje"],
            ["Jonas Ek", "1978", "Kökschef sedan 2013", "1,91", "46", "Personalhuset, rum 1"],
            ["Aisha Haddad", "1995", "Servering och städ", "1,62", "37", "Personalhuset, rum 2"],
            ["Sofia Berg", "1990", "Gäst, rum 4 (frilansjournalist)", "1,70", "39", "Stockholm"],
            ["Anders Holm", "1956", "Hamnfogde, ordf. i fyrföreningen", "1,72", "43", "Lotsstugan, Gråskär"],
            ["Bengt Gunnarsson", "1949", "Gäst, rum 1", "1,74", "43", "Uppsala"],
            ["Inger Gunnarsson", "1951", "Gäst, rum 1", "1,63", "38", "Uppsala"],
        ], [33 * mm, 12 * mm, 50 * mm, 13 * mm, 10 * mm, bredd - 118 * mm]),
        luft(6),
        P("Pensionatets interna telefonväxel", "h2"),
        tabell(["Anknytning", "Plats"], [
            ["101", "Reception och kontor, huvudbyggnaden"],
            ["102", "Köket"],
            ["103", "Salongen"],
            ["104", "Personalhuset, rum 1"],
            ["105", "Personalhuset, rum 2"],
            ["111–114", "Gästrum 1–4"],
        ], [30 * mm, bredd - 30 * mm], mono=True),
        luft(6),
        P("Gäster helgen 11–13 oktober", "h2"),
        P("Pensionatet hade två bokningar: makarna Gunnarsson i rum 1 (fönster mot havet i söder) och Sofia Berg i rum 4. Makarna Gunnarsson har uppgett att de somnade vid 22-tiden och inte vaknade förrän kl. 06. De reste hem med färjan 07.50."),
    ]
    return bygg(ut / "B06_Personuppgifter.pdf", "B06", "Personuppgifter", story)


def dok_b07(ut):
    story = forhorshuvud("Maria Lindqvist", "Hustru till den avlidne", "2019-10-13 kl. 14.10",
                         "Polisstationen, Norrtälje", "Insp. Elsa Lund")
    story += forhor([
        ("F", "Var befann du dig på fredagen?"),
        ("S", "Jag åkte in till Norrtälje med färjan tio över tre. Jag skulle sova hos min syster Ulla och gå på hennes sextioårsfest på lördagen. Henrik skulle komma efter, med förmiddagsbåten."),
        ("F", "När hade du kontakt med Henrik senast?"),
        ("S", "Vi pratade i telefon vid fyra. Sedan skickade han ett sms vid tjugo i tio. Han skrev att han hade hittat något i bokföringen som inte stämde och att han skulle reda ut det samma kväll. Jag ringde honom strax före midnatt, men han svarade inte. Jag trodde att han hade somnat."),
        ("F", "Skötte Henrik bokföringen?"),
        ("S", "Sedan i somras, ja. Vår redovisningskonsult gick i pension i juni, och Henrik ville spara pengar. Han satt med pärmarna på kvällarna hela den veckan och svor över dem."),
        ("F", "Vem godkände fakturorna?"),
        ("S", "Leverantörsfakturorna för köket attesterade Jonas. Det har han gjort i flera år. Henrik betalade det som Jonas hade skrivit på. Han litade fullständigt på Jonas."),
        ("F", "Hade Henrik några rutiner på kvällarna?"),
        ("S", "Han gick alltid till fyren vid midnatt och släckte utebelysningen. Fyrföreningen har en överenskommelse med oss om det. Om det regnade tog han den gula regnrocken. Och han hade alltid ficklampan med sig, den stora gula. Han var mörkrädd, faktiskt, fast han aldrig sa det."),
        ("F", "Den har vi inte hittat."),
        ("S", "Den brukar hänga på kroken bredvid regnrocken."),
        ("F", "Hade Henrik någon konflikt med någon?"),
        ("S", "Med Anders, om vindkraften. Henrik ville arrendera ut norra udden till ett vindkraftsbolag. Anders var rasande. Och med Lukas. Lukas vill att vi säljer. Han har skulder, det vet jag. Men han skulle aldrig göra sin pappa illa."),
        ("F", "Vi har sett att Henriks livförsäkring höjdes i våras."),
        ("S", "Banken krävde det när vi lånade till det nya taket. Det är jag som står som förmånstagare. Det förstår jag att ni måste fråga om."),
        ("F", "Något annat du vill berätta?"),
        ("S", "Henrik bottenmålade Tärnan på torsdagen. Det är vår båt. Han ville inte ha hjälp, han var noga med sådant. Han sa att ingen fick röra henne förrän färgen torkat. Jag vet inte varför jag tänker på det nu."),
        ("A", "Förhöret avslutat kl. 14.52. Upplästes och godkändes."),
    ])
    return bygg(ut / "B07_Forhor_Maria_Lindqvist.pdf", "B07", "Förhör Maria Lindqvist", story)


def dok_b08(ut):
    story = forhorshuvud("Lukas Lindqvist", "Son till den avlidne", "2019-10-14 kl. 10.30",
                         "Per telefon", "Insp. Elsa Lund", typ="Telefonförhör med upplysningsperson")
    story += forhor([
        ("F", "Var var du på fredagskvällen den 11 oktober?"),
        ("S", "I Norrtälje. Jag var på Bar Kajen med två kompisar från ungefär halv tio till efter midnatt. Sedan tog jag taxi hem."),
        ("F", "När var du senast på Gråskär?"),
        ("S", "I onsdags. Jag åkte ut med middagsbåten och hem med eftermiddagsbåten."),
        ("F", "Vi har sett ett sms från dig till din pappa kl. 21.12: ”Du kommer att ångra det här, pappa.” Vad menade du?"),
        ("S", "Det var dumt. Det fanns en köpare till pensionatet, en hotellkedja. Pappa sa nej utan att ens träffa dem. Jag har lån som jag inte klarar, och han visste om det. Jag menade att han skulle ångra att han inte lyssnade, inget annat. Det var det sista jag skrev till honom."),
        ("F", "Har du egen båt?"),
        ("S", "Nej. Jag har inte ens körkort för båt."),
        ("F", "Hur var relationen mellan din pappa och personalen?"),
        ("S", "Bra, tror jag. Jonas har varit där i sex år. Pappa sa alltid att köket var det enda han inte behövde oroa sig för. Aisha har bara varit där sedan i våras."),
        ("A", "Förhöret avslutat kl. 10.48."),
    ])
    return bygg(ut / "B08_Forhor_Lukas_Lindqvist.pdf", "B08", "Förhör Lukas Lindqvist", story)


def dok_b09(ut):
    story = forhorshuvud("Jonas Ek", "Kökschef, Gråskärs pensionat", "2019-10-12 kl. 11.20",
                         "Salongen, Gråskärs pensionat", "Insp. Elsa Lund")
    story += forhor([
        ("F", "Berätta om fredagskvällen."),
        ("S", "Vi hade tre gäster på middag. Gunnarssons och journalisten. Jag stängde köket vid halv elva, städade klart och gick till personalhuset. Sedan låg jag och läste."),
        ("F", "Hade du kontakt med Henrik under kvällen?"),
        ("S", "Inte efter middagen. Han satt på kontoret med sina pärmar. Ingen ringde mig heller, om det är det du menar."),
        ("F", "Gick du ut igen under kvällen?"),
        ("S", "Nej. Men jag satt vid fönstret och rökte vid tjugo i tolv, ungefär. Det hade börjat ösregna. Då såg jag Henrik gå mot fyren i den gula regnrocken. Han gick dit varje kväll. Jag tänkte inte mer på det."),
        ("F", "Är du säker på att det var Henrik?"),
        ("S", "Vem annars? Det är hans rock. Den syns på långt håll."),
        ("F", "Röker du inne i personalhuset?"),
        ("S", "Vid öppet fönster. Säg det inte till Maria."),
        ("F", "När var du senast i båthuset?"),
        ("S", "Det var flera veckor sedan. Båthuset är Henriks ställe. Jag har inget där att göra."),
        ("F", "Vems är de gröna stövlarna i personalentrén?"),
        ("S", "Det står alltid en massa stövlar där. Personal, gäster, alla lånar."),
        ("F", "Hur var ditt förhållande till Henrik?"),
        ("S", "Bra. Han var en bra chef. Jag fattar inte att han är borta."),
        ("A", "Förhöret avslutat kl. 11.41. Förhörspersonen uppfattades som trött och blek."),
    ])
    return bygg(ut / "B09_Forhor_Jonas_Ek.pdf", "B09", "Förhör Jonas Ek", story)


def dok_b10(ut):
    story = forhorshuvud("Sofia Berg", "Gäst, rum 4", "2019-10-12 kl. 12.05",
                         "Salongen, Gråskärs pensionat", "Insp. Elsa Lund")
    story += forhor([
        ("F", "Varför bodde du på pensionatet?"),
        ("S", "Jag är frilansjournalist och skriver om vindkraftsplanerna i skärgården. Jag bokade under min sambos efternamn eftersom jag ville se hur folk pratade när de inte visste vem jag var. Det var inte snyggt gjort, det vet jag."),
        ("F", "Berätta om kvällen."),
        ("S", "Efter middagen satt jag i salongen och läste. Ungefär tio i elva kom Henrik ut från kontoret med en tjock pärm under armen. Han sa: ”Jag ska bara ner till båthuset en stund. Det finns kaffe kvar i termosen.” Han verkade spänd, inte som vanligt."),
        ("F", "Såg du honom komma tillbaka?"),
        ("S", "Nej. Jag gick till mitt rum strax efter kvart över elva. Från rum 4 hör man inte ytterdörren."),
        ("F", "Såg du något mer under kvällen?"),
        ("S", "Ja. Vid tjugo i tolv stod jag vid fönstret och tittade på regnet. Mitt fönster vetter mot grinden, och lyktan där var tänd. En person i en gul regnrock med luvan uppe kom från huvudbyggnaden och gick ut genom grinden mot fyren. Jag tog för givet att det var Henrik. Alla vet att han har den rocken."),
        ("F", "Såg du ansiktet?"),
        ("S", "Nej, luvan var uppe och personen gick fort med huvudet nere. Jag minns att personen böjde på huvudet när han gick under rosenbågen. Jag tänkte att han ville ha skydd för regnet."),
        ("F", "Bar personen något?"),
        ("S", "Nej. Händerna var i fickorna. Ingen ficklampa, nu när du säger det. Det var konstigt, för det var becksvart."),
        ("F", "Hur länge stod du vid fönstret?"),
        ("S", "Några minuter. Sedan gick jag och lade mig."),
        ("A", "Förhöret avslutat kl. 12.30."),
    ])
    return bygg(ut / "B10_Forhor_Sofia_Berg.pdf", "B10", "Förhör Sofia Berg", story)


def dok_b11(ut):
    story = forhorshuvud("Anders Holm", "Anmälare. Hamnfogde, ordförande i Gråskärs fyrförening", "2019-10-12 kl. 09.55",
                         "Lotsstugan, Gråskär", "Insp. Elsa Lund")
    story += forhor([
        ("F", "Berätta hur du hittade Henrik."),
        ("S", "Jag går ut med hunden varje morgon vid kvart i sju. I dag såg jag att utebelysningen vid fyren fortfarande var tänd. Det har aldrig hänt förut. Henrik släcker alltid vid midnatt. Så jag gick upp dit, och där låg han. Jag ringde 112 direkt."),
        ("F", "Rörde du honom?"),
        ("S", "Jag kände på halsen. Han var kall. Jag lade min jacka över honom, men tog bort den när jag hade ringt, eftersom de sa att jag inte skulle röra något."),
        ("F", "Vad gjorde du under fredagskvällen?"),
        ("S", "Jag var hemma ensam. Vid fem över elva, ungefär, såg jag ljus i båthusets fönster från mitt kök. Henrik pysslar ofta där på kvällarna, så jag tänkte inte på det. Kanske fem minuter senare hörde jag en duns därifrån, som när en åra välter. Jag gick och lade mig när regnet kom, strax efter halv tolv."),
        ("F", "Såg du någon gå på stigarna?"),
        ("S", "Från Lotsstugan ser man inte fyrstigen. Jag drog ner rullgardinen när jag gick och lade mig."),
        ("F", "Det har stått i tidningen att du och Henrik var ovänner om vindkraften."),
        ("S", "Ja. Jag sa en dum sak till Roslagsposten. Men det är prat. Vi har känt varandra i trettio år. Han skulle få sina snurror, och jag skulle bråka om det i kommunen. Så fungerar det här ute."),
        ("F", "Vet du något om båten Tärnan?"),
        ("S", "Henrik bottenmålade henne i torsdags. Röd kopparfärg, två lager. Han hängde en lapp på henne: RÖR EJ, VÅT FÄRG."),
        ("A", "Förhöret avslutat kl. 10.20."),
    ])
    return bygg(ut / "B11_Forhor_Anders_Holm.pdf", "B11", "Förhör Anders Holm", story)


def dok_b12(ut):
    story = forhorshuvud("Aisha Haddad", "Servering och städ, Gråskärs pensionat", "2019-10-12 kl. 12.40",
                         "Köket, Gråskärs pensionat", "Insp. Elsa Lund")
    story += forhor([
        ("F", "Berätta om fredagskvällen."),
        ("S", "Jag serverade middagen och diskade. Jag var klar kvart över tio och gick till personalhuset. Jag sov med öronproppar som vanligt."),
        ("F", "Hörde du något under natten?"),
        ("S", "Jag vaknade av regnet, det smattrar på plåttaket. Det måste ha varit halv tolv ungefär. Jag låg vaken en lång stund. Strax efter kvart över tolv slog ytterdörren igen i personalhuset. Jag trodde att Jonas kom in efter att ha rökt på trappan. Han röker alltid där."),
        ("F", "Han säger att han röker vid fönstret."),
        ("S", "Gör han? Inte vad jag vet."),
        ("F", "Vad hände på morgonen?"),
        ("S", "Jag började med frukosten kvart över sex. I hallen i huvudbyggnaden hängde Henriks gula regnrock på sin krok, alldeles dyblöt. Det var en pöl på golvet under den. Jag tänkte att Henrik hade varit ute tidigt. Jag torkade upp pölen."),
        ("F", "Hängde ficklampan där?"),
        ("S", "Nej, kroken bredvid var tom."),
        ("F", "Såg du Jonas på morgonen?"),
        ("S", "Han kom till köket vid halv sju. Han var blek och sa att han hade sovit dåligt. Han hade tofflor på sig i köket, det brukar han aldrig ha."),
        ("A", "Förhöret avslutat kl. 12.58."),
    ])
    return bygg(ut / "B12_Forhor_Aisha_Haddad.pdf", "B12", "Förhör Aisha Haddad", story)


def dok_b13(ut):
    bredd = PAGE_W - 2 * MARG
    sida = [
        ("tors 10/10", {"fet": True, "understruken": True}),
        "Tärnan bottenmålad, 2 lager kopparfärg.",
        ("Får INTE röras före lördag!", {"indrag": 12}),
        "Beställa trätjära till årorna",
        None,
        ("fre 11/10", {"fet": True, "understruken": True}),
        "Bokföringen. Kobbskär Fisk & Vilt AB",
        ("14 fakturor sedan januari", {"indrag": 12}),
        ("inga följesedlar?", {"indrag": 12}),
        ("ingenting i kylrummets lista?!", {"indrag": 12}),
        ("412 600 kr", {"fet": True, "indrag": 12, "ringad": True}),
        "Vem har attesterat?",
        "Jämför kontonumren!",
        None,
        ("Båthuset kl. 23. Ta med pärmen.", {"fet": True}),
        ("släcka fyren 24.00", {"overstruken": False, "farg": colors.HexColor("#5A6F9A")}),
    ]
    story = [
        P("BESLAG UR DEN AVLIDNES KAVAJ, KONTORET", "etikett"),
        P("Henriks anteckningsbok", "h1"),
        P("Svart anteckningsbok med spiral. Den sista sidan med text återges nedan. Tidigare sidor innehåller inköpslistor, tidvattentabeller och bokningar.", "brod_liten"),
        luft(3),
        Ritning(bredd, 168 * mm, rita_anteckningsbok(sida)),
    ]
    return bygg(ut / "B13_Anteckningsbok.pdf", "B13", "Anteckningsbok", story)


def dok_b14(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("UTDRAG UR OPERATÖRENS TRAFIKDATA OCH TELEFONENS MINNE", "etikett"),
        P("Henriks mobiltelefon, 11–12 oktober 2019", "h1"),
        P("Telefonen hittades på skrivbordet i kontoret. Den var inte lösenordsskyddad. Samtal till pensionatets växel visas med anknytning.", "brod_liten"),
        luft(3),
        tabell(["Tid", "Typ", "Motpart", "Innehåll / längd"], [
            ["16.02", "Samtal in", "Maria", "4 min 10 s"],
            ["18.44", "Sms in", "Bengt Gunnarsson", "”Vi kommer till middagen kl 19. Mvh Bengt”"],
            ["21.12", "Sms in", "Lukas", "”Du kommer att ångra det här, pappa.”"],
            ["21.15", "Sms ut", "Lukas", "”Vi pratar när du har lugnat dig. Kram”"],
            ["21.40", "Sms ut", "Maria", "”Hittade något i bokföringen som inte stämmer alls. Ska reda ut det ikväll. Berättar imorgon. Kram”"],
            ["22.46", "Samtal ut", "Pensionatets växel, ankn. 104", "0 min 38 s"],
            ["23.58", "Samtal in", "Maria", "Ej besvarat"],
            ["00.02", "Sms in", "Maria", "”Sover du? God natt älskling”"],
            ["07.31", "Samtal in", "Maria", "Ej besvarat"],
        ], [16 * mm, 22 * mm, 48 * mm, bredd - 86 * mm], mono=True),
        luft(5),
        P("Polisens anteckning 2019: ”Inget av intresse för utredningen.”", "brod_liten"),
    ]
    return bygg(ut / "B14_Telefon.pdf", "B14", "Henriks telefon", story)


def dok_b15(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("TRANVIKSLINJEN · RESEKORTSREGISTRERINGAR", "etikett"),
        P("Färjelogg, Tranvik – Gråskär", "h1"),
        P("Färjan är det enda reguljära sättet att ta sig till och från ön. Resande som betalar med resekort registreras med namn.", "brod_liten"),
        luft(2),
        tabell(["Datum", "Avgång", "Sträcka", "Resande", "Registrerade resekort"], [
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
        P("Inga körningar till eller från Gråskär mellan fredag kl. 12 och lördag kl. 12. Pensionatets egen båt Tärnan stod på land i båthuset efter bottenmålning.", "brod"),
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
    return bygg(ut / "B15_Farjelogg_och_kortkop.pdf", "B15", "Färjelogg och kortköp", story)


def dok_b16(ut):
    bredd = PAGE_W - 2 * MARG
    spalt = (bredd - 8 * mm) / 2

    def artikel(datum, rubrik, ingress, stycken, sidinfo):
        huvud = [
            P(f"<font name='Serif-Bold'>ROSLAGSPOSTEN</font>&nbsp;&nbsp;·&nbsp;&nbsp;{datum}&nbsp;&nbsp;·&nbsp;&nbsp;{sidinfo}", "etikett"),
            luft(1),
            P(rubrik, "serif_rubrik"),
            P(ingress, "ingress"),
        ]
        halv = (len(stycken) + 1) // 2
        v = [P(t, "tidning_spalt") for t in stycken[:halv]]
        h = [P(t, "tidning_spalt") for t in stycken[halv:]]
        t = Table([[v, h]], colWidths=[spalt, spalt], style=[
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, 0), 8 * mm // 2),
            ("LINEAFTER", (0, 0), (0, 0), 0.4, LINJE),
            ("LEFTPADDING", (1, 0), (1, 0), 4 * mm),
        ])
        return huvud + [t]

    story = artikel(
        "lördag 28 september 2019", "Vindkraftsstrid splittrar Gråskär",
        "Pensionatsvärden vill arrendera ut norra udden till ett vindkraftsbolag. Fyrföreningen lovar att stoppa planerna.",
        [
            "Fyra vindkraftverk, vart och ett 150 meter högt, kan stå på Gråskärs norra udde om tre år. Bolaget Havsvind Roslagen har lämnat in en ansökan till kommunen, och markägaren Henrik Lindqvist har skrivit på en avsiktsförklaring.",
            "”Ön behöver en inkomst året runt. Pensionatet bär sig bara på sommaren”, säger Henrik Lindqvist.",
            "Fyrföreningens ordförande Anders Holm har bott på Gråskär i trettio år. Han menar att verken skulle förstöra både fyrmiljön och fågellivet.",
            "”Det blir inga snurror på norra udden. Över min döda kropp, eller hans”, säger Anders Holm, som har samlat in 412 namnunderskrifter mot planerna.",
            "Kommunen väntas fatta beslut om samråd i december. Havsvind Roslagen har inte velat kommentera.",
        ], "Lokalt, sid. 6")
    story += [luft(4), Spacer(1, 1), Table([[""]], colWidths=[bredd], style=[("LINEABOVE", (0, 0), (-1, -1), 1.2, BLAK)]), luft(2)]
    story += artikel(
        "tisdag 15 oktober 2019", "Pensionatsvärd hittad död vid fyren",
        "En 58-årig man hittades död vid Gråskärs fyr i lördags morse. Polisen tror inte att något brott ligger bakom.",
        [
            "Mannen, som drev pensionatet på ön, hittades av en granne strax före klockan sju på lördagsmorgonen. Han låg vid fyrens yttre trappa.",
            "”Vi tror att han har fallit i trappan i mörkret. Det regnade kraftigt under natten”, säger polisens presstalesperson.",
            "Mannen var känd i skärgården och hade drivit pensionatet i tjugo år. Pensionatet håller stängt resten av säsongen.",
        ], "Lokalt, sid. 4")
    return bygg(ut / "B16_Tidningsklipp.pdf", "B16", "Tidningsklipp", story, papper=TIDNING)


def dok_b17(ut):
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
        P("Vi bekräftar att försäkringsbeloppet för din livförsäkring höjs från 800 000 kr till 3 000 000 kr från och med 2019-05-01. Höjningen görs på begäran av Roslagsbanken som säkerhet för lånet till takrenoveringen (lån nr 7719-03)."),
        P("Förmånstagare är oförändrat din make/maka, Maria Lindqvist. Premien blir 412 kr per månad.", "serif"),
        P("Hör av dig om du har frågor.", "serif"),
        luft(4),
        P("Med vänlig hälsning<br/><font name='Hand' size='17' color='#22408A'>Lena Brandt</font><br/>Lena Brandt, rådgivare", "serif"),
    ]
    return bygg(ut / "B17_Forsakringsbrev.pdf", "B17", "Försäkringsbrev", story)


# --- B18–B20 ---------------------------------------------------------------

def dok_b18(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("FORENSISKA LABORATORIET · ANALYS AV BESLAG FRÅN 2019", "etikett"),
        P("Analysrapport, ärende 5000-K1047-19", "h1"),
        faltrutor([
            ("Beställare", "Skuggarkivet via åklagare, 2026-10-02"),
            ("Rapportdatum", "2026-11-06"),
            ("Material", "Beslag 1–5 från 2019 samt vävnadsprov från obduktionen"),
            ("Referensprov", "Henrik Lindqvist, ur obduktionsprov"),
        ]),
        luft(4),
        P("Resultat", "h2"),
        tabell(["Beslag", "Undersökning", "Resultat"], [
            ["3. Åra, tjärad furu", "Brottyta, träslag, tjära, blod",
             "Bladets kant saknar ett 2 cm stort stycke. Flisorna från såret passar i brottytan och har samma träslag och tjära. Blod i en spricka nära bladet: DNA från Henrik Lindqvist. Röd bottenfärg på bladets baksida."],
            ["4. Skottkärra", "Blod, färg",
             "Svaga blodspår på kärlets främre kant trots spolning: DNA från Henrik Lindqvist. Röd bottenfärg på hjulet."],
            ["2. Gummistövlar, stl 46", "Färg, DNA",
             "Röd bottenfärg på sulor och skaft, kopparoxidbaserad, med samma sammansättning som på båten Tärnan. Färgen var ohärdad (våt) när stövlarna kom i kontakt med den. Inget användbart DNA kunde säkras."],
            ["5. Askrester", "Papper och plast",
             "Delvis förkolnat papper och en smält plastrygg från en pärm. Läsbara fragment: ”…bbskär Fisk & V…”, ”Faktura nr 10…” och ”…att betala: 38 4…”."],
            ["1. Regnrock, gul, stl M", "Skador, slitage",
             "Ryggsömmen är sprucken på 11 cm. Sprickan syns redan på bild från beslaget 2019 och var då färsk (ljusa trådändar, ingen smuts). Ärmarnas muddar är uttöjda. Rocken har sannolikt burits av en person som är större än storlek M."],
        ], [34 * mm, 34 * mm, bredd - 68 * mm]),
        luft(5),
        P("Sammanfattande bedömning", "h2"),
        P("Skadan som beskrivs i obduktionsprotokollet stämmer med ett slag med åran. Henrik Lindqvist har legat i skottkärran efter att han skadats. Den som bar stövlarna i storlek 46 har gått i båthuset medan Tärnans bottenfärg fortfarande var våt, alltså mellan torsdag och lördag.", "brod"),
    ]
    return bygg(ut / "B18_Analysrapport.pdf", "B18", "Analysrapport", story, papper=LAB)


FAKTUROR = [
    ("1001", "2019-01-14", "Rökt sik och gravlax", "21 400"),
    ("1004", "2019-02-11", "Viltkött, älg", "28 900"),
    ("1007", "2019-03-08", "Fisk, säsong", "24 600"),
    ("1010", "2019-03-29", "Hjortfilé", "31 200"),
    ("1013", "2019-04-19", "Abborre och gös", "26 800"),
    ("1016", "2019-05-10", "Viltkött, vildsvin", "29 700"),
    ("1019", "2019-05-31", "Rökt fisk", "33 500"),
    ("1022", "2019-06-14", "Sommarbuffé, fisk", "38 400"),
    ("1025", "2019-06-28", "Kräftor och fisk", "36 900"),
    ("1028", "2019-07-12", "Fisk, säsong", "32 100"),
    ("1031", "2019-07-26", "Hummer och fisk", "34 800"),
    ("1034", "2019-08-09", "Kräftor", "29 300"),
    ("1037", "2019-08-30", "Viltkött", "25 600"),
    ("1040", "2019-09-20", "Fisk, säsong", "19 400"),
]


def dok_b19(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("SAMMANSTÄLLNING FRÅN PENSIONATETS BOKFÖRING, ÅTERSKAPAD 2026", "etikett"),
        P("Leverantörsfakturor: Kobbskär Fisk & Vilt AB", "h1"),
        faltrutor([
            ("Leverantör", "Kobbskär Fisk & Vilt AB"),
            ("Org.nr", "559188-0000"),
            ("Registrerat", "2018-11-02"),
            ("Styrelse", "Linda Ek (ensam ledamot)"),
            ("Adress", "Box 47, 761 21 Norrtälje"),
            ("Betalas till", "Swedbank 8327-9, 944 518 203-6"),
        ]),
        luft(3),
        tabell(["Faktura", "Datum", "Avser", "Belopp kr", "Attest", "Följesedel"],
               [[n, d, a, b, "JE", "saknas"] for n, d, a, b in FAKTUROR] + [["", "", "<b>Summa</b>", "<b>412 600</b>", "", ""]],
               [18 * mm, 24 * mm, 52 * mm, 24 * mm, 16 * mm, bredd - 134 * mm], mono=True),
        luft(3),
        P("Bokföringsbyråns kommentar 2026: Inga motsvarande varor finns i pensionatets inleveranslistor för kylrum och frys. Faktura 1022 (38 400 kr) är den högsta. Alla fakturor är attesterade med signaturen ”JE”. Den ursprungliga pärmen med pappersfakturorna har inte hittats.", "brod_liten"),
    ]
    return bygg(ut / "B19_Leverantorsfakturor.pdf", "B19", "Leverantörsfakturor", story)


def dok_b20(ut):
    story = [
        P("UR PENSIONATETS LÖNEARKIV", "etikett"),
        P("Lönespecifikation, september 2019", "h1"),
        faltrutor([
            ("Arbetsgivare", "Gråskärs Pensionat HB"),
            ("Anställd", "Jonas Ek, f. 1978"),
            ("Befattning", "Kökschef"),
            ("Utbetalningsdag", "2019-09-25"),
            ("Bruttolön", "34 500,00 kr"),
            ("Skatteavdrag", "-9 315,00 kr"),
            ("Nettolön", "25 185,00 kr"),
            ("Utbetalas till konto", "Swedbank 8327-9, 944 518 203-6"),
        ]),
        luft(4),
        P("Pensionatets lönelista för 2019 omfattar Jonas Ek och Aisha Haddad samt två säsongsanställda under juni–augusti. Lönespecifikationerna för övriga anställda finns i arkivet men har inte bifogats.", "brod_liten"),
    ]
    return bygg(ut / "B20_Lonespecifikation.pdf", "B20", "Lönespecifikation", story)


# --- Lösning ---------------------------------------------------------------

def dok_losning(ut):
    bredd = PAGE_W - 2 * MARG
    story = [sida_omslag("LÖSNINGEN", "LÖSNINGEN",
                         "Öppnas först när du har svarat på båda frågorna.",
                         "Innehåll: Vem och varför · Motiven · Tidslinje · Epilog"),
             NextPageTemplate("akt"), PageBreak()]
    story += [
        P("LÖSNING", "etikett"),
        P("Jonas Ek dödade Henrik Lindqvist", "h1"),
        P("Jonas Ek hade sedan januari 2019 fört ut 412 600 kr ur pensionatet. Hans syster Linda var ensam ledamot i Kobbskär Fisk & Vilt AB, men fakturorna betalades till Jonas eget lönekonto. Som kökschef attesterade han själv fakturorna, och Henrik betalade dem utan att granska dem. När redovisningskonsulten gick i pension tog Henrik över bokföringen, och i oktober såg han att det inte fanns en enda leverans bakom fakturorna. Han kallade Jonas till båthuset för att konfrontera honom."),
        P("Så visar du att Jonas är skyldig", "h2"),
        P("<b>Henrik dog inte vid fyren.</b> Hällen under honom var torr, fast regnet började 23.25 (B02, B04). Han låg alltså där före 23.25, trots att han ska ha setts vid liv 23.40. I såret fanns tjärat furuträ och våt bottenfärg från Tärnan i båthuset, inte vit järnfärg från trappan (B03, B18). Hälarna var skrapade av att han släpats (B03)."),
        P("<b>Personen i regnrocken var inte Henrik.</b> Personen böjde på huvudet under rosenbågen, som har en fri höjd på 1,78 m (B05, B10). Av dem som var på ön är bara Jonas längre än så, och Lukas var i Norrtälje (B06, B15). Rockens ryggsöm sprack av en för stor bärare (B18). Personen hade ingen ficklampa, fast Henrik aldrig gick utan (B07, B10)."),
        P("<b>Jonas ljuger.</b> Han säger att ingen ringde honom, men Henrik ringde hans rum kl. 22.46 (B09, B14). Han säger att han såg Henrik från fönstret, men hans fönster vetter mot havet (B05). Han säger att han inte varit i båthuset på flera veckor, men stövlarna i hans storlek har våt färg från båten som målades på torsdagen (B09, B18)."),
        P("<b>Motivet.</b> Henrik skrev till Maria att något i bokföringen inte stämde (B14) och antecknade ”Vem har attesterat? Jämför kontonumren!” (B13). Jonas attesterade köksfakturorna (B07, B19), och kontot på fakturorna är hans lönekonto (B20). Pärmen brändes i båthusets kamin (B18)."),
        CondPageBreak(60 * mm),
        P("Vilka motiv fanns?", "h2"),
        P("Fyra personer hade skäl att vilja Henrik illa. Två saknade motiv."),
        tabell(["Person", "Motiv", "Varför personen inte är skyldig"], [
            ["Maria Lindqvist", "Ärver Henrik och får 3 miljoner kronor från livförsäkringen (B17).",
             "Livförsäkringen höjdes på bankens krav. Hon var i Norrtälje från 15.10 till extraturen 09.00 (B15)."],
            ["Lukas Lindqvist", "Har skulder och ville sälja. Hotfullt sms kl. 21.12 (B08, B14).",
             "Kortköp på Bar Kajen kl. 23.52 och taxi 00.41. Inga båtar gick till ön (B15)."],
            ["Anders Holm", "Ville stoppa vindkraften. ”Över min döda kropp, eller hans” (B16).",
             "1,72 m och skostorlek 43. Han såg ljuset i båthuset och anmälde fyndet (B06, B11)."],
            ["<b>Jonas Ek</b>", "<b>Henrik hade upptäckt förskingringen på 412 600 kr (B13, B19, B20).</b>",
             "<b>Skyldig.</b>"],
            ["Sofia Berg", "Inget motiv. Bodde under falskt namn för sitt arbete som journalist (B10).", "Vittne."],
            ["Aisha Haddad", "Inget motiv.", "1,62 m. Hörde dörren slå igen i personalhuset (B12)."],
        ], [30 * mm, 70 * mm, bredd - 100 * mm], hl=[4]),
        PageBreak(),
        P("Tidslinje", "h2"),
        tabell(["Tid", "Händelse", "Bevis"], [
            ["tors 10/10", "Henrik bottenmålar Tärnan med röd kopparfärg. Ingen får röra båten.", "B07, B11, B13"],
            ["fre 21.40", "Henrik skriver till Maria att något i bokföringen inte stämmer.", "B14"],
            ["22.46", "Henrik ringer Jonas på anknytning 104 och ber honom komma till båthuset kl. 23.", "B06, B13, B14"],
            ["22.50", "Henrik går från kontoret med pärmen. Telefonen blir kvar på skrivbordet.", "B01, B10"],
            ["ca 23.05", "Jonas kommer till båthuset. Anders ser ljus i fönstret.", "B11"],
            ["ca 23.10", "Henrik konfronterar Jonas med fakturorna. Jonas slår honom i bakhuvudet med den tjärade åran. Anders hör en duns.", "B03, B11, B18"],
            ["23.10–23.22", "Jonas lägger Henrik i skottkärran och kör honom längs strandstigen till fyren, där ingen kan se dem. Hälarna släpar. Han lägger Henrik vid trappan så att det ska se ut som ett fall.", "B01, B02, B03, B05, B18"],
            ["23.25", "Regnet börjar. Hällen under Henrik förblir torr.", "B02, B04"],
            ["ca 23.32", "Jonas är tillbaka i båthuset med kärran och lägger pärmen i kaminen.", "B01, B18"],
            ["ca 23.40", "Jonas har tagit Henriks gula regnrock från hallen och går förbi Sofias fönster, genom grinden och upp mot fyren. Han böjer sig under rosenbågen. Rocken är för liten, och ryggsömmen spricker. Han har ingen ficklampa. Han kan inte släcka fyrens utebelysning, eftersom nyckeln ligger i Henriks ficka.", "B01, B06, B10, B18"],
            ["ca 23.55", "Jonas hänger tillbaka den dyblöta rocken i hallen.", "B12"],
            ["00.00–00.15", "Jonas spolar kärran, sopar golvet i båthuset och ser till att pärmen har brunnit upp. Sedan går han till personalhuset. Aisha hör dörren slå igen.", "B01, B12, B18"],
            ["24.00", "Ingen släcker fyrens utebelysning.", "B01, B11"],
            ["lör 06.15", "Aisha hittar den dyblöta rocken i hallen.", "B12"],
            ["06.45", "Anders ser att utebelysningen är tänd och hittar Henrik.", "B11"],
            ["11.20", "Jonas säger till polisen att han såg Henrik från fönstret och inte har varit i båthuset. Båda påståendena är lögn.", "B05, B09"],
        ], [22 * mm, bredd - 54 * mm, 32 * mm]),
        luft(4),
        P("Varför polisen missade det 2019", "h2"),
        P("Den torra hällen noterades men kommenterades aldrig. Fynden i såret jämfördes inte med trappan, och samtalet till anknytning 104 bedömdes vara ”inget av intresse”. Insp. Lund tog beslagen men fick aldrig analysera dem. Vittnesuppgiften om Henrik i regnrocken kl. 23.40 fick hela utredningen att utgå från att han levde när regnet började."),
        PageBreak(),
    ]
    story += forhorshuvud("Jonas Ek", "Tidigare kökschef, Gråskärs pensionat", "2026-11-21 kl. 13.00",
                          "Polisstationen, Norrtälje", "Krinsp. Mira Sahlén, med Skuggarkivet närvarande",
                          typ="Epilog · Förhör med misstänkt")
    story += forhor([
        ("F", "Du sa 2019 att ingen ringde dig den kvällen. Henrik ringde din anknytning, 104, kl. 22.46. Samtalet varade i 38 sekunder."),
        ("S", "Jag minns inte det. Det är sju år sedan."),
        ("F", "Du sa att du såg Henrik från ditt fönster kl. 23.40. Fönstren i ditt rum vetter mot havet. Grinden ligger på andra sidan huset."),
        ("S", "Jag kanske stod på trappan då. Jag minns inte."),
        ("F", "Stövlarna i storlek 46 har våt bottenfärg från Tärnan på sulorna. Du sa att du inte varit i båthuset på flera veckor."),
        ("S", "Alla lånade stövlar där."),
        ("F", "Kobbskär Fisk & Vilt AB. Vem är Linda Ek?"),
        ("S", "Min syster."),
        ("F", "Fakturorna betalades till konto 944 518 203-6. Det är ditt lönekonto."),
        ("A", "Förhörspersonen tiger i 40 sekunder."),
        ("S", "Jag vill prata med en advokat nu."),
        ("A", "Förhöret avbrutet kl. 13.26."),
    ])
    story += [
        luft(4),
        P("Åklagaren beslutade samma vecka att Jonas Ek ska delges misstanke om mord, alternativt dråp, och grov trolöshet mot huvudman.", "brod"),
        luft(4),
        P("Tack för att du utredde fallet. Hur många ledtrådar behövde du?", "elite"),
    ]
    return bygg(ut / "Losning.pdf", None, "Lösning", story, omslag=True)


# --- Svarskontroll ---------------------------------------------------------

def dok_svarskontroll(ut):
    bredd = PAGE_W - 2 * MARG
    story = [
        P("SVARSKONTROLL", "etikett"),
        P("Kontrollera ditt svar", "h1"),
        P("Leta upp koden för personen du valt och läs <b>bara</b> den raden. Är personen rätt gör du likadant med koden för motivet. Koderna står i nummerordning, så att du inte råkar se de andra svaren."),
        luft(3),
    ]
    rader = [[f"<b>{kod}</b>", fraga, text] for kod, (fraga, text) in sorted(SVAR.items())]
    story.append(tabell(["Kod", "Fråga", "Svar"], rader, [16 * mm, 16 * mm, bredd - 32 * mm]))
    story += [
        PageBreak(),
        P("LEDTRÅDAR", "etikett"),
        P("Om du fastnar", "h1"),
        P("Ta en ledtråd i taget och läs inte längre än du behöver."),
        luft(2),
    ]
    ledtradar = {
        "Vem är skyldig?": [
            "Börja med var Henrik dog. Enligt Jonas och Sofia var han ute i regnet 23.40. När började det regna (B04), och hur såg hällen under honom ut (B01, B02)? Vad hittade rättsläkaren i såret (B03), och var på ön finns det materialet (B07, B11, B13)?",
            "Om Henrik redan var död 23.40, vem gick då i hans regnrock förbi Sofias fönster? Vad lade hon märke till vid grinden (B10)? Jämför rosenbågens fria höjd (B05) med längderna i B06 och kontrollera vem som faktiskt var på ön (B15).",
            "Granska Jonas förhör (B09). Åt vilket håll vetter fönstren i personalhuset (B05)? Vem ringde Henrik kl. 22.46 (B06, B14)? Vilken storlek har stövlarna med våt bottenfärg (B01, B18)?",
        ],
        "Varför?": [
            "Vad skrev Henrik till Maria kl. 21.40 (B14), och vad bar han med sig till båthuset (B10)?",
            "Vad brändes i båthusets kamin (B18)? Vem attesterade köksfakturorna (B07, B19)?",
            "Jämför kontonumret på fakturorna (B19) med lönespecifikationen (B20).",
        ],
    }
    for rubrik, lista in ledtradar.items():
        story.append(P(rubrik, "h2"))
        for i, l in enumerate(lista, 1):
            story.append(P(f"<b>Ledtråd {i}.</b>&nbsp;&nbsp;{l}"))
    return bygg(ut / "Svarskontroll.pdf", None, "Svarskontroll", story)


# --------------------------------------------------------------------------

GRUNDAKT = [dok_b01, dok_b02, dok_b03, dok_b04, dok_b05, dok_b06, dok_b07, dok_b08, dok_b09,
            dok_b10, dok_b11, dok_b12, dok_b13, dok_b14, dok_b15, dok_b16, dok_b17,
            dok_b18, dok_b19, dok_b20]


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
    filer += [f(ut / "Akt") for f in GRUNDAKT]
    filer += [dok_svarskontroll(ut), dok_losning(ut)]

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

    for f in filer:
        print(os.path.relpath(f, Path.cwd()))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Estrae il testo delle carte da PDF stampabili (griglia di carte, una per cella).

Uso:  python3 scripts/pdf-cards.py file1.pdf file2.pdf ... > carte.json
Serve `pdftotext` (poppler-utils). Le carte si separano per colonna e per salto
verticale fra le righe di testo, quindi regge anche celle di altezza diversa.
"""
import html
import json
import re
import subprocess
import sys
import unicodedata

COLUMN_WIDTH = 198.4  # A4 a tre colonne
CARD_GAP = 40  # salto verticale (pt) che separa due carte nella stessa colonna

# Glifi sbagliati tipici di questi PDF.
FIXES = [
    (re.compile(r'`e'), 'è'),
    (re.compile(r"I’occhioIino"), 'l’occhiolino'),
]


def cards_in(path):
    xml = subprocess.run(['pdftotext', '-bbox', path, '-'], capture_output=True, text=True, check=True).stdout
    for page in xml.split('<page ')[1:]:
        columns = {}
        for m in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>(.*?)</word>', page):
            x, y, word = float(m.group(1)), float(m.group(2)), html.unescape(m.group(3))
            columns.setdefault(int(x // COLUMN_WIDTH), []).append((y, x, word))
        cells = []
        for col, words in columns.items():
            words.sort()
            card, last = [], None
            for y, x, w in words:
                if last is not None and y - last > CARD_GAP:
                    cells.append((card[0][0], col, card))
                    card = []
                card.append((y, x, w))
                last = y
            if card:
                cells.append((card[0][0], col, card))
        cells.sort(key=lambda c: (round(c[0] / 50), c[1]))
        for _, _, card in cells:
            text = unicodedata.normalize('NFC', ' '.join(w for _, _, w in card))
            text = re.sub(r'\s+', ' ', text).strip()
            for pattern, repl in FIXES:
                text = pattern.sub(repl, text)
            yield text


if __name__ == '__main__':
    out = []
    for path in sys.argv[1:]:
        out.extend({'source': path.rsplit('/', 1)[-1], 'text': t} for t in cards_in(path))
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)

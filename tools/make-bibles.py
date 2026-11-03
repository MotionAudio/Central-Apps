#!/usr/bin/env python3
"""Central Control - builds the offline Bibles for Slides -> Scripture (central-usage/app/bible/<id>.json.gz).

Only public-domain translations:
  kjv     King James Version (1769)          scrollmapper/bible_databases (formats/json/KJV.json)
  asv     American Standard Version (1901)   scrollmapper/bible_databases (formats/json/ASV.json)
  rv1909  Reina-Valera (1909), Spanish       scrollmapper/bible_databases (formats/json/SpaRV.json)
  web     World English Bible                ebible.org, via the npm package world-english-bible (json/<book>.json)

    python3 tools/make-bibles.py <folder with KJV.json ASV.json SpaRV.json and web/package/json/> [out folder]

Output, one file per translation: <id>.js, a script that hands app/scripture.js the gzipped JSON as base64
(a script works from the app's files, the center's /cu/ pages and the tests alike; fetch() can't read file:// pages):
  CUBibleData("<id>", "<base64 of gzip(JSON)>")
  JSON: {"id", "name", "short", "lang", "license", "source", "books": [[["verse 1", "verse 2", ...], ...chapters], ...66 books]}
plus index.json (the list).
Books are in the usual Protestant order (Genesis..Revelation); a missing verse is an empty string.
Copyrighted translations (NIV, ESV, NLT...) are never bundled: app/scripture.js has a hook for a licensed service."""
import base64
import gzip
import json
import os
import re
import sys

BOOKS = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
         "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
         "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah",
         "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians",
         "Ephesians", "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews",
         "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"]
META = {
    "kjv": ("King James Version", "KJV", "en", "KJV.json", "scrollmapper/bible_databases (KJV, 1769 text)"),
    "web": ("World English Bible", "WEB", "en", None, "ebible.org/web (npm: world-english-bible)"),
    "asv": ("American Standard Version", "ASV", "en", "ASV.json", "scrollmapper/bible_databases (ASV, 1901)"),
    "rv1909": ("Reina-Valera 1909", "RV1909", "es", "SpaRV.json", "scrollmapper/bible_databases (SpaRV, Reina-Valera 1909)"),
}


def clean(t):
    t = re.sub(r"<[^>]+>", "", t or "")              # any markup
    t = re.sub(r"\{([^}]*)\}", r"\1", t)              # {italic} words in some KJV editions
    t = t.replace("¶", "").replace(" ", " ")
    return re.sub(r"\s+", " ", t).strip()


def from_scrollmapper(path):
    d = json.load(open(path, encoding="utf-8"))
    books = d["books"] if isinstance(d, dict) else d
    assert len(books) >= 66, path
    out = []
    for b in books[:66]:
        chs = []
        for ch in b["chapters"]:
            vs = {int(v["verse"]): clean(v["text"]) for v in ch["verses"]}
            n = max(vs) if vs else 0
            chs.append([vs.get(i, "") for i in range(1, n + 1)])
        out.append(chs)
    return out


def from_web(folder):
    out = []
    for name in BOOKS:
        f = os.path.join(folder, name.lower().replace(" ", "") + ".json")
        items = json.load(open(f, encoding="utf-8"))
        chs = {}
        for it in items:
            if "chapterNumber" not in it or "verseNumber" not in it or "value" not in it:
                continue
            c, v = int(it["chapterNumber"]), int(it["verseNumber"])
            chs.setdefault(c, {}).setdefault(v, []).append(it["value"])
        book = []
        for c in range(1, max(chs) + 1):
            vs = chs.get(c, {})
            n = max(vs) if vs else 0
            book.append([clean(" ".join(vs.get(i, []))) for i in range(1, n + 1)])
        out.append(book)
    return out


def main(argv):
    src = argv[1]
    out = argv[2] if len(argv) > 2 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "central-usage", "app", "bible")
    os.makedirs(out, exist_ok=True)
    index = []
    for tid, (name, short, lang, file, source) in META.items():
        books = from_web(os.path.join(src, "web", "package", "json")) if tid == "web" else from_scrollmapper(os.path.join(src, file))
        doc = {"id": tid, "name": name, "short": short, "lang": lang, "license": "Public domain", "source": source, "books": books}
        data = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        p = os.path.join(out, tid + ".js")
        with open(p, "w") as f:
            f.write("/* " + name + " (" + short + "), public domain - built by tools/make-bibles.py from " + source + " */\n")
            f.write('CUBibleData("' + tid + '","' + base64.b64encode(gzip.compress(data, 9, mtime=0)).decode("ascii") + '");\n')
        verses = sum(len(c) for b in books for c in b)
        index.append({"id": tid, "name": name, "short": short, "lang": lang, "license": "Public domain", "source": source, "file": tid + ".js", "verses": verses})
        print("%-7s %-28s %6d verses  %5.2f MB" % (tid, name, verses, os.path.getsize(p) / 1e6))
    with open(os.path.join(out, "index.json"), "w") as f:
        json.dump({"translations": index}, f, indent=1)


if __name__ == "__main__":
    main(sys.argv)

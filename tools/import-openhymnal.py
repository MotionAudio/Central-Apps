#!/usr/bin/env python3
"""Central Tracks (10.3): adds hymns to hymns/hymns.json from the Open Hymnal Project's four-part scores
(github.com/mzealey/openhymnal, a copy of openhymnal.org), at a pinned commit.

Each hymn here was checked by hand before it was listed: the score says "copyright: public domain", and its words and
tune were both published before 1929 (the score's own sources are named below - only hymns whose words were taken
from a hymnal printed before 1929 are used, so no later re-wording comes along), and every writer died before 1955.

From each score: the key, the meter, the melody's bars, each verse's words on them (syllable by syllable, as the score
aligns them), the refrain, and the chords - worked out from the hymnal's own four voices (tools/abc_hymn.py). The form
is a modern worship one (see tools/worship_band.py); the band's flavour and the tempo are chosen here.

    python3 tools/import-openhymnal.py [--cache DIR] [--only ID]      (writes hymns/hymns.json; prints counts only)"""
import json
import os
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import abc_hymn as A  # noqa: E402

REPO, COMMIT = "mzealey/openhymnal", "d35811b2d5c9b0bbc5887d60a2936454815416e8"
# id -> (score, title, words, music, published (words, music), writers died (latest), BPM, flavour, season)
HYMNS = {
    "crown-him": ("Complete/Crown_Him_With_Many_Crowns/Crown_Him_With_Many_Crowns-Diademata.abc", "Crown Him with Many Crowns",
                  "Matthew Bridges (1851), Godfrey Thring (1874)", "DIADEMATA, George J. Elvey (1868)", (1874, 1868), 1903, 92, "anthem-ride", None),
    "what-a-friend": ("Complete/What_A_Friend_We_Have_In_Jesus/What_A_Friend_We_Have_In_Jesus-untitled.abc", "What a Friend We Have in Jesus",
                      "Joseph M. Scriven (1855)", "Charles C. Converse (1868)", (1855, 1868), 1918, 74, "piano-ballad", None),
    "to-god-be-the-glory": ("Complete/To_God_Be_the_Glory/To_God_Be_the_Glory-To_God_Be_the_Glory.abc", "To God Be the Glory",
                            "Fanny J. Crosby (1875)", "William H. Doane (1875)", (1875, 1875), 1915, 104, "gospel-68-up", None),
    "a-mighty-fortress": ("Complete/A_Mighty_Fortress_Is_Our_God/A_Mighty_Fortress_Is_Our_God-Ein_Feste_Burg_Isorhythmic.abc", "A Mighty Fortress Is Our God",
                          "Martin Luther (1529), translated by Frederic H. Hedge (1853)", "EIN FESTE BURG, Martin Luther (1529)", (1853, 1529), 1890, 84, "fortress", None),
    "abide-with-me": ("Complete/Abide_With_Me/Abide_With_Me-Eventide.abc", "Abide with Me",
                      "Henry F. Lyte (1847)", "EVENTIDE, William H. Monk (1861)", (1847, 1861), 1889, 66, "hall-ballad", None),
    "rock-of-ages": ("Complete/Rock_of_Ages/Rock_of_Ages-Toplady.abc", "Rock of Ages",
                     "Augustus M. Toplady (1776)", "TOPLADY, Thomas Hastings (1830)", (1776, 1830), 1872, 72, "soft-pulse", None),
    "o-come-all-ye-faithful": ("Complete/O_Come_All_Ye_Faithful/O_Come_All_Ye_Faithful-Adeste_Fideles-Portugese_Hymn.abc", "O Come, All Ye Faithful",
                               "John F. Wade (c. 1743), translated by Frederick Oakeley (1841) and William T. Brooke", "ADESTE FIDELES, John F. Wade (c. 1743)",
                               (1841, 1751), 1917, 88, "christmas-anthem", "christmas"),
    "it-came-upon": ("Complete/It_Came_Upon_A_Midnight_Clear/It_Came_Upon_A_Midnight_Clear-Carol.abc", "It Came Upon the Midnight Clear",
                     "Edmund H. Sears (1849)", "CAROL, Richard S. Willis (1850)", (1849, 1850), 1900, 80, "christmas-68", "christmas"),
    "first-noel": ("Complete/The_First_Noel/The_First_Noel-The_First_Noel.abc", "The First Noel",
                   "traditional English carol", "THE FIRST NOEL, traditional English carol (setting 1911)", (1823, 1833), 1901, 96, "christmas-waltz", "christmas"),
    "away-in-a-manger": ("Complete/Away_In_A_Manger/Away_In_A_Manger-Mueller.abc", "Away in a Manger",
                         "anonymous (1885); stanza 3 John T. McFarland", "MUELLER, James R. Murray (1887)", (1885, 1887), 1913, 84, "lullaby", "christmas"),
    "jesus-christ-is-risen": ("Complete/Jesus_Christ_Is_Risen_Today/Jesus_Christ_Is_Risen_Today-Easter_Hymn.abc", "Jesus Christ Is Risen Today",
                              "14th-century Latin carol, translated in Lyra Davidica (1708) and The Compleat Psalmist (1749); stanza 4 Charles Wesley (1740)",
                              "EASTER HYMN, Lyra Davidica (1708)", (1749, 1708), 1788, 100, "easter-anthem", "easter"),
}


def fetch(path, cache):
    local = os.path.join(cache, path.replace("/", "_"))
    if not os.path.isfile(local):
        os.makedirs(cache, exist_ok=True)
        url = "https://raw.githubusercontent.com/%s/%s/%s" % (REPO, COMMIT, urllib.parse.quote(path))
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
        with open(local, "wb") as f:
            f.write(data)
    with open(local, encoding="latin-1") as f:
        return f.read()


def section(name, chords, role, lyrics=None):
    s = {"name": name, "chords": chords, "role": role}
    if lyrics:
        s["lyrics"] = lyrics
    s["energy"] = {"intro": 0, "verse": 0, "verse2": 1, "pre": 1, "chorus": 2, "interlude": 2, "drop": 1, "bridge": 2, "final": 3, "tag": 1, "outro": 0}[role]
    return s


def form(nv, refrain, tag_range, tag_refrain):
    """A modern worship form for nv verses (and a refrain): sparse first verse, all in, a drop, a bridge that builds,
    the biggest last verse (or refrains), a tag on the last line."""
    I, O, B = section("Intro", "intro", "intro"), section("Outro", "outro", "outro"), section("Bridge", "intro*2", "bridge")
    V = lambda k, role: section("Verse %d" % k, "verse", role, "Verse %d" % k)
    R = lambda k, role: section("Refrain %d" % k, "refrain", role, "Refrain")
    tag = section("Tag", ("refrain:%d-%d" if tag_refrain else "verse:%d-%d") % tag_range, "tag", ("Refrain@%d-%d" if tag_refrain else "Verse %d@%%d-%%d" % nv) % tag_range)
    f = [I]
    if refrain:
        f += [V(1, "verse"), R(1, "pre")]
        if nv >= 2:
            f += [V(2, "verse2"), R(2, "chorus"), section("Interlude", "intro", "interlude")]
        if nv >= 4:
            f += [V(nv - 1, "drop"), B, V(nv, "final"), R(nv, "final")]
        elif nv == 3:
            f += [V(3, "drop"), B, R(3, "final"), R(4, "final")]
        else:
            f += [B, R(3, "final")]
    else:
        f += [V(1, "verse"), V(2, "chorus"), section("Interlude", "intro", "interlude")]
        if nv >= 4:
            f += [V(3, "drop"), B, V(nv, "final")]
        else:
            f += [B, V(nv, "final")]
    f += [tag, O]
    return f


def build(hid, cache, log):
    path, title, words, music, (pw, pm), died, bpm, style, season = HYMNS[hid]
    h = A.AbcHymn(fetch(path, cache))
    h.harmonize()
    secs = h.sections()
    verse = [s for s in secs if s["kind"] == "verse"]
    refrain = [s for s in secs if s["kind"] == "refrain"]
    if not verse:
        raise SystemExit("%s: no verses found" % hid)
    vs = verse[0]
    if len(verse) > 1:              # (verse systems split by a refrain in the middle: keep the first block as the verse)
        log("    %s: %d verse blocks, the first is the verse" % (hid, len(verse)))
    chords = lambda s: [h.chords(b) or "C" for b in range(s["bar0"], s["bar1"])]
    entry = {"id": hid, "title": title, "words": words, "music": music,
             "public_domain": {"words": pw, "music": pm, "writers_died": died},
             "key": h.key, "bpm": bpm, "meter": int(h.meter) if h.meter == int(h.meter) else float(h.meter), "style": style,
             "source": {"repository": "github.com/" + REPO, "commit": COMMIT, "score": path, "copyright": "public domain (score: \"copyright: public domain\"; words and tune published before 1929)"},
             "chords": {}, "lyrics": {}, "form": []}
    if season:
        entry["season"] = season
    vchords = chords(vs)
    entry["chords"]["verse"] = vchords
    nv = h.nverses
    for k in range(nv):
        pick, bars = h.verse_texts(vs, k)
        entry["lyrics"]["Verse %d" % (k + 1)] = pick + "|" + "|".join(bars)
    if refrain:
        rs = refrain[0]
        entry["chords"]["refrain"] = chords(rs)
        pick, bars = h.verse_texts(rs, 0)
        entry["lyrics"]["Refrain"] = pick + "|" + "|".join(bars)
    # the intro, interlude and outro: the last line of the song (four bars or so)
    last = entry["chords"].get("refrain") or vchords
    n = min(len(last), 4 if len(last) >= 8 else len(last))
    entry["chords"]["intro"] = last[-n:]
    entry["chords"]["outro"] = last[-n:]
    tail = refrain[0] if refrain else vs
    tlen = tail["bar1"] - tail["bar0"]
    tn = min(tlen, 4 if h.meter >= 4 else 6)
    entry["form"] = form(nv, bool(refrain), (tlen - tn + 1, tlen), bool(refrain))
    log("  %-24s key %-3s %s/%s  %2d verses%s  verse %d bars%s  misfit %d" % (hid, h.key, h.meter_sig[0], h.meter_sig[1], nv, " + refrain" if refrain else "",
        len(vchords), (", refrain %d bars" % len(entry["chords"]["refrain"])) if refrain else "", h.misfit))
    return entry


def main(argv):
    cache = os.path.join(os.path.expanduser("~"), ".cache", "openhymnal")
    only = None
    i = 0
    while i < len(argv):
        if argv[i] == "--cache":
            cache = argv[i + 1]
            i += 2
        elif argv[i] == "--only":
            only = argv[i + 1]
            i += 2
        else:
            print(__doc__)
            return 2
    path = os.path.join(ROOT, "hymns", "hymns.json")
    data = json.load(open(path))
    have = {h["id"]: k for k, h in enumerate(data["hymns"])}
    for hid in HYMNS:
        if only and hid != only:
            continue
        e = build(hid, cache, print)
        if hid in have:
            data["hymns"][have[hid]] = e
        else:
            data["hymns"].append(e)
    write(path, data)
    return 0


def write(path, data):
    j = lambda x: json.dumps(x, ensure_ascii=False)
    out = ["{", ' "_about": %s,' % j(data["_about"]), ' "hymns": [']
    for hi, h in enumerate(data["hymns"]):
        lines = ["  {"]
        for k in ("id", "title", "words", "music"):
            lines.append('   "%s": %s,' % (k, j(h[k])))
        lines.append('   "public_domain": %s,' % j(h["public_domain"]))
        lines.append('   "key": %s, "bpm": %s, "meter": %s, "style": %s,%s' % (j(h["key"]), j(h["bpm"]), j(h["meter"]), j(h.get("style")), (' "season": %s,' % j(h["season"])) if h.get("season") else ""))
        if h.get("source"):
            lines.append('   "source": %s,' % j(h["source"]))
        lines.append('   "chords": {')
        ch = list(h["chords"].items())
        for i, (k, v) in enumerate(ch):
            lines.append('    %s: %s%s' % (j(k), j(v), "," if i < len(ch) - 1 else ""))
        lines.append("   },")
        lines.append('   "lyrics": {')
        ly = list(h["lyrics"].items())
        for i, (k, v) in enumerate(ly):
            lines.append('    %s: %s%s' % (j(k), j(v), "," if i < len(ly) - 1 else ""))
        lines.append("   },")
        lines.append('   "form": [')
        for i, f in enumerate(h["form"]):
            lines.append("    %s%s" % (j(f), "," if i < len(h["form"]) - 1 else ""))
        lines.append("   ]")
        lines.append("  }" + ("," if hi < len(data["hymns"]) - 1 else ""))
        out += lines
    out += [" ]", "}"]
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

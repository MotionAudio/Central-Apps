#!/usr/bin/python3
"""Look parts up in JLCPCB's assembly parts library (stock, price, basic/extended, LCSC number).
usage: jlc.py KEYWORD [KEYWORD...]      or import and call lookup(keyword)"""
import json
import sys
import urllib.request

URL = "https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList"


def lookup(keyword, n=5, stock_only=True):
    body = json.dumps({"currentPage": 1, "pageSize": n, "keyword": keyword, "searchSource": "search",
                       "componentLibraryType": "", "stockFlag": stock_only}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    out = []
    for c in (d["data"]["componentPageInfo"]["list"] or []):
        price = c["componentPrices"][0]["productPrice"] if c["componentPrices"] else None
        out.append({"lcsc": c["componentCode"], "mpn": c["componentModelEn"], "mfr": c.get("componentBrandEn"),
                    "stock": c["stockCount"], "type": c["componentLibraryType"], "price": price,
                    "pkg": c.get("componentSpecificationEn"), "desc": (c.get("describe") or "")[:90]})
    return out


if __name__ == "__main__":
    for kw in sys.argv[1:]:
        print("==", kw)
        for r in lookup(kw):
            print("  %-10s %-28s %-18s stock %-7s %-8s $%-7s %s | %s" % (r["lcsc"], r["mpn"][:28], (r["mfr"] or "")[:18], r["stock"], r["type"], r["price"], r["pkg"], r["desc"]))

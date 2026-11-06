#!/usr/bin/env python3
"""Builds the website's product pages (10.3) into server/public from tools/site_content.py:

  /apps/ (the six apps and which ones a church needs), /apps/<app>/ (every feature, who it's for, where it runs, buy),
  /sounds/ and /sounds/<plan>/ (the best of each plan with 30-second previews), /pricing/ (the store, "which plan do
  I need", the FAQ), /help/ (the Help Center), /help/article.html, /help/ticket.html and /status/.

It also puts the shared header (Apps, Sounds, Pricing, Central Tracks, Make & sell, Downloads, Help, Account, Cart)
and footer on the site's other pages (the home page, the manuals, the install and accounts guides, the policies).

  python3 tools/make-site.py            (writes the pages; run it after changing site_content.py)
  python3 tools/make-site.py --check    (fails if a page is out of date: CI)
"""
import html, json, os, re, struct, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, "server", "public")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_content as C  # noqa: E402

E = lambda s: html.escape(str(s), quote=True)
SHOTS = {s["id"]: s for s in json.load(open(os.path.join(PUB, "img", "apps", "shots.json")))}
SHOTS.setdefault("production", {"id": "production", "app": "Central Production", "file": "img/apps/production.webp",
                                "alt": "Central Production: a project with tracks, the mixer and the plugin builder.",
                                "caption": "Central Production: record, edit, mix and make your own plugins."})
PLAN_SLUG = {p["id"]: p for p in C.PLANS}
OUT = {}   # path -> text


def img_size(rel):
    """the width and height of a .webp or .png (so the page doesn't jump while pictures load)"""
    try:
        b = open(os.path.join(PUB, rel.lstrip("/")), "rb").read(64)
    except OSError:
        return None
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        if b[12:16] == b"VP8X": return 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
        if b[12:16] == b"VP8 ": w, h = struct.unpack("<HH", b[26:30]); return w & 0x3FFF, h & 0x3FFF
        if b[12:16] == b"VP8L": v = int.from_bytes(b[21:25], "little"); return (v & 0x3FFF) + 1, ((v >> 14) & 0x3FFF) + 1
    if b[:8] == b"\x89PNG\r\n\x1a\n": return struct.unpack(">II", b[16:24])
    return None


def shot_img(sid, cls="", lazy=True, priority=False):
    s = SHOTS.get(sid)
    if not s: return ""
    wh = img_size(s["file"])
    dims = f' width="{wh[0]}" height="{wh[1]}"' if wh else ""
    return f'<img{(" class=" + chr(34) + cls + chr(34)) if cls else ""} src="/{E(s["file"])}" alt="{E(s["alt"])}"{dims}{" loading=" + chr(34) + "lazy" + chr(34) if lazy and not priority else ""}{" fetchpriority=" + chr(34) + "high" + chr(34) if priority else ""} decoding="async">'


LOGO_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M6,80 C24,80 22.2,20 36,20 C49.8,20 48,80 66,80"/><path d="M34,80 C52,80 50.2,20 64,20 C77.8,20 76,80 94,80"/></g></svg>'


def app_href(a): return "/apps/" + a["slug"] + "/"


def header():
    apps = "".join(f'<a href="{app_href(a)}"><img src="/brand/{a["icon"]}.svg" alt=""><b>{E(a["name"])}</b><span>{E(a["tag"])}</span></a>' for a in C.APPS)
    plans = "".join(f'<a href="/sounds/{p["id"]}/"><span class="sw" aria-hidden="true">{E(p["name"].split()[-1][:2])}</span><b>{E(p["name"])}</b><span>{E(p["tag"])}</span></a>' for p in C.PLANS)
    plans += f'<a href="/sounds/tracks/"><span class="sw" aria-hidden="true">Tr</span><b>{E(C.TRACKS["name"])}</b><span>{E(C.TRACKS["tag"])}</span></a>'
    return f'''<header class="top"><div class="wrap">
  <a class="logo" href="/" style="color:var(--ink)"><span style="color:var(--brass)">{LOGO_SVG}</span>Motion Audio</a>
  <nav id="siteNav" aria-label="Main">
    <span class="nav-main" id="navMain">
      <div class="dd"><button class="dd-btn" type="button" aria-expanded="false" aria-controls="ddApps">Apps</button><div class="dd-panel" id="ddApps">{apps}<a class="dd-all" href="/apps/">Compare the apps: which ones do we need?</a></div></div>
      <div class="dd"><button class="dd-btn" type="button" aria-expanded="false" aria-controls="ddSounds">Sounds</button><div class="dd-panel" id="ddSounds">{plans}<a class="dd-all" href="/sounds/">All sounds and packs</a></div></div>
      <a href="/pricing/" data-edit="nav.store">Pricing</a><a href="/#tracks" data-edit="nav.tracks">Central Tracks</a><a href="/create/" data-edit="nav.create">Make &amp; sell</a><a href="/#downloads" data-edit="nav.downloads">Downloads</a><a href="/help/" data-edit="nav.help">Help</a>
    </span>
    <span class="nav-end">
    <a href="/#account" id="acctLink">Sign in</a>
    <span class="acct-menu" id="acctMenu" hidden><button class="acct-icon" id="acctIcon" type="button" aria-label="Your account" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.6-4 4.6-6 8-6s6.4 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <div class="acct-drop" id="acctDrop" role="menu" hidden><div class="acct-who" id="acctWho"></div><a href="/#account" role="menuitem">Account</a><a href="/#account-products" role="menuitem">My products</a><a href="/#purchases" role="menuitem">Purchases</a><a href="/#downloads" role="menuitem">Downloads</a><a href="/#account-help" role="menuitem">Help &amp; tickets</a><a href="/services/" role="menuitem">Central Services</a><a href="/production/" role="menuitem">Central Production</a><button type="button" role="menuitem" id="acctOut">Sign out</button></div></span>
    <button class="btn ghost small cartbtn" id="cartBtn" type="button" aria-label="Cart">Cart <span class="count">0</span></button>
    <button class="nav-toggle" id="navToggle" type="button" aria-expanded="false" aria-controls="navMain"><i aria-hidden="true"></i>Menu</button>
    </span>
  </nav>
</div></header>
<div class="salebar" id="saleBar" hidden></div>'''


def footer():
    col = lambda title, links: f'<div><h4>{E(title)}</h4><ul>' + "".join(f'<li><a href="{h}">{E(t)}</a></li>' for t, h in links) + "</ul></div>"
    return f'''<footer class="on-stage site-foot"><div class="wrap">
  <div class="about"><a class="logo" href="/"><span style="color:var(--brass-hi)">{LOGO_SVG}</span>Motion Audio</a>
    <p class="apps" data-edit="footer.about">I make Central for church worship and production teams. If you've got a question or something isn't working, email us and we'll write back.</p>
    <a class="mail" href="mailto:{E(C.SUPPORT_EMAIL)}">{E(C.SUPPORT_EMAIL)}</a></div>
  {col("Apps", [(a["name"], app_href(a)) for a in C.APPS] + [("Compare the apps", "/apps/")])}
  {col("Sounds", [(p["name"], "/sounds/" + p["id"] + "/") for p in C.PLANS] + [(C.TRACKS["name"], "/sounds/tracks/")])}
  {col("Buy", [("Pricing", "/pricing/"), ("Church packs", "/pricing/#packsTop"), ("Sound plans", "/pricing/#plans"), ("Central Tracks", "/#tracks"), ("Make & sell", "/create/"), ("Downloads", "/#downloads"), ("My products", "/#account-products")])}
  {col("Help", [("Help Center", "/help/"), ("Contact support", "/help/#contact"), ("Install the apps", "/help/install.html"), ("How accounts work", "/help/accounts.html"), ("Status", "/status/"), ("Privacy", "/privacy"), ("Terms", "/terms"), ("Refunds", "/refunds")])}
  <div class="fine" data-edit="footer.fine">&copy; 2026 Motion Audio. Prices in US dollars, tax included.</div>
</div></footer>'''


SCRIPTS_SHOP = ["/edit.js", "/previews.js", "/app.js", "/site-nav.js"]


def page(path, page_id, title, desc, body, og=None, scripts=(), jsonld=None, noindex=False):
    og = og or page_id
    sc = "".join(f'<script src="{s}"></script>' for s in list(SCRIPTS_SHOP) + list(scripts))
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, separators=(",", ":"))}</script>' if jsonld else ""
    OUT[path] = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<meta name="theme-color" content="#FFFFFF">{'<meta name="robots" content="noindex">' if noindex else ""}
<link rel="canonical" href="%PUBLIC_URL%{E(path_url(path))}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Motion Audio"><meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:image" content="%PUBLIC_URL%/img/og/{E(og)}.jpg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="%PUBLIC_URL%{E(path_url(path))}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/archivo-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/central-tokens.css">
<link rel="stylesheet" href="/site.css">
<link rel="stylesheet" href="/site-pages.css">
<script src="https://js.stripe.com/dahlia/stripe.js" async></script>{ld}
</head>
<body data-page="{E(page_id)}">
<a class="skip" href="#main">Skip to the page</a>
{header()}
<main id="main">
{body}
</main>
{footer()}
<div id="modalHost"></div>
{sc}
</body>
</html>
'''
    OG_PAGES.append({"id": og, "title": title.split(" | ")[0], "kicker": desc, "shot": OG_SHOT.get(og, "")})


OG_PAGES, OG_SHOT = [], {}


def path_url(p): return "/" + p.replace("index.html", "") if p.endswith("index.html") else "/" + p.replace(".html", ".html")


def buy_button(a, cls="btn brass"):
    b = a["buy"]
    if b.get("free"): return f'<a class="{cls}" href="{E(b["href"])}">{E(b["label"])}</a>'
    return f'<button class="{cls}" type="button" data-add="{E(b["add"])}">{E(b["label"])}</button>'


def price_of(pid, per=""):
    return f'<span class="price"><span data-price-of="{E(pid)}">&nbsp;</span>{("<small>" + E(per) + "</small>") if per else ""}</span>'


PER = {"pedal": "one-time", "pedal-control": "per key, yours for good", "admin": "per computer", "user": "per musician", "services-slot": "per person, once"}


# ------------------------------------------------------------------------------------------------------------- apps
def app_page(a):
    who = "".join(f'<span class="chip who">{E(w)}</span>' for w in a["who"])
    plats = "".join(f'<span class="chip">{E(C.PLATFORMS[p])}</span>' for p in a["platforms"])
    groups = "".join(f'''<div class="fgroup" id="{E(slug(g[0]))}"><h3>{E(g[0])}</h3><ul class="feats">{"".join(f"<li><b>{E(t)}</b><span>{E(d)}</span></li>" for t, d in g[1])}</ul></div>''' for g in a["groups"])
    gallery = "".join(f'<figure>{shot_img(s)}<figcaption>{E(SHOTS[s]["caption"])}</figcaption></figure>' for s in a["shots"] if s in SHOTS)
    toc = "".join(f'<a href="#{E(slug(g[0]))}">{E(g[0])}</a>' for g in a["groups"])
    b = a["buy"]
    priced = not b.get("free")
    dl = "/production/" if a["slug"] == "production" else ("/apps/pedal/#buy" if a["slug"] == "pedal" else "/#downloads")
    dl_text = {"pedal": "It comes with its software already on it, and it updates itself.", "production": "Use it in your browser, or download it for Mac, Windows or Linux."}.get(a["slug"], "Free to download for " + ", ".join(C.PLATFORMS[p] for p in a["platforms"]) + ". The first time it opens, it asks for your key.")
    others = [x for x in C.APPS if x["slug"] != a["slug"]][:5]
    body = f'''<section class="page-hero on-stage"><div class="wrap hero2">
  <div>
    <div class="crumbs"><a href="/apps/">Apps</a><span aria-hidden="true">/</span><span>{E(a["name"])}</span></div>
    <div class="app-id" style="margin-top:1rem"><img src="/brand/{a["icon"]}.svg" alt=""><span class="label">{E(a["name"])}</span></div>
    <h1 data-edit="app.{a["slug"]}.title">{E(a["tag"])}</h1>
    <p class="lede" data-edit="app.{a["slug"]}.lede">{E(a["lede"])}</p>
    <div class="chips" aria-label="Who it's for">{who}</div>
    <div class="ctas">{"<span class=buybar>" + price_of(b["add"], PER.get(b["add"], "")) + "</span>" if priced else ""}{buy_button(a)}<a class="btn ghost" href="#features">What it does</a></div>
    <p class="muted" style="margin-top:.8rem;font-size:.9rem">{E(b["note"])}</p>
  </div>
  <figure>{shot_img(a["shot"], lazy=False, priority=True)}</figure>
</div></section>
<section class="pg" id="features"><div class="wrap">
  <div class="pg-head"><h2>What {E(a["name"])} does</h2><div class="toc" style="margin-top:0">{toc}</div></div>
  <div class="feat-groups">{groups}</div>
</div></section>
{('<section class="pg band"><div class="wrap"><div class="pg-head"><h2>Screenshots</h2><p>These are from the real app, not mock-ups.</p></div><div class="gallery" tabindex="0" aria-label="Screenshots">' + gallery + '</div></div></section>') if len(a["shots"]) > 1 else ""}
<section class="pg" id="buy"><div class="wrap">
  <div class="facts">
    <div class="fact"><h3>Who it's for</h3><div class="chips" style="margin:0">{"".join(f'<span class="chip">{E(w)}</span>' for w in a["who"])}</div><p class="muted">{E(WHO_LINE.get(a["slug"], ""))}</p></div>
    <div class="fact"><h3>Where it runs</h3><div class="chips" style="margin:0">{plats}</div><p class="muted">{E(dl_text)}</p><a class="btn ghost small" href="{dl}">{"Open it" if a["slug"] == "production" else "Downloads"}</a></div>
    <div class="fact"><h3>{"Get it" if priced else "It's free"}</h3>{("<div class=buybar>" + price_of(b["add"], PER.get(b["add"], "")) + "</div>") if priced else ""}<p class="muted">{E(b["note"])}</p><div style="display:flex;gap:.5rem;flex-wrap:wrap">{buy_button(a, "btn")}{'<a class="btn ghost" href="/pricing/#packsTop">Church packs</a>' if a["slug"] in ("control", "usage", "pedal-control", "services") else ""}</div></div>
  </div>
  {f'<p class="muted" style="margin-top:1.4rem">If you want every detail, there\'s a full <a href="{a["manual"]}">{E(a["name"])} manual</a>. Stuck on something? Try the <a href="/help/">Help Center</a>.</p>' if a["manual"] else '<p class="muted" style="margin-top:1.4rem">Stuck on something? Try the <a href="/help/">Help Center</a>.</p>'}
</div></section>
<section class="pg band"><div class="wrap"><div class="pg-head"><h2>The other apps</h2><p>They're separate apps, but on the same Wi-Fi they find each other and share the work.</p></div>
  <div class="app-grid">{"".join(app_card(x) for x in others[:3])}</div><p style="margin-top:1rem"><a href="/apps/">Compare all six apps</a></p></div></section>'''
    OG_SHOT["app-" + a["slug"]] = a["shot"]
    page(f"apps/{a['slug']}/index.html", "app-" + a["slug"], f'{a["name"]}: {a["tag"].lower()} | Motion Audio', a["lede"][:155], body,
         jsonld={"@context": "https://schema.org", "@type": "SoftwareApplication" if a["slug"] != "pedal" else "Product", "name": a["name"], "description": a["lede"],
                 "applicationCategory": "MultimediaApplication", "operatingSystem": ", ".join(C.PLATFORMS[p] for p in a["platforms"]), "brand": {"@type": "Brand", "name": "Motion Audio"}})


WHO_LINE = {
    "pedal": "Whoever plays the pads and tracks. That's usually the worship leader or the keys player.",
    "pedal-control": "Whoever gets the songs ready during the week, at home or at church.",
    "control": "The main admin sets the church up. On Sunday, admins and production volunteers run the desk.",
    "usage": "The musicians and singers, each on their own phone, tablet or computer.",
    "services": "Anyone who serves. Schedulers set up the services, and everyone else answers from their phone.",
    "production": "Anyone who wants to make tracks, pads, sounds or plugins, whether for your own church or to sell.",
}


def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def app_card(a):
    return f'''<a class="app-card" href="{app_href(a)}"><div class="shot">{shot_img(a["shot"])}</div><div class="in"><h3><img src="/brand/{a["icon"]}.svg" alt="">{E(a["name"])}</h3><span class="label">{E(a["tag"])}</span></div><p>{E(a["lede"])}</p><span class="go">See what it does</span></a>'''


def apps_hub():
    mark = lambda m: '<span class="yes" aria-label="Yes">✓</span>' if m == "yes" else '<span class="some">Some</span>' if m == "some" else '<span class="muted" aria-label="No">–</span>' if m == "" else E(m)
    head = "".join(f'<th scope="col"><img src="/brand/{a["icon"]}.svg" alt="">{E(a["name"])}</th>' for a in C.APPS)
    rows = "".join(f'<tr><th scope="row">{E(r[0])}</th>{"".join(f"<td>{mark(m)}</td>" for m in r[1])}</tr>' for r in C.COMPARE)
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><span>Apps</span></div>
  <h1 data-edit="apps.title">The Central apps</h1>
  <p class="lede" data-edit="apps.lede">There are six of them. The pedal plays the music and the desk runs the room. Musicians get their own chart and mix, Central Services keeps track of who's serving, and Central Production is where you make your own sounds. Pick one to see what it does.</p>
  <div class="ctas"><a class="btn brass" href="#compare">Which apps do we need?</a><a class="btn ghost" href="/pricing/">Pricing</a></div>
</div></section>
<section class="pg"><div class="wrap"><div class="app-grid">{"".join(app_card(a) for a in C.APPS)}</div></div></section>
<section class="pg band" id="compare"><div class="wrap">
  <div class="pg-head"><h2>Which apps does a church need?</h2><p>Most churches start with a church pack. It has Central Control for the desk, Central Usage for the musicians, a Central Pedal Control key and Central Services slots. If you want pads and tracks at your feet, add the pedal.</p></div>
  <div class="cmp-wrap" tabindex="0" role="region" aria-label="The apps compared"><table class="cmp"><thead><tr><th scope="col">What it does</th>{head}</tr></thead><tbody>{rows}</tbody></table></div>
  <div class="need" style="margin-top:1.5rem">
    <div><h3>A small team</h3><p class="muted">A worship leader, a few musicians and someone at the desk.</p><ul><li>The Lite church pack</li><li>A Central Pedal for pads and tracks</li><li>Central Keys or Central Pads</li></ul><a class="btn ghost small" href="/pricing/#packsTop">See Lite</a></div>
    <div><h3>A full band and production</h3><p class="muted">A full band and singers, with lights, cameras and a stream to run.</p><ul><li>The Regular church pack</li><li>A Central Pedal</li><li>A church bundle of sound plans with Central Utility</li></ul><a class="btn ghost small" href="/pricing/#packsTop">See Regular</a></div>
    <div><h3>More than one service</h3><p class="muted">Several teams and services, or a production company working for more than one church.</p><ul><li>The Plus or Ultra church pack</li><li>A pedal for each stage</li><li>Central Tracks Unlimited</li></ul><a class="btn ghost small" href="/pricing/#packsTop">See Plus and Ultra</a></div>
  </div>
</div></section>
<section class="pg"><div class="wrap"><div class="pg-head"><h2>Manuals</h2><p>If you like to read the whole thing before you start, the manuals go through each screen.</p></div>
  <div class="hc-cats">{"".join(f'<a class="hc-cat" href="{a["manual"]}" style="text-decoration:none"><h3>{E(a["name"])} manual</h3><span class="muted">{E(a["tag"])}</span></a>' for a in C.APPS if a["manual"])}<a class="hc-cat" href="/help/install.html" style="text-decoration:none"><h3>Install the apps</h3><span class="muted">Computers, phones and tablets</span></a></div></div></section>'''
    OG_SHOT["apps"] = "cc-lights"
    page("apps/index.html", "apps", "The Central apps for worship teams | Motion Audio", "What each of the six Central apps does, who it's for, and which ones a church actually needs.", body)


# ------------------------------------------------------------------------------------------------------------- sounds
def pick_html(plan, k):
    kind, name, preset, desc = k
    label = preset or name
    data = E(json.dumps({"kind": kind, "name": name, "preset": preset}))
    return f'''<div class="item" data-pick="{data}"><button class="btn ghost pvb" type="button" disabled aria-label="Hear {E(label)}">▶</button><h3>{E(label.replace("Plugins: ", ""))}</h3><p>{E(desc)}</p><div class="meta"><span class="chip plan">{E(PLAN_SLUG[plan]["name"])}</span><span class="chip">{E({"pad": "Pad", "loop": "Loop", "loops": "Loops", "preset": "Preset", "sound": "Instrument", "ir": "Cabinet"}.get(kind, kind))}</span></div></div>'''


def plan_page(p):
    pid = p["id"]
    hi = "".join(f"<li>{E(x)}</li>" for x in p["highlights"])
    free = "".join(f'<span class="chip free">{E(x)}</span>' for x in C.FREE.get(pid, []))
    picks = "".join(pick_html(pid, k) for k in C.PICKS.get(pid, []))
    extra = ""
    if pid == "utility":
        bgs = json.load(open(os.path.join(PUB, "img", "utility", "utility.json"))) if os.path.exists(os.path.join(PUB, "img", "utility", "utility.json")) else {"backgrounds": [], "themes": []}
        th = lambda lst: "".join(f'<figure><img src="/img/utility/{E(x["file"])}" alt="{E(x["alt"])}" width="640" height="360" loading="lazy" decoding="async"><figcaption>{E(x["name"])}</figcaption></figure>' for x in lst)
        parts = "".join(f'<div class="fact"><h3>{E(t)}</h3><p class="muted">{E(d)}</p></div>' for t, d in C.UTILITY_PARTS)
        extra = f'''<section class="pg band"><div class="wrap"><div class="pg-head"><h2>Backgrounds for the church year</h2><p>Put them behind lyrics, slides and the stream. The apps draw them as they play, so they stay sharp on any size of screen.</p></div><div class="thumbs" id="utilBgs">{th(bgs["backgrounds"])}</div></div></section>
<section class="pg"><div class="wrap"><div class="pg-head"><h2>Slide themes and lower thirds</h2><p>Each one pairs a season's background with a title, a verse and its reference.</p></div><div class="thumbs" id="utilThemes">{th(bgs["themes"])}</div></div></section>
<section class="pg band"><div class="wrap"><div class="pg-head"><h2>What's in Central Utility</h2></div><div class="facts">{parts}</div></div></section>'''
    best = f'''<section class="pg"><div class="wrap"><div class="pg-head"><h2>Have a listen</h2><p>Each one plays a 30-second preview. Nothing gets downloaded.</p></div>
  <div class="items" data-plan-items="{E(pid)}">{picks}</div>
  <div class="listen-more" data-listall="{E(pid)}"></div></div></section>''' if picks else ""
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><a href="/sounds/">Sounds</a><span aria-hidden="true">/</span><span>{E(p["name"])}</span></div>
  <h1 data-edit="plan.{pid}.title">{E(p["name"])}</h1>
  <p class="lede" data-edit="plan.{pid}.lede">{E(p["lede"])}</p>
  <div class="ctas"><span class="buybar"><span class="price"><span data-price-of="plan-{E(pid)}">&nbsp;</span><small>a year</small></span></span><button class="btn brass" type="button" data-plan="{E(pid)}">Add to cart</button><a class="btn ghost" href="/pricing/#plans">Compare plans</a></div>
  <p class="muted" style="margin-top:.8rem;font-size:.9rem">You get one package key by email. Use it on up to three of your devices, as long as each one is a different app.{" Central Pads comes with every sound plan." if pid not in ("pads", "utility") else ""}</p>
</div></section>
<section class="pg band"><div class="wrap"><div class="pg-head"><h2>What you get</h2></div><ul class="hl">{hi}</ul>
  <h3 style="margin-top:1.8rem">Free, without a plan</h3><div class="free-list" style="margin-top:.7rem">{free}</div></div></section>
{best}{extra}
<section class="pg{" band" if not extra else ""}"><div class="wrap"><div class="buybar"><div><h2 style="font-size:1.5rem">{E(p["name"])}</h2><p class="muted">Want more than one? <a href="/pricing/#plans">All plans</a> gets you every plan plus Central Pads and Central Utility, and <a href="/pricing/#bundlesTop">church bundles</a> cover your whole team.</p></div>
  <span class="price"><span data-price-of="plan-{E(pid)}">&nbsp;</span><small>a year</small></span><button class="btn" type="button" data-plan="{E(pid)}">Add to cart</button></div></div></section>'''
    OG_SHOT["sounds-" + pid] = {"keys": "cu-instrument", "instrument": "cu-instrument", "pads": "pedal-pads", "plugins": "pc-pads", "pedals": "pc-io", "utility": "cc-lyrics"}.get(pid, "")
    page(f"sounds/{pid}/index.html", "sounds-" + pid, f'{p["name"]}: {p["tag"].lower()} | Motion Audio', p["lede"][:155], body, scripts=["/sounds.js"])


def tracks_page():
    t = C.TRACKS
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><a href="/sounds/">Sounds</a><span aria-hidden="true">/</span><span>{E(t["name"])}</span></div>
  <h1 data-edit="tracksplan.title">{E(t["name"])}</h1>
  <p class="lede" data-edit="tracksplan.lede">{E(t["lede"])}</p>
  <div class="ctas"><span class="buybar"><span class="price"><span data-price-of="subscription">&nbsp;</span><small>a month</small></span></span><button class="btn brass" type="button" data-subscribe>Subscribe</button><a class="btn ghost" href="/#tracks">Search the library</a></div>
  <p class="muted" style="margin-top:.8rem;font-size:.9rem">Cancel whenever you like. If you only need a few songs, you can buy them one at a time from $5.</p>
</div></section>
<section class="pg"><div class="wrap"><div class="pg-head"><h2>Hymns we've arranged</h2><p>Full multitracks with a click and cues, in keys a congregation can sing. Press play to hear 30 seconds of any of them.</p></div>
  <div class="hymns" id="hymnList"><p class="muted">Loading the hymns…</p></div></div></section>
<section class="pg band"><div class="wrap"><div class="facts">
  <div class="fact"><h3>The whole library</h3><p class="muted">Pads, multitracks and Prime tracks from other worship teams, along with their sounds, pedal boards and click sets. We grade each one for sound quality.</p></div>
  <div class="fact"><h3>Straight into your setlist</h3><p class="muted">In any of the apps, go to + Add songs → Central Tracks. The song arrives with its chart and lyrics.</p></div>
  <div class="fact"><h3>Publish your own</h3><p class="muted">If you've recorded something good, publish it. You keep 75% of each sale, plus a share of the subscriber pool.</p><a class="btn ghost small" href="/#publish">Publish a track</a></div>
</div></div></section>'''
    OG_SHOT["sounds-tracks"] = "pc-tracks"
    page("sounds/tracks/index.html", "sounds-tracks", f'{t["name"]}: every track, every month | Motion Audio', t["lede"][:155], body, scripts=["/sounds.js"])


def sounds_hub():
    cards = "".join(f'<a class="plan-card" href="/sounds/{p["id"]}/"><span class="label">{E(p["tag"])}</span><h3>{E(p["name"])}</h3><span class="price"><span data-price-of="plan-{p["id"]}">&nbsp;</span> <small class="muted">a year</small></span><p>{E(p["lede"][:140].rsplit(" ", 1)[0])}…</p></a>' for p in C.PLANS)
    cards += f'<a class="plan-card" href="/sounds/tracks/"><span class="label">{E(C.TRACKS["tag"])}</span><h3>{E(C.TRACKS["name"])}</h3><span class="price"><span data-price-of="subscription">&nbsp;</span> <small class="muted">a month</small></span><p>Add as many pads, multitracks and hymns as you like.</p></a>'
    cards += '<a class="plan-card" href="/pricing/#plans" style="background:var(--stage);color:var(--on-stage);border-color:var(--stage)"><span class="label" style="color:var(--brass-hi)">Best value</span><h3>All plans</h3><span class="price"><span data-price-of="plan-all">&nbsp;</span> <small style="color:var(--on-stage-2)">a year</small></span><p style="color:var(--on-stage-2)">Every sound plan with Central Pads and Central Utility, on one package key.</p></a>'
    sample = [("keys", C.PICKS["keys"][0]), ("pads", C.PICKS["pads"][0]), ("instrument", C.PICKS["instrument"][6]), ("pedals", C.PICKS["pedals"][0]), ("keys", C.PICKS["keys"][6]), ("pads", C.PICKS["pads"][4])]
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><span>Sounds</span></div>
  <h1 data-edit="sounds.title">Sounds and packs</h1>
  <p class="lede" data-edit="sounds.lede">Better pianos, pads, instruments, effects and guitar pedals for the apps, plus backgrounds for the screens and a library of tracks. The plans work in Central Usage, Central Control, Central Pedal Control and on the pedal, and you can listen before you buy.</p>
  <div class="ctas"><a class="btn brass" href="#plans">See the plans</a><a class="btn ghost" href="/pricing/#helper">Which plan do I need?</a></div>
</div></section>
<section class="pg" id="plans"><div class="wrap"><div class="plan-grid">{cards}</div></div></section>
<section class="pg band"><div class="wrap"><div class="pg-head"><h2>A few to try</h2><p>Each one plays for 30 seconds.</p></div><div class="items">{"".join(pick_html(pl, k) for pl, k in sample)}</div></div></section>'''
    OG_SHOT["sounds"] = "cu-instrument"
    page("sounds/index.html", "sounds", "Sounds and packs: keys, instruments, pads, plugins, pedals | Motion Audio", "Central Keys, Central Instrument, Central Pads, Central Plugins, Central Pedals, Central Utility and Central Tracks Unlimited, with 30-second previews.", body, scripts=["/sounds.js"])


# ------------------------------------------------------------------------------------------------------------- pricing
STORE = '''<section id="store" class="pg" data-section="store"><div class="wrap">
  <div class="pg-head"><h2 data-edit="store.title">Buying for a church</h2>
    <p data-edit="store.lede">We build each pedal and send it out ready to play. The apps run on keys you buy once, and tax is included in the prices. If you have a discount or trial code, put it in the cart.</p></div>
  <nav class="store-nav" aria-label="Pricing">
    <a href="#packsTop">Church packs</a><a href="#plans">Sound plans</a><a href="#bundlesTop">Plans for your team</a><a href="#pedalTop">The pedal</a><a href="#rackTop">Apps one at a time</a><a href="#helper">Which plan?</a><a href="#faq">Questions</a>
  </nav>
  <div class="packs-head" id="packsTop" data-section="packs"><div><h3 style="font-size:1.5rem" data-edit="packs.title">Packs for your whole team</h3><p style="margin-top:.35rem" data-edit="packs.lede">Your church's account holds the keys and slots, and you hand them out from the Teams page. Each pack has keys for a main admin, admins and musicians, a Central Pedal Control key and Central Services slots. The pedal is sold separately, so you can start with the gear you already have.</p></div></div>
  <div class="packs" id="packs"></div>
  <details class="keyhelp"><summary data-edit="keys.summary">How keys and slots work</summary>
  <dl class="keydefs" data-section="keys">
    <div><dt>P</dt><dd><b data-edit="keys.p.title">Central Pedal Control</b></dd><dd data-edit="keys.p.body">Yours for good on two devices, with all future updates. The pedal itself doesn't need a key.</dd></div>
    <div><dt>A</dt><dd><b data-edit="keys.a.title">Main admins and admins, Central Control</b></dd><dd data-edit="keys.a.body">One computer per key. It includes the next ten releases of updates, and you can renew for $20 whenever you like. A church can have up to 2 main admins.</dd></div>
    <div><dt>U</dt><dd><b data-edit="keys.u.title">Musicians, Central Usage</b></dd><dd data-edit="keys.u.body">Two devices per key, so a player can have one at church and one at home. The app keeps working even if you never renew.</dd></div>
    <div><dt>S</dt><dd><b data-edit="keys.pkg.title">Sound plans, package keys</b></dd><dd data-edit="keys.pkg.body">Paste it into any app under Settings &rarr; Packages. It works on three of your devices, each a different app, for as long as the plan lasts.</dd></div>
    <div><dt>Slots</dt><dd><b data-edit="keys.s.title">Central Services slots</b></dd><dd data-edit="keys.s.body">One per person on your teams, with no key to type. Take someone off a team and their slot is free for someone else.</dd></div>
  </dl>
  </details>
  <div class="packs-head" id="plans" data-section="plans"><div><h3 style="font-size:1.5rem" data-edit="plans.title">Sound plans</h3><p style="margin-top:.35rem" data-edit="plans.lede">Better pianos, synths, instruments, plugins, pedals and pads for the apps, a year at a time. Every plan comes with Central Pads. You get a package key by email and paste it into any app under Settings &rarr; Packages &rarr; Add a package. One key works on three of your devices if each is a different app, say Central Usage, Central Control and your Central Pedal. The starter sounds stay free either way.</p></div></div>
  <div class="packs" id="planCards"></div>
  <div id="planAll"></div>
  <div class="bundles-head" id="bundlesTop"><h4 data-edit="bundles.title">Every plan for your whole team</h4><p data-edit="bundles.lede">Each person gets a package key with every plan, Central Pads included, for a year. Hand them out on the Teams page. If someone leaves, take their key back and give it to someone else.</p></div>
  <div class="bundles" id="planBundles"></div>
  <div class="store-sub" id="pedalTop"><h3 data-edit="pedal.title">The pedal</h3><p class="muted" data-edit="pedal.lede">We build and test each one before it ships. The software on it doesn't need a key.</p></div>
  <div id="pedalBuy"></div>
  <div class="store-sub" id="rackTop"><h3 data-edit="rack.title">Apps one at a time</h3><p class="muted" data-edit="rack.lede">For a church that already has a pack, or a team of one.</p></div>
  <div class="pricelist" id="rack"></div>
  <div class="store-sub"><h3>Central Tracks Unlimited</h3><p class="muted">Every track in the library, <span data-price-of="subscription"></span> a month. <a href="/sounds/tracks/">Hear our hymns</a> or <a href="/#tracks">search the library</a>.</p></div>
</div></section>'''


def pricing():
    q = lambda name, value, label: f'<label><input type="checkbox" name="{name}" value="{value}"> {E(label)}</label>'
    r = lambda name, value, label, chk=False: f'<label><input type="radio" name="{name}" value="{value}"{" checked" if chk else ""}> {E(label)}</label>'
    faq = "".join(f'<details><summary>{E(qq)}</summary><p>{E(a)}</p></details>' for qq, a in C.PRICING_FAQ)
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><span>Pricing</span></div>
  <h1 data-edit="pricing.title">Plans and prices</h1>
  <p class="lede" data-edit="pricing.lede">Church packs and app keys are a one-time payment. Sound plans are yearly, and Central Tracks is monthly. Tax is included.</p>
  <div class="ctas"><a class="btn brass" href="#packsTop">Church packs</a><a class="btn ghost" href="#plans">Sound plans</a><a class="btn ghost" href="#helper">Which plan do I need?</a></div>
</div></section>
{STORE}
<section class="pg band" id="helper"><div class="wrap"><div class="pg-head"><h2>Which plan do I need?</h2><p>Tell us a little about your team and we'll put together what fits. Nothing goes in your cart until you say.</p></div>
  <form class="helper" id="planHelper" onsubmit="return false">
    <fieldset><legend>Who's it for?</legend><div class="opts">{r("for", "me", "Just me", True)}{r("for", "team", "Our church or team")}</div></fieldset>
    <fieldset data-team><legend>How many people play, sing or run the desk?</legend><div class="opts">{r("size", "4", "Up to 4")}{r("size", "8", "5 to 8", True)}{r("size", "12", "9 to 12")}{r("size", "16", "13 to 16")}{r("size", "20", "17 or more")}</div></fieldset>
    <fieldset><legend>What do you play or run?</legend><div class="opts">{q("need", "keys", "Keys and piano")}{q("need", "instrument", "Bass, guitar, drums or other instruments")}{q("need", "pads", "Pads under the songs")}{q("need", "plugins", "Better effects in the mix")}{q("need", "pedals", "Electric guitar through the apps")}{q("need", "utility", "Lyrics, slides and backgrounds")}</div></fieldset>
    <fieldset data-team><legend>Do you have the apps yet?</legend><div class="opts">{r("have", "no", "Not yet", True)}{r("have", "yes", "Yes, we have a pack")}</div></fieldset>
    <div class="answer" id="helperAnswer" aria-live="polite"></div>
  </form></div></section>
<section class="pg" id="faq"><div class="wrap"><div class="pg-head"><h2>Questions</h2></div><div class="faq">{faq}</div>
  <p class="muted" style="margin-top:1.2rem">Didn't see your question? Look in the <a href="/help/">Help Center</a> or <a href="/help/#contact">get in touch</a>.</p></div></section>'''
    OG_SHOT["pricing"] = "cc-service"
    page("pricing/index.html", "pricing", "Pricing: church packs, sound plans and Central Tracks | Motion Audio", "Church packs and app keys are a one-time payment, sound plans are yearly and Central Tracks Unlimited is monthly. Tax is included.", body, scripts=["/pricing.js"],
         jsonld={"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": a}} for qq, a in C.PRICING_FAQ]})


# ------------------------------------------------------------------------------------------------------------- help
def help_center():
    groups = "".join(f'<div class="faq-group" data-faq-group="{E(g)}"><h3 id="faq-{slug(g)}">{E(g)}</h3>' + "".join(f'<details data-faq><summary>{E(qq)}</summary><p>{E(a)}</p></details>' for qq, a in items) + "</div>" for g, items in C.HELP_FAQ)
    jumps = "".join(f'<a href="#faq-{slug(g)}">{E(g)}</a>' for g, _ in C.HELP_FAQ)
    docs = [("Install the apps", "/help/install.html", "Getting each app onto Windows, Mac, Linux, Android, iPhone or iPad."), ("How accounts work", "/help/accounts.html", "Who owns the keys, what a main admin can do, and how people join your church.")] + [(a["name"] + " manual", a["manual"], a["tag"]) for a in C.APPS if a["manual"]] + [("Status", "/status/", "Check whether sign-in, downloads or payments are down right now.")]
    body = f'''<section class="page-hero on-stage"><div class="wrap">
  <div class="crumbs"><span>Help</span></div>
  <h1 data-edit="help.title">How can we help?</h1>
  <p class="lede" data-edit="help.lede">Setup guides, answers to the questions people ask me most, and a way to reach us when you're stuck.</p>
  <form class="hc-search" role="search" onsubmit="return false"><label for="hcQ" class="sr-only" style="position:absolute;left:-9999px">Search the Help Center</label><input id="hcQ" type="search" placeholder="Try \"no sound\", \"keys\" or \"Planning Center\"" autocomplete="off"></form>
</div></section>
<section class="pg" id="results" hidden><div class="wrap"><div class="pg-head"><h2 id="hcResTitle">Results</h2></div><div class="hc-results" id="hcResults" aria-live="polite"></div></div></section>
<section class="pg" id="guides"><div class="wrap"><div class="pg-head" style="display:flex;justify-content:space-between;align-items:end;gap:1rem;flex-wrap:wrap;max-width:none"><div><h2>Guides</h2><p>Step-by-step setup, with screenshots from the apps.</p></div><button class="btn ghost small" type="button" id="hcEdit" hidden>Write and edit guides</button></div>
  <div class="hc-cats" id="hcCats"><p class="muted">Loading the guides…</p></div>
  <div id="hcEditor" hidden></div></div></section>
<section class="pg band" id="faq"><div class="wrap"><div class="pg-head"><h2>Questions and answers</h2><div class="toc" style="margin-top:0">{jumps}</div></div><div class="faq">{groups}</div></div></section>
<section class="pg" id="docs"><div class="wrap"><div class="pg-head"><h2>Guides and docs</h2></div><div class="hc-cats">{"".join(f'<a class="hc-cat" href="{h}" style="text-decoration:none"><h3>{E(t)}</h3><span class="muted">{E(d)}</span></a>' for t, h, d in docs)}</div></div></section>
<section class="pg band" id="contact"><div class="wrap contact">
  <form id="contactForm" novalidate>
    <h2 style="font-size:1.6rem">Contact support</h2>
    <p class="muted">We read every message and write back by email, usually within a day. The more you tell us, the quicker we can fix it.</p>
    <label>Your name<input id="ctName" autocomplete="name"></label>
    <label>Your email<input id="ctEmail" type="email" autocomplete="email" required></label>
    <label>About<select id="ctApp"><option value="Website">The website or my account</option>{"".join(f"<option>{E(a['name'])}</option>" for a in C.APPS)}<option>Keys, plans or billing</option><option>Something else</option></select></label>
    <label>Subject<input id="ctSubject" maxlength="140" placeholder="Pedal won't connect, a key, billing…"></label>
    <label>What's going on?<textarea id="ctMsg" rows="6" required></textarea></label>
    <div class="hp" aria-hidden="true"><label>Leave this empty<input id="ctWebsite" name="website" tabindex="-1" autocomplete="off"></label></div>
    <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><button class="btn" id="ctSend">Send</button><span class="err" id="ctErr" role="alert"></span></div>
    <div id="ctDone" hidden></div>
  </form>
  <div style="display:grid;gap:1rem">
    <div class="fact"><h3>Email us</h3><p><a href="mailto:{E(C.SUPPORT_EMAIL)}" id="supportMail">{E(C.SUPPORT_EMAIL)}</a></p><p class="muted">We answer from this address, and you can reply to any of our emails.</p></div>
    <div class="fact"><h3>Your tickets</h3><p class="muted">Each message you send becomes a ticket. You can follow it and write back from the link in our email, or under <a href="/#account-help">Account → Help &amp; tickets</a>.</p></div>
    <div class="fact"><h3>Is something down?</h3><p class="muted">The <a href="/status/">status page</a> shows whether the website, sign-in, downloads, payments or Central Tracks are having trouble.</p></div>
  </div>
</div></section>'''
    OG_SHOT["help"] = "cc-devices"
    page("help/index.html", "help", "Help Center: guides, questions and support | Motion Audio", "Setup guides for the Central Pedal and the apps, answers to common questions, and how to reach support.", body, scripts=["/help.js"],
         jsonld={"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": a}} for _, items in C.HELP_FAQ for qq, a in items]})
    page("help/article.html", "help-article", "Help Center | Motion Audio", "A step-by-step guide from the Motion Audio Help Center.", '''<section class="page-hero on-stage"><div class="wrap"><div class="crumbs"><a href="/help/">Help</a><span aria-hidden="true">/</span><span id="artCat">Guide</span></div><h1 id="artTitle">Loading…</h1><p class="lede" id="artSum"></p></div></section>
<section class="pg"><div class="wrap"><article class="article" id="artBody"></article><div class="helpful" id="artHelp" hidden><b>Was this helpful?</b><button class="btn small ghost" type="button" data-helpful="1">Yes</button><button class="btn small ghost" type="button" data-helpful="0">No</button><span class="muted" id="artThanks"></span></div>
<p class="muted" style="margin-top:1.5rem">Still stuck? <a href="/help/#contact">Contact support</a>. <a href="/help/">All guides</a>.</p><div id="artEdit"></div></div></section>''', og="help", scripts=["/help.js"])
    page("help/ticket.html", "help-ticket", "Your support ticket | Motion Audio", "Your conversation with Motion Audio support.", '''<section class="page-hero on-stage"><div class="wrap"><div class="crumbs"><a href="/help/">Help</a><span aria-hidden="true">/</span><span>Your ticket</span></div><h1 id="tkTitle">Your ticket</h1><p class="lede" id="tkSub"></p></div></section>
<section class="pg"><div class="wrap"><div class="ticket" id="tkBody"><p class="muted">Loading…</p></div></div></section>''', og="help", scripts=["/help.js"], noindex=True)


def status_page():
    body = '''<section class="page-hero on-stage"><div class="wrap"><div class="crumbs"><span>Status</span></div><h1>Status</h1><p class="lede">This page checks the website, sign-in, downloads, payments and Central Tracks storage every few minutes. If something here is down, the apps on your devices still keep working.</p><div class="overall" id="stOverall" aria-live="polite"><span class="dot"></span><span>Checking…</span></div></div></section>
<section class="pg"><div class="wrap"><div id="stIncidents" style="display:grid;gap:.6rem;margin-bottom:1.4rem"></div><div class="svc-list" id="stList"></div><p class="muted" style="margin-top:1rem;font-size:.9rem" id="stWhen"></p><div id="stStaff"></div></div></section>'''
    OG_SHOT["status"] = "cc-devices"
    page("status/index.html", "status", "Status | Motion Audio", "Is the Motion Audio website, sign-in, downloads, payments or Central Tracks storage working? Checked every few minutes.", body, scripts=["/status-page.js"])


# ------------------------------------------------------------------------------------------------------------- the other pages
HOME_START = '''<section id="start" class="pg" data-section="start"><div class="wrap">
  <div class="pg-head"><h2 data-edit="start.title">Start with what you need</h2><p data-edit="start.lede">A church pack covers the apps for your team. If you want pads and tracks at your feet, add the pedal. A sound plan gets you better sounds in the apps.</p></div>
  <div id="pedalBuy"></div>
  <div class="need" style="margin-top:1.2rem">
    <div><span class="label">One-time</span><h3>Church packs</h3><p class="muted">Keys for the desk and the musicians, plus Central Services slots for everyone who serves.</p><a class="btn ghost small" href="/pricing/#packsTop">See the packs</a></div>
    <div><span class="label">A year</span><h3>Sound plans</h3><p class="muted">Better pianos, pads, instruments and effects. You can listen to them first.</p><a class="btn ghost small" href="/sounds/">Hear the sounds</a></div>
    <div><span class="label">Not sure?</span><h3>Which apps do we need?</h3><p class="muted">See what each app does and where most churches start.</p><a class="btn ghost small" href="/apps/#compare">Compare the apps</a></div>
  </div>
</div></section>'''

SKIP_CSS = '.skip{position:absolute;left:-9999px;top:0}.skip:focus{left:1rem;top:1rem;z-index:99;background:var(--surface);padding:.5rem 1rem;border-radius:var(--r-sm)}'


def retrofit(rel, home=False):
    """the shared header and footer on a page we don't build (the home page, the manuals, the guides, the policies)"""
    f = os.path.join(PUB, rel)
    s = open(f).read()
    s = re.sub(r'<header class="top">.*?</header>\n?(<div class="salebar" id="saleBar" hidden></div>\n?)?', lambda m: header() + "\n", s, count=1, flags=re.S)
    s = re.sub(r'<footer class="on-stage[^"]*">.*?</footer>', lambda m: footer(), s, count=1, flags=re.S)
    if "/site-pages.css" not in s: s = s.replace('<link rel="stylesheet" href="/site.css">', '<link rel="stylesheet" href="/site.css"><link rel="stylesheet" href="/site-pages.css">', 1)
    if home:
        s = re.sub(r'<section id="store".*?</div></section>\n', lambda m: HOME_START + "\n", s, count=1, flags=re.S)
        s = s.replace('href="#store" data-edit="hero.cta1">See plans and prices', 'href="/pricing/" data-edit="hero.cta1">See plans and prices')
        for a in C.APPS:
            if a["manual"]: s = s.replace(f'<a href="{a["manual"]}"><img src="/brand/{a["icon"]}.svg"', f'<a href="{app_href(a)}"><img src="/brand/{a["icon"]}.svg"')
        s = s.replace('<a href="/production/"><img src="/brand/central-production.svg"', '<a href="/apps/production/"><img src="/brand/central-production.svg"')
    else:
        if 'id="modalHost"' not in s: s = s.replace("</body>", '<div id="modalHost"></div>\n</body>', 1)
        need = [x for x in SCRIPTS_SHOP if f'src="{x}"' not in s]
        if need: s = s.replace("</body>", "".join(f'<script src="{x}"></script>' for x in need) + "\n</body>", 1)
        if "js.stripe.com" not in s: s = s.replace("</head>", '<script src="https://js.stripe.com/dahlia/stripe.js" async></script>\n</head>', 1)
    if 'src="/site-nav.js"' not in s and 'src="site-nav.js"' not in s: s = s.replace('<script src="account-nav.js"></script>', '<script src="account-nav.js"></script>\n<script src="site-nav.js"></script>', 1)
    if home and "account-more.js" not in s: s = s.replace('<script src="account-nav.js"></script>', '<script src="account-nav.js"></script>\n<script src="account-more.js"></script>', 1)
    if home and 'data-page="home"' not in s: s = s.replace("<body>", '<body data-page="home">', 1)
    OUT[rel] = s


def main():
    apps_hub()
    for a in C.APPS: app_page(a)
    sounds_hub()
    for p in C.PLANS: plan_page(p)
    tracks_page()
    pricing()
    help_center()
    status_page()
    retrofit("index.html", home=True)
    for rel in ["apps/central-pedal.html", "apps/central-pedal-control.html", "apps/central-control.html", "apps/central-usage.html", "apps/central-services.html", "help/install.html", "help/accounts.html", "privacy.html", "terms.html", "refunds.html"]:
        if os.path.exists(os.path.join(PUB, rel)): retrofit(rel)
    OUT["img/og/pages.json"] = json.dumps([dict(p, shot=OG_SHOT.get(p["id"], p["shot"]) or "cc-lights") for p in {p["id"]: p for p in OG_PAGES}.values()], indent=1) + "\n"
    check = "--check" in sys.argv
    stale = []
    for rel, text in OUT.items():
        f = os.path.join(PUB, rel)
        old = open(f).read() if os.path.exists(f) else None
        if old == text: continue
        stale.append(rel)
        if not check:
            os.makedirs(os.path.dirname(f), exist_ok=True)
            open(f, "w").write(text)
    if check and stale:
        print("out of date (run python3 tools/make-site.py):", ", ".join(stale)); sys.exit(1)
    print(("checked " if check else "wrote ") + str(len(stale) if not check else len(OUT)) + " pages")


if __name__ == "__main__":
    main()

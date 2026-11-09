#!/usr/bin/env python3
"""
Fetch today's official mandi prices (Agmarknet, via data.gov.in) and update data/prices.json.

Source : "Current Daily Price of Various Commodities from Various Markets (Mandi)"
         Open Government Data Platform India, resource 9ef84268-d588-465a-a308-a864a43d0070
Prices : the feed reports wholesale rupees per quintal (100 kg). We convert to rupees per kg.
Key    : free, from https://data.gov.in (My Account). Put it in the DATA_GOV_API_KEY secret.

Only the Python standard library is used.
"""
import json, os, re, ssl, statistics, sys, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"
ENDPOINT = "https://api.data.gov.in/resource/" + RESOURCE
STATE = os.environ.get("FC_STATE", "Karnataka")
LOCAL = [x.strip().lower() for x in os.environ.get("FC_LOCAL_DISTRICTS", "bangalore,bengaluru,bangalore rural").split(",")]
OUT = os.environ.get("FC_OUT", os.path.join(os.path.dirname(__file__), "..", "data", "prices.json"))
BASE = os.environ.get("FC_API_BASE", ENDPOINT)          # overridable for tests
KEEP_DAYS = 120
AUTO_BACKFILL = int(os.environ.get("FC_BACKFILL_DAYS", "0"))   # used only when there is no history yet
FAILED = []
IST = timezone(timedelta(hours=5, minutes=30))

# Agmarknet commodity name (lower-case, letters and digits only)  ->  FarmConnect catalogue name (kg items only)
ALIAS = {
 "tomato": "Tomato", "onion": "Onion", "potato": "Potato", "carrot": "Carrot",
 "frenchbeansfrasbean": "Beans", "beans": "Beans", "brinjal": "Brinjal", "cabbage": "Cabbage",
 "cauliflower": "Cauliflower", "capsicum": "Capsicum", "greenchilli": "Green Chilli",
 "cucumberkheera": "Cucumber", "cucumbar": "Cucumber", "cucumber": "Cucumber",
 "bhindiladysfinger": "Ladies Finger", "bhindiladiesfinger": "Ladies Finger", "ladiesfinger": "Ladies Finger",
 "beetroot": "Beetroot", "raddish": "Radish", "radish": "Radish", "pumpkin": "Pumpkin",
 "bottlegourd": "Bottle Gourd", "ridgeguardtori": "Ridge Gourd", "ridgegourd": "Ridge Gourd",
 "bittergourd": "Bitter Gourd", "snakeguard": "Snake Gourd", "snakegourd": "Snake Gourd",
 "ashgourd": "Ash Gourd", "drumstick": "Drumstick", "peasgreen": "Green Peas", "greenpeas": "Green Peas",
 "garlic": "Garlic", "gingergreen": "Ginger", "ginger": "Ginger", "sweetpotato": "Sweet Potato",
 "lemon": "Lemon", "knolkhol": "Knol Khol", "turnip": "Turnip", "clusterbeans": "Cluster Beans",
 "colocasia": "Colocasia", "elephantfootyamsuran": "Elephant Foot Yam", "mushrooms": "Button Mushroom",
 "apple": "Apple", "mango": "Totapuri Mango", "orange": "Orange", "mousambisweetlime": "Sweet Lime",
 "grapes": "Grapes", "papaya": "Papaya", "watermelon": "Watermelon", "muskmelon": "Muskmelon",
 "pineapple": "Pineapple", "sapotachikoo": "Sapota", "chikoo": "Sapota", "custardapple": "Custard Apple",
 "customapplesharifa": "Custard Apple", "jackfruit": "Jackfruit", "pomegranate": "Pomegranate",
 "guava": "Allahabad Guava", "pear": "Pear", "plum": "Plum", "amla": "Amla", "amlanellikai": "Amla",
 "tamarind": "Tamarind", "turmeric": "Turmeric", "groundnut": "Groundnuts", "ragifingermillet": "Ragi",
 "jowarsorghum": "Jowar", "bajrapearlmilletcumbu": "Bajra", "wheat": "Wheat Atta", "riceidlyrice": "Idli Rice",
 "turdalahar": "Toor Dal", "turhardal": "Toor Dal", "greengramdalmoongdal": "Moong Dal", "blackgramdalurdidal": "Urad Dal",
 "horsegram": "Horse Gram", "sesamumsesameginger": "Sesame Seeds", "coconut": "Dry Coconut",
 "dryfruit": "", "bananagreen": "",   # not per-kg in the app
 "banana": "Yelakki Banana", "coriander leaves": "", "corianderleaves": "", "tender coconut": "",
}

def key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def http_json(params, tries=5):
    url = BASE + "?" + urllib.parse.urlencode(params)
    ctx = ssl.create_default_context()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "FarmConnect-price-updater/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", "replace")[:200]
            except Exception:
                pass
            last = "HTTP %s %s" % (e.code, body)
            print("  attempt %d: %s" % (i + 1, last), file=sys.stderr)
            if e.code in (401, 403):            # bad key: retrying will not help
                break
            time.sleep(30 * (i + 1) if e.code == 429 else 5 * (i + 1))
        except Exception as e:                  # network hiccup, bad JSON
            last = e
            print("  attempt %d: %s" % (i + 1, last), file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError("API request failed: %s" % last)

def pick(row, *names):
    low = {k.lower(): v for k, v in row.items()}
    for n in names:
        if n in low and low[n] not in (None, "", "NA"):
            return low[n]
    return None

def num(v):
    try:
        return float(str(v).replace(",", ""))
    except Exception:
        return None

def to_iso(d):
    if not d:
        return None
    for f in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(d.strip(), f).strftime("%Y-%m-%d")
        except Exception:
            pass
    return None

def fetch_rows(api_key, date_dmy=None):
    """All rows for the state (optionally one arrival date). Tries filter spellings the portal has used."""
    for state_filter in ("filters[state.keyword]", "filters[state]"):
        rows, offset = [], 0
        try:
            while True:
                p = {"api-key": api_key, "format": "json", "limit": 1000, "offset": offset, state_filter: STATE}
                if date_dmy:
                    p["filters[arrival_date]"] = date_dmy
                data = http_json(p)
                recs = data.get("records") or []
                rows += recs
                if len(recs) < 1000 or offset > 20000:
                    break
                offset += 1000
        except RuntimeError as e:
            print("  warning:", e, file=sys.stderr)
            FAILED.append(str(e))
            rows = []
        if rows:
            return rows
    return []

def aggregate(rows):
    """-> {catalogue name: {date: {m, lo, hi, mk, n, s}}}  (rupees per kg)"""
    bucket, unmatched = {}, {}
    for r in rows:
        com = pick(r, "commodity")
        name = ALIAS.get(key(com))
        if not name:
            if com:
                unmatched[com] = unmatched.get(com, 0) + 1
            continue
        d = to_iso(pick(r, "arrival_date"))
        modal = num(pick(r, "modal_price", "modal_x0020_price"))
        lo = num(pick(r, "min_price", "min_x0020_price"))
        hi = num(pick(r, "max_price", "max_x0020_price"))
        if not d or not modal or modal <= 0:
            continue
        dist = (pick(r, "district") or "").lower()
        bucket.setdefault(name, {}).setdefault(d, []).append({
            "m": modal / 100.0, "lo": (lo or modal) / 100.0, "hi": (hi or modal) / 100.0,
            "mk": pick(r, "market") or "", "local": any(x in dist for x in LOCAL)})
    out = {}
    for name, days in bucket.items():
        out[name] = {}
        for d, lst in days.items():
            loc = [x for x in lst if x["local"]]
            use, scope = (loc, "Bengaluru area") if loc else (lst, STATE)
            out[name][d] = {
                "m": round(statistics.median(x["m"] for x in use), 2),
                "lo": round(min(x["lo"] for x in use), 2),
                "hi": round(max(x["hi"] for x in use), 2),
                "mk": use[0]["mk"], "n": len(use), "s": scope}
    return out, unmatched

def build_board(rows):
    """Every commodity in every Bengaluru-area market, newest row per commodity/variety/market. Rs per kg."""
    best = {}
    for r in rows:
        dist = (pick(r, "district") or "").lower()
        if not any(x in dist for x in LOCAL):
            continue
        d = to_iso(pick(r, "arrival_date"))
        modal = num(pick(r, "modal_price", "modal_x0020_price"))
        if not d or not modal or modal <= 0:
            continue
        lo = num(pick(r, "min_price", "min_x0020_price")) or modal
        hi = num(pick(r, "max_price", "max_x0020_price")) or modal
        k = (pick(r, "commodity") or "", pick(r, "variety") or "", pick(r, "market") or "")
        if k[0] and (k not in best or d > best[k][0]):
            best[k] = (d, [k[0], k[1], k[2], pick(r, "district") or "", round(lo / 100, 2), round(hi / 100, 2), round(modal / 100, 2), d])
    out = sorted((v[1] for v in best.values()), key=lambda x: (x[0].lower(), x[2].lower()))
    return out

def main():
    api_key = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if not api_key:
        sys.exit("DATA_GOV_API_KEY is not set. Add it as a repository secret (see GUIDE).")

    try:
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    except Exception:
        old = {}
    history = {k: {d: v for d, v in days} for k, days in (old.get("history") or {}).items()}  # name -> {date: modal}
    detail = old.get("items") or {}

    print("Fetching latest rows for", STATE)
    rows = fetch_rows(api_key)
    if not rows:
        if FAILED:
            sys.exit("The API call FAILED, so nothing was updated: " + FAILED[-1])
        print("No rows returned (data may not be published yet). Leaving files unchanged.")
        return
    print("Got %d rows from %d districts" % (len(rows), len(set((pick(r, "district") or "") for r in rows))))
    agg, unmatched = aggregate(rows)
    board = build_board(rows)
    if not board:
        print("No Bengaluru-area rows today: showing all %s markets on the board instead" % STATE)
        saved = LOCAL[:]
        LOCAL[:] = [""]                      # "" matches every district
        board = build_board(rows)
        LOCAL[:] = saved
    if board:
        bp = os.path.join(os.path.dirname(os.path.abspath(OUT)), "board.json")
        os.makedirs(os.path.dirname(bp), exist_ok=True)
        with open(bp, "w", encoding="utf-8") as f:
            json.dump({"updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                       "date": max(x[7] for x in board), "unit": "rupees per kg (wholesale)",
                       "cols": ["commodity", "variety", "market", "district", "min", "max", "modal", "date"],
                       "rows": board}, f, ensure_ascii=False, separators=(",", ":"))
        print("Wrote board.json:", len(board), "rows,", len(set(x[2] for x in board)), "markets")

    if not history and AUTO_BACKFILL > 0:
        print("No history yet: back-filling up to %d days" % AUTO_BACKFILL)
        today = datetime.now(IST).date()
        for i in range(1, AUTO_BACKFILL + 1):
            day = today - timedelta(days=i)
            got = fetch_rows(api_key, day.strftime("%d/%m/%Y"))
            if got:
                a2, _ = aggregate(got)
                for name, days in a2.items():
                    for d, v in days.items():
                        agg.setdefault(name, {}).setdefault(d, v)

    latest = ""
    for name, days in agg.items():
        for d, v in days.items():
            history.setdefault(name, {})[d] = v["m"]
            latest = max(latest, d)
        newest = max(days)
        prev = detail.get(name, {}).get("d", "")
        if newest >= prev:
            v = days[newest]
            detail[name] = {"m": v["m"], "lo": v["lo"], "hi": v["hi"], "mk": v["mk"], "n": v["n"], "s": v["s"], "d": newest}

    cutoff = (datetime.now(IST).date() - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    hist_out = {n: sorted([[d, m] for d, m in days.items() if d >= cutoff]) for n, days in history.items()}
    hist_out = {n: h for n, h in hist_out.items() if h}

    doc = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": latest,
        "source": "Agmarknet, Ministry of Agriculture and Farmers Welfare, via data.gov.in",
        "unit": "rupees per kg (wholesale mandi modal price)",
        "scope": STATE,
        "items": detail,
        "history": hist_out,
        "unmatched": sorted(unmatched, key=lambda k: -unmatched[k])[:40],
    }
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    print("Wrote %s: %d commodities, latest data date %s" % (OUT, len(detail), latest))

if __name__ == "__main__":
    main()

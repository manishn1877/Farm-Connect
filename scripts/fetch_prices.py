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
STALE_DAYS = float(os.environ.get("FC_STALE_DAYS", "3"))   # fail the run only if stored prices are older than this
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

RELAY_URL = os.environ.get("FC_RELAY_URL", "").strip().rstrip("/")
RELAY_TOKEN = os.environ.get("FC_RELAY_TOKEN", "").strip()
MIN_ITEMS = int(os.environ.get("FC_MIN_ITEMS", "10"))        # refuse to overwrite good data with fewer matched commodities
MAX_BAD_FRAC = float(os.environ.get("FC_MAX_BAD_FRAC", "0.2"))  # refuse if more than this share of matched rows look invalid
PRICE_MIN, PRICE_MAX = 0.1, 10000.0                           # Rs per kg sanity window after quintal conversion
SECRETS = [s for s in (os.environ.get("DATA_GOV_API_KEY", "").strip(), RELAY_TOKEN) if len(s) >= 6]

def redact(text):
    """Remove any secret value (and api-key query values) from text before it is printed."""
    text = str(text)
    for s in SECRETS:
        text = text.replace(s, "***")
    return re.sub(r"(api-key=)[^&\s\"']+", r"\1***", text)

def classify(exc):
    """Map a low-level error to a short, actionable category."""
    t = str(exc).lower()
    if "10061" in t or "refused" in t:
        return "NETWORK: connection actively refused (host blocks this network)"
    if "10060" in t or "timed out" in t or "timeout" in t:
        return "NETWORK: connection timed out (host blocks or drops this network)"
    if "name or service not known" in t or "getaddrinfo" in t or "11001" in t:
        return "DNS: could not resolve host"
    if "certificate" in t or "ssl" in t:
        return "TLS: certificate or handshake problem"
    return "ERROR: " + type(exc).__name__

def http_json(params, tries=3):
    """GET JSON, directly or through the relay. Short timeouts, few retries, secrets never printed."""
    params = dict(params)
    headers = {"User-Agent": "FarmConnect-fetch/2.0", "Accept": "application/json"}
    if RELAY_URL:
        headers["X-Relay-Token"] = RELAY_TOKEN
        headers["X-Api-Key"] = params.pop("api-key", "")
        url = RELAY_URL + "/?" + urllib.parse.urlencode(params)
    else:
        url = BASE + "?" + urllib.parse.urlencode(params)
    ctx = ssl.create_default_context()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
                raw = r.read()
            try:
                return json.loads(raw)
            except ValueError:
                raise RuntimeError("response was not JSON (first bytes: %s)" % redact(raw[:120].decode("utf-8", "replace")))
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = redact(e.read().decode("utf-8", "replace")[:200])
            except Exception:
                pass
            if e.code == 401 and RELAY_URL:
                last = "AUTH: relay rejected FC_RELAY_TOKEN (HTTP 401)"
            elif e.code in (401, 403):
                last = "AUTH: data.gov.in rejected the request (HTTP %s) - check DATA_GOV_API_KEY. %s" % (e.code, body)
            elif e.code == 502 and RELAY_URL:
                last = "RELAY: Worker could not reach data.gov.in (HTTP 502) %s" % body
            else:
                last = "HTTP %s %s" % (e.code, body)
            print("  attempt %d/%d: %s" % (i + 1, tries, last), file=sys.stderr)
            if e.code in (400, 401, 403, 404):
                break
            if i + 1 < tries:
                delay = 20 * (i + 1) if e.code == 429 else 5 * (i + 1)
                print("  retrying in %d seconds..." % delay, file=sys.stderr)
                time.sleep(delay)
        except Exception as e:
            last = classify(e) if not isinstance(e, RuntimeError) else "ERROR: " + redact(e)
            print("  attempt %d/%d: %s" % (i + 1, tries, last), file=sys.stderr)
            if i + 1 < tries:
                delay = 5 * (i + 1)
                print("  retrying in %d seconds..." % delay, file=sys.stderr)
                time.sleep(delay)
    raise RuntimeError("API request failed after %d attempts: %s" % (tries, last))

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
    """Fetch rows; try the alternate filter only for a rejected filter syntax."""
    errors = []
    had_successful_response = False
    for state_filter in ("filters[state]",):
        rows, offset = [], 0
        try:
            while True:
                p = {"api-key": api_key, "format": "json", "limit": 1000, "offset": offset, state_filter: STATE}
                if date_dmy:
                    p["filters[arrival_date]"] = date_dmy
                data = http_json(p)
                had_successful_response = True
                recs = data.get("records") or []
                rows += recs
                if len(recs) < 1000 or offset > 20000:
                    break
                offset += 1000
        except RuntimeError as e:
            message = str(e)
            print("  warning:", message, file=sys.stderr)
            errors.append(message)
            if "HTTP 400" not in message:
                FAILED.append(message)
                return []
            continue
        if rows:
            return rows

    if not had_successful_response and errors:
        FAILED.extend(errors)
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

def age_days(updated):
    """Days since the 'updated' timestamp in prices.json, or None if unknown."""
    try:
        t = datetime.strptime(updated, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 86400
    except Exception:
        return None

def atomic_write_json(path, obj):
    """Write to a temp file in the same folder, then replace: a crash never leaves half a file."""
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    json.loads(open(tmp, encoding="utf-8").read())        # must parse back
    os.replace(tmp, path)

def summary(line):
    """Append to the GitHub job summary when running in Actions."""
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        with open(p, "a", encoding="utf-8") as f:
            f.write(line + "\n")

def fail_or_keep(msg, old):
    """Fetch problem: keep existing files. Fail the run only when stored prices are stale."""
    age = age_days(old.get("updated"))
    print("::warning::" + redact(msg))
    summary("### Price update skipped\n" + redact(msg))
    if age is None or age > STALE_DAYS:
        sys.exit(redact(msg) + " (stored prices are %s)" % ("missing" if age is None else "%.1f days old" % age))
    print("Keeping the last prices (%.1f days old). The next scheduled run will try again." % age)

def main():
    api_key = os.environ.get("DATA_GOV_API_KEY", "").strip()
    if not api_key:
        sys.exit("DATA_GOV_API_KEY is not set. Add it as a repository secret (see GUIDE).")
    if RELAY_URL and not RELAY_TOKEN:
        sys.exit("FC_RELAY_URL is set but FC_RELAY_TOKEN is empty.")
    print("Route:", "relay (Cloudflare Worker)" if RELAY_URL else "DIRECT to api.data.gov.in")

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
            hint = "" if RELAY_URL else " Direct access from GitHub-hosted runners is blocked by data.gov.in; configure the relay (see relay/README.md)."
            return fail_or_keep("The API could not be reached; no files were changed. Last error: " + FAILED[-1] + hint, old)
        print("NO DATA AVAILABLE: data.gov.in responded successfully but returned no mandi rows yet.")
        print("This is a normal no-data result. Keeping the last successful prices unchanged.")
        summary("### No new mandi rows today. Existing prices kept.")
        return
    print("Got %d rows from %d districts" % (len(rows), len(set((pick(r, "district") or "") for r in rows))))

    agg, unmatched = aggregate(rows)

    # ---- validate BEFORE touching any file -------------------------------------------------
    bad = total = 0
    for name, days in agg.items():
        for d, v in days.items():
            total += 1
            if not (PRICE_MIN <= v["m"] <= PRICE_MAX) or v["lo"] > v["hi"] + 1e-9:
                bad += 1
    if len(agg) < MIN_ITEMS:
        return fail_or_keep("Validation failed: only %d commodities matched (minimum %d); refusing to overwrite good data." % (len(agg), MIN_ITEMS), old)
    if total and bad / float(total) > MAX_BAD_FRAC:
        return fail_or_keep("Validation failed: %d of %d price points are outside Rs %.1f-%.0f per kg; refusing to overwrite good data." % (bad, total, PRICE_MIN, PRICE_MAX), old)
    if bad:
        print("Dropping %d implausible price points" % bad)
        for name in list(agg):
            agg[name] = {d: v for d, v in agg[name].items() if PRICE_MIN <= v["m"] <= PRICE_MAX and v["lo"] <= v["hi"] + 1e-9}
            if not agg[name]:
                del agg[name]

    board = build_board(rows)
    if not board:
        print("No Bengaluru-area rows today: showing all %s markets on the board instead" % STATE)
        saved = LOCAL[:]
        LOCAL[:] = [""]                      # "" matches every district
        board = build_board(rows)
        LOCAL[:] = saved

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
    # ---- write (both files only after everything above succeeded) ---------------------------
    if board:
        bp = os.path.join(os.path.dirname(os.path.abspath(OUT)), "board.json")
        atomic_write_json(bp, {"updated": doc["updated"],
                               "date": max(x[7] for x in board), "unit": "rupees per kg (wholesale)",
                               "cols": ["commodity", "variety", "market", "district", "min", "max", "modal", "date"],
                               "rows": board})
        print("Wrote board.json:", len(board), "rows,", len(set(x[2] for x in board)), "markets")
    atomic_write_json(OUT, doc)
    print("Wrote %s: %d commodities, latest data date %s" % (OUT, len(detail), latest))
    summary("### Prices updated\n%d commodities, latest data date %s, %d board rows" % (len(detail), latest, len(board)))

if __name__ == "__main__":
    main()

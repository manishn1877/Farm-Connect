"""
Fills this folder with photos for every item in produce-list.csv.

Run it on a computer or server WITH internet access:
    python3 download_images.py

It asks Wikipedia (Wikimedia Commons) for the main photo of each item and saves
it as <file_name>.jpg here. Files that already exist are skipped, so you can
replace any photo with your own (same file name) and re-run safely.
Wikipedia photos are free-licence but usually need credit; see https://commons.wikimedia.org
"""
import csv, json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "FarmConnect-photo-fetch/1.0 (contact: your-email@example.com)"}

def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30).read()

def photo_url(title):
    api = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"))
    try:
        j = json.loads(get(api))
        t = j.get("thumbnail") or j.get("originalimage") or {}
        return t.get("source")
    except Exception:
        return None

def main():
    ok = miss = skip = 0
    with open(os.path.join(HERE, "produce-list.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row["file_name_without_extension"]
            if any(os.path.exists(os.path.join(HERE, name + e)) for e in (".jpg", ".jpeg", ".png", ".webp")):
                skip += 1
                continue
            url = photo_url(row["wikipedia_page"]) or photo_url(row["name"])
            if not url:
                print("no photo found:", row["name"]); miss += 1; continue
            try:
                with open(os.path.join(HERE, name + ".jpg"), "wb") as out:
                    out.write(get(url))
                print("saved", name); ok += 1
            except Exception as e:
                print("failed", name, e); miss += 1
    print(f"done: {ok} saved, {skip} already there, {miss} missing")

if __name__ == "__main__":
    sys.exit(main())

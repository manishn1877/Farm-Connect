"""
Copies YOUR existing photos into this folder with the names the website expects.

Usage (run inside the produce folder):
    python3 match_photos.py "C:/path/to/your/photos"      (or any folder, sub-folders are searched)

For each row of produce-list.csv it looks for a photo whose file name matches the
item (e.g. "Tomato.JPG", "tomato_1.png", "green chilli.webp") and saves a copy as
<name>.jpg/.png/.webp here. Anything it cannot match is listed at the end so you can
rename those by hand using produce-list.csv. Your original photos are never changed.
"""
import csv, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = (".jpg", ".jpeg", ".png", ".webp")

def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 1
    src = sys.argv[1]
    files = []
    for root, _, names in os.walk(src):
        for n in names:
            if n.lower().endswith(EXT):
                files.append((norm(os.path.splitext(n)[0]), os.path.join(root, n)))
    done, missing = 0, []
    with open(os.path.join(HERE, "produce-list.csv"), newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            slug = row["file_name_without_extension"]
            if any(os.path.exists(os.path.join(HERE, slug + e)) for e in EXT):
                continue
            keys = [norm(row["name"]), norm(row["wikipedia_page"]), slug.replace("-", " ")]
            hit = next((p for st, p in files if st in keys), None) or \
                  next((p for st, p in files if any(k and (st.startswith(k) or k in st.split()) for k in keys)), None)
            if hit:
                shutil.copy2(hit, os.path.join(HERE, slug + os.path.splitext(hit)[1].lower()))
                done += 1
            else:
                missing.append(row["name"])
    print(f"copied {done} photos")
    if missing:
        print("no match for:", ", ".join(missing))

if __name__ == "__main__":
    sys.exit(main())

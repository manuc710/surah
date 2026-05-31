import json
import os
import sys
import urllib.request


BASE = "https://data.qurancentral.com/categories/{slug}.json"


def main() -> None:
    slug = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not slug:
        raise SystemExit("usage: python scripts/update_reciter_catalog.py <reciter-slug>")

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://qurancentral.com/",
        "Origin": "https://qurancentral.com",
    }
    req = urllib.request.Request(BASE.format(slug=slug), headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)

    items = data.get("items") or []
    out_items = []
    by_number: dict[str, str] = {}

    for it in items:
        title = (it.get("title") or "").strip()
        url = (it.get("url") or "").strip()
        duration = (it.get("duration") or "").strip()
        if not title or not url:
            continue
        n = title.split(" ", 1)[0]
        if len(n) == 3 and n.isdigit():
            by_number[n] = url
            out_items.append({"n": n, "title": title, "duration": duration, "url": url})

    count = len({x["n"] for x in out_items})
    payload = {"slug": slug, "count": count, "byNumber": by_number, "list": out_items}

    os.makedirs("reciter_catalogs", exist_ok=True)
    out_path = os.path.join("reciter_catalogs", f"{slug}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()


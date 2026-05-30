import json
import urllib.request


URL = "https://data.qurancentral.com/reciters.json"


def main() -> None:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://qurancentral.com/",
        "Origin": "https://qurancentral.com",
    }
    req = urllib.request.Request(URL, headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)

    out = []
    for r in data:
        slug = (r.get("slug") or "").strip()
        name = (r.get("name") or "").strip()
        if not slug or not name:
            continue
        out.append(
            {
                "id": r.get("id"),
                "slug": slug,
                "name": name,
                "country": r.get("country") or "",
                "dialect": r.get("dialect") or "",
                "imageUrl": f"https://artwork.qurancentral.com/{slug}-300x300.jpg",
            }
        )

    out.sort(key=lambda x: x["name"].lower())

    with open("reciters.json", "w", encoding="utf-8") as f:
        json.dump({"reciters": out}, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()


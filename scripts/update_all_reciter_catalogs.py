import concurrent.futures
import json
import os
import random
import threading
import time
import urllib.error
import urllib.request


BASE = "https://data.qurancentral.com/categories/{slug}.json"


def fetch_one(slug: str, headers: dict[str, str], attempts: int = 4) -> dict | None:
    url = BASE.format(slug=slug)
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.load(resp)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (403, 404):
                return None
            time.sleep(min(8.0, (0.7 * (2**i)) + random.random() * 0.4))
        except Exception as e:
            last_err = e
            time.sleep(min(8.0, (0.7 * (2**i)) + random.random() * 0.4))
    if last_err:
        raise last_err
    return None


def build_payload(slug: str, data: dict) -> dict:
    items = data.get("items") or []
    out_items: list[dict] = []
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
    return {"slug": slug, "count": count, "byNumber": by_number, "list": out_items}


def main() -> None:
    reciters = json.load(open("reciters.json", "r", encoding="utf-8")).get("reciters") or []
    slugs = [str(r.get("slug") or "").strip() for r in reciters]
    slugs = [s for s in slugs if s]

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Referer": "https://qurancentral.com/",
        "Origin": "https://qurancentral.com",
    }

    os.makedirs("reciter_catalogs", exist_ok=True)

    lock = threading.Lock()
    done = 0
    ok = 0
    skipped = 0
    failed = 0
    total = len(slugs)

    def job(slug: str) -> tuple[str, str]:
        out_path = os.path.join("reciter_catalogs", f"{slug}.json")
        if os.path.exists(out_path) and os.path.getsize(out_path) > 200:
            return (slug, "exists")
        data = fetch_one(slug, headers=headers)
        if not data:
            return (slug, "skipped")
        payload = build_payload(slug, data)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return (slug, "ok")

    workers = min(14, max(6, (os.cpu_count() or 8)))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(job, s): s for s in slugs}
        for fut in concurrent.futures.as_completed(futs):
            slug = futs[fut]
            status = "failed"
            try:
                _, status = fut.result()
            except Exception:
                status = "failed"

            with lock:
                done += 1
                if status == "ok":
                    ok += 1
                elif status == "exists":
                    ok += 1
                elif status == "skipped":
                    skipped += 1
                else:
                    failed += 1
                if done % 10 == 0 or done == total:
                    print(f"{done}/{total} ok={ok} skipped={skipped} failed={failed}")

    print(f"done total={total} ok={ok} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()


import fs from "node:fs/promises";

const ROOT = "c:\\Users\\manuc\\Desktop\\kyril-html";
const OUT_JS = `${ROOT}\\mp3quran-reciters.js`;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeServer(server) {
  const value = cleanText(server);
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}

function parseSurahList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 114);
}

function pickBestMoshaf(moshafList) {
  const items = Array.isArray(moshafList) ? moshafList : [];
  const ranked = items
    .map((moshaf) => {
      const surahs = parseSurahList(moshaf.surah_list);
      const server = normalizeServer(moshaf.server);
      const name = cleanText(moshaf.name);
      const isHafs = Number(moshaf.rewaya_id) === 1 || /hafs/i.test(name);
      const has114 = surahs.includes(114);
      const total = Number(moshaf.surah_total || surahs.length || 0);
      return {
        raw: moshaf,
        surahs,
        server,
        name,
        has114,
        total,
        isHafs,
      };
    })
    .filter((item) => item.server && item.has114 && item.total > 0);

  ranked.sort((a, b) => {
    if (a.isHafs !== b.isHafs) return a.isHafs ? -1 : 1;
    if (a.total !== b.total) return b.total - a.total;
    return a.name.localeCompare(b.name, "en");
  });

  return ranked[0] || null;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

const json = await getJson("https://mp3quran.net/api/v3/reciters?language=eng");
const sourceList = Array.isArray(json?.reciters) ? json.reciters : [];

const reciters = sourceList
  .map((reciter) => {
    const best = pickBestMoshaf(reciter.moshaf);
    if (!best) return null;
    return {
      id: Number(reciter.id || 0),
      name: cleanText(reciter.name),
      letter: cleanText(reciter.letter),
      folder: `mp3quran:${reciter.id}:${best.raw.id}`,
      source: "mp3quran",
      server: best.server,
      style: best.name,
      rewayaId: Number(best.raw.rewaya_id || 0),
      moshafId: Number(best.raw.id || 0),
      surahTotal: best.total,
      surahs: best.surahs,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

const payload = {
  source: "https://mp3quran.net/api/v3/reciters?language=eng",
  generatedAt: new Date().toISOString(),
  total: reciters.length,
  reciters,
};

await fs.writeFile(OUT_JS, `window.__MP3QURAN_RECITERS__ = ${JSON.stringify(payload, null, 2)};\n`, "utf8");

console.log(JSON.stringify({ written: OUT_JS, total: reciters.length, first: reciters[0]?.name, last: reciters[reciters.length - 1]?.name }));

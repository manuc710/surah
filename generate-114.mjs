import fs from "node:fs/promises";

const ROOT = "c:\\Users\\manuc\\Desktop\\kyril-html";
const OUT_JS = `${ROOT}\\114.js`;

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const listJson = await getJson("https://equran.id/api/v2/surat");
const list = Array.isArray(listJson?.data) ? listJson.data : [];
if (list.length !== 114) {
  throw new Error(`Unexpected surah count: ${list.length}`);
}

const surahs = await mapWithConcurrency(list, 8, async (item) => {
  const number = Number(item?.nomor);
  const detailJson = await getJson(`https://equran.id/api/v2/surat/${number}`);
  const detail = detailJson?.data;
  if (!detail || !Array.isArray(detail.ayat)) {
    throw new Error(`Bad detail response for surah ${number}`);
  }

  return {
    number,
    arabicName: cleanText(detail.nama),
    transliteratedName: cleanText(detail.namaLatin),
    revelationType: cleanText(detail.tempatTurun),
    numberOfAyahs: Number(detail.jumlahAyat || detail.ayat.length || 0),
    audioFull: detail.audioFull || {},
    verses: detail.ayat.map((ayah) => ({
      index: Number(ayah.nomorAyat || 0),
      arabic: cleanText(ayah.teksArab),
      translit: cleanText(ayah.teksLatin),
      audio: ayah.audio || {},
    })),
  };
});

const output = {
  fileId: "114",
  generatedAt: new Date().toISOString(),
  source: "https://equran.id/api/v2/surat",
  totalSurahs: surahs.length,
  surahs,
};

await fs.writeFile(OUT_JS, `window.__QURAN114__ = ${JSON.stringify(output, null, 2)};\n`, "utf8");

console.log(
  JSON.stringify({
    written: OUT_JS,
    totalSurahs: output.totalSurahs,
    firstSurah: surahs[0]?.transliteratedName,
    lastSurah: surahs[surahs.length - 1]?.transliteratedName,
  }),
);

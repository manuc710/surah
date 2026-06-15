import fs from "node:fs/promises";

const ROOT = "c:\\Users\\manuc\\Desktop\\kyril-html";
const OUT = `${ROOT}\\surah114.json`;
const OUT_JS = `${ROOT}\\surah114.js`;

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

function cleanText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function splitSurahList(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function slugify(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const [
  alquranArabic,
  alquranEnglish,
  alquranRussian,
  alquranAudioEditions,
  equran,
  mp3quran,
] = await Promise.all([
  getJson("https://api.alquran.cloud/v1/surah/114/quran-uthmani"),
  getJson("https://api.alquran.cloud/v1/surah/114/en.asad"),
  getJson("https://api.alquran.cloud/v1/surah/114/ru.kuliev"),
  getJson("https://api.alquran.cloud/v1/edition/format/audio"),
  getJson("https://equran.id/api/v2/surat/114"),
  getJson("https://www.mp3quran.net/api/v3/reciters?language=eng"),
]);

const alEn = alquranEnglish.data;
const alRu = alquranRussian.data;
const eq = equran.data;

const parts = [
  {
    id: "part-1",
    title: "Обращение за защитой",
    ayahRange: "1",
    ayahNumbers: [1],
    theme: "Начало суры формулирует прямую мольбу о защите у Господа людей.",
  },
  {
    id: "part-2",
    title: "Три атрибута Господа людей",
    ayahRange: "2-3",
    ayahNumbers: [2, 3],
    theme: "Защита связывается с царской властью Аллаха, Его господством и исключительной божественностью.",
  },
  {
    id: "part-3",
    title: "Описание скрытой угрозы",
    ayahRange: "4-5",
    ayahNumbers: [4, 5],
    theme: "Сура указывает на опасность наущения, которое действует незаметно и проникает в сердца людей.",
  },
  {
    id: "part-4",
    title: "Источники наущения",
    ayahRange: "6",
    ayahNumbers: [6],
    theme: "Финальный аят уточняет, что искушение может исходить как от джиннов, так и от людей.",
  },
];

const ayahToPart = new Map();
for (const part of parts) {
  for (const ayahNumber of part.ayahNumbers) {
    ayahToPart.set(ayahNumber, part.id);
  }
}

const ayahs = eq.ayat.map((ayah, index) => {
  const ayahNumber = index + 1;
  const enAyah = alEn.ayahs[index];
  const ruAyah = alRu.ayahs[index];
  return {
    ayahNumber,
    partId: ayahToPart.get(ayahNumber),
    arabic: cleanText(ayah.teksArab),
    transliteration: cleanText(ayah.teksLatin),
    translations: {
      ru: cleanText(ruAyah.text),
      en: cleanText(enAyah.text),
      id: cleanText(ayah.teksIndonesia),
    },
    location: {
      globalAyahNumber: enAyah.number,
      juz: enAyah.juz,
      manzil: enAyah.manzil,
      page: enAyah.page,
      ruku: enAyah.ruku,
      hizbQuarter: enAyah.hizbQuarter,
    },
    audioSamples: {
      equranPartial: ayah.audio,
    },
  };
});

const reciters = mp3quran.reciters
  .map((reciter) => {
    const audioMaterials = (reciter.moshaf || [])
      .filter((moshaf) => splitSurahList(moshaf.surah_list).includes("114"))
      .map((moshaf) => {
        const profileLabel = cleanText(moshaf.name);
        const parts = profileLabel.split(" - ").map(cleanText).filter(Boolean);
        const server = cleanText(moshaf.server).replace(/\/+$/, "");
        return {
          source: "mp3quran.net",
          moshafId: moshaf.id,
          profileLabel,
          riwayahOrEdition: parts[0] || "",
          style: parts.length > 1 ? parts[parts.length - 1] : profileLabel,
          surahTotalReportedBySource: moshaf.surah_total,
          moshafType: moshaf.moshaf_type,
          baseServer: server ? `${server}/` : null,
          surah114Url: server ? `${server}/114.mp3` : null,
        };
      });

    if (!audioMaterials.length) return null;

    return {
      id: `mp3quran-${reciter.id}`,
      fullName: cleanText(reciter.name),
      slug: slugify(reciter.name),
      catalogSource: "mp3quran.net",
      letterGroup: reciter.letter,
      lastUpdatedAtSource: reciter.date,
      characteristics: {
        riwayatOrEditions: [...new Set(audioMaterials.map((item) => item.riwayahOrEdition).filter(Boolean))].sort(),
        styles: [...new Set(audioMaterials.map((item) => item.style).filter(Boolean))].sort(),
        availableProfilesCount: new Set(audioMaterials.map((item) => item.profileLabel)).size,
      },
      audioMaterials,
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.fullName.localeCompare(b.fullName, "en"));

const alquranCloudArabicAudioEditions = alquranAudioEditions.data
  .filter((edition) => edition.language === "ar")
  .filter((edition) => !String(edition.type).toLowerCase().includes("translation"))
  .reduce((acc, edition) => {
    const key = `${String(edition.englishName).toLowerCase()}|${edition.type}`;
    if (acc.seen.has(key)) return acc;
    acc.seen.add(key);
    acc.items.push({
      identifier: edition.identifier,
      englishName: cleanText(edition.englishName),
      arabicName: cleanText(edition.name),
      type: edition.type,
      note: "Доступно как аудио-издание в AlQuran Cloud для суры 114 через edition-based endpoints.",
    });
    return acc;
  }, { seen: new Set(), items: [] }).items
  .sort((a, b) => a.englishName.localeCompare(b.englishName, "en"));

const equranReciters = [
  { key: "01", fullName: "Abdullah Al-Juhany", surah114Url: eq.audioFull["01"], source: "eQuran.id" },
  { key: "02", fullName: "Abdul Muhsin Al-Qasim", surah114Url: eq.audioFull["02"], source: "eQuran.id" },
  { key: "03", fullName: "Abdurrahman as-Sudais", surah114Url: eq.audioFull["03"], source: "eQuran.id" },
  { key: "04", fullName: "Ibrahim Al-Dossari", surah114Url: eq.audioFull["04"], source: "eQuran.id" },
  { key: "05", fullName: "Misyari Rasyid Al-Afasi", surah114Url: eq.audioFull["05"], source: "eQuran.id" },
  { key: "06", fullName: "Yasser Al-Dosari", surah114Url: eq.audioFull["06"], source: "eQuran.id" },
];

const audioVariants = reciters.reduce((sum, reciter) => sum + reciter.audioMaterials.length, 0);

const output = {
  fileId: "surah114",
  generatedAt: new Date().toISOString(),
  encoding: "utf-8",
  sourcePolicy: {
    primaryTextSource: "AlQuran Cloud",
    supplementarySources: ["eQuran.id", "mp3quran.net"],
    notes: [
      "Основной текстовый слой и переводы собраны вокруг AlQuran Cloud.",
      "Транслитерация и компактные поаятные аудиоссылки добавлены из eQuran.id.",
      "Полный каталог чтецов и ссылки на mp3 114-й суры собраны из mp3quran.net.",
    ],
  },
  surah: {
    number: 114,
    arabicName: "الناس",
    transliteratedName: "An-Nas",
    englishName: alEn.englishName,
    meaning: {
      en: alEn.englishNameTranslation,
      id: eq.arti,
      ru: "Люди",
    },
    numberOfAyahs: alEn.numberOfAyahs,
    location: {
      juz: alEn.ayahs[0].juz,
      manzil: alEn.ayahs[0].manzil,
      page: alEn.ayahs[0].page,
      ruku: alEn.ayahs[0].ruku,
      hizbQuarter: alEn.ayahs[0].hizbQuarter,
    },
    classification: {
      preferredValue: alEn.revelationType,
      sourceDisagreement: [
        { source: "AlQuran Cloud", value: alEn.revelationType },
        { source: "eQuran.id", value: eq.tempatTurun },
        { source: "eQuran.id description", value: "Makkiyah (внутри описания источника)" },
      ],
      note: "Источники расходятся по месту ниспослания; конфликт сохранён в файле явно.",
    },
    bismillah: {
      arabic: "بسم الله الرحمن الرحيم",
      transliteration: "Bismillahir-rahmanir-rahim",
      includedInAyahCount: false,
    },
  },
  structure: {
    summary: "Сура 114 строится как краткая молитва о защите: сначала идёт обращение к Аллаху, затем перечисляются Его отношения к людям, после чего раскрывается природа скрытого наущения и указывается, что оно может исходить как от джиннов, так и от людей.",
    logicalParts: parts,
  },
  ayahs,
  recitersAudit: {
    surahNumberChecked: 114,
    uniqueReciters: reciters.length,
    audioVariants,
    sourcesScanned: ["mp3quran.net", "AlQuran Cloud", "eQuran.id"],
    deduplicationRule: "В основном каталоге каждый чтец хранится один раз по уникальному идентификатору reciter из mp3quran.net; разные риваяты и стили объединены в массив audioMaterials.",
    knownAdditionalOpenCatalogs: {
      alquranCloudArabicAudioEditions,
      equranIdReciters: equranReciters,
    },
  },
  reciters,
};

await fs.writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await fs.writeFile(OUT_JS, `window.__SURAH114__ = ${JSON.stringify(output, null, 2)};\n`, "utf8");

console.log(JSON.stringify({
  written: OUT,
  writtenJs: OUT_JS,
  ayahs: ayahs.length,
  logicalParts: parts.length,
  uniqueReciters: reciters.length,
  audioVariants,
}));

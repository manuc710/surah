export type Revelation = 'Meccan' | 'Medinan'

export type Surah = {
  id: number
  name: string
  arabicName: string
  ayahCount: number
  revelation: Revelation
  durationSec: number
}

export type Ayah = {
  surahId: number
  number: number
  ar: string
  ru: string
}

export const demoSurahs: Surah[] = [
  {
    id: 1,
    name: 'Аль-Фатиха',
    arabicName: 'ٱلْفَاتِحَة',
    ayahCount: 7,
    revelation: 'Meccan',
    durationSec: 78,
  },
  {
    id: 112,
    name: 'Аль-Ихляс',
    arabicName: 'ٱلْإِخْلَاص',
    ayahCount: 4,
    revelation: 'Meccan',
    durationSec: 44,
  },
  {
    id: 113,
    name: 'Аль-Фаляк',
    arabicName: 'ٱلْفَلَق',
    ayahCount: 5,
    revelation: 'Meccan',
    durationSec: 52,
  },
  {
    id: 114,
    name: 'Ан-Нас',
    arabicName: 'ٱلنَّاس',
    ayahCount: 6,
    revelation: 'Meccan',
    durationSec: 60,
  },
]

export const demoAyahs: Ayah[] = [
  {
    surahId: 1,
    number: 1,
    ar: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    ru: 'Во имя Аллаха, Милостивого, Милосердного!',
  },
  {
    surahId: 1,
    number: 2,
    ar: 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ',
    ru: 'Хвала Аллаху, Господу миров,',
  },
  {
    surahId: 1,
    number: 3,
    ar: 'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ',
    ru: 'Милостивому, Милосердному,',
  },
  {
    surahId: 1,
    number: 4,
    ar: 'مَٰلِكِ يَوْمِ ٱلدِّينِ',
    ru: 'Властелину Дня воздаяния!',
  },
  {
    surahId: 1,
    number: 5,
    ar: 'إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ',
    ru: 'Тебе одному мы поклоняемся и Тебя одного молим о помощи.',
  },
  {
    surahId: 1,
    number: 6,
    ar: 'ٱهْدِنَا ٱلصِّرَٰطَ ٱلْمُسْتَقِيمَ',
    ru: 'Веди нас прямым путем,',
  },
  {
    surahId: 1,
    number: 7,
    ar: 'صِرَٰطَ ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ ٱلْمَغْضُوبِ عَلَيْهِمْ وَلَا ٱلضَّالِّينَ',
    ru: 'путем тех, кого Ты облагодетельствовал, не тех, на кого пал гнев, и не заблудших.',
  },
  {
    surahId: 112,
    number: 1,
    ar: 'قُلْ هُوَ ٱللَّهُ أَحَدٌ',
    ru: 'Скажи: Он — Аллах Единый,',
  },
  {
    surahId: 112,
    number: 2,
    ar: 'ٱللَّهُ ٱلصَّمَدُ',
    ru: 'Аллах Самодостаточный.',
  },
  {
    surahId: 112,
    number: 3,
    ar: 'لَمْ يَلِدْ وَلَمْ يُولَدْ',
    ru: 'Он не родил и не был рожден,',
  },
  {
    surahId: 112,
    number: 4,
    ar: 'وَلَمْ يَكُن لَّهُۥ كُفُوًا أَحَدٌ',
    ru: 'и нет никого равного Ему.',
  },
  {
    surahId: 113,
    number: 1,
    ar: 'قُلْ أَعُوذُ بِرَبِّ ٱلْفَلَقِ',
    ru: 'Скажи: «Прибегаю к защите Господа рассвета',
  },
  {
    surahId: 113,
    number: 2,
    ar: 'مِن شَرِّ مَا خَلَقَ',
    ru: 'от зла того, что Он сотворил,',
  },
  {
    surahId: 113,
    number: 3,
    ar: 'وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ',
    ru: 'от зла мрака, когда он наступает,',
  },
  {
    surahId: 113,
    number: 4,
    ar: 'وَمِن شَرِّ ٱلنَّفَّٰثَٰتِ فِى ٱلْعُقَدِ',
    ru: 'от зла колдуний, которые дуют на узлы,',
  },
  {
    surahId: 113,
    number: 5,
    ar: 'وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ',
    ru: 'и от зла завистника, когда он завидует».',
  },
  {
    surahId: 114,
    number: 1,
    ar: 'قُلْ أَعُوذُ بِرَبِّ ٱلنَّاسِ',
    ru: 'Скажи: «Прибегаю к защите Господа людей,',
  },
  {
    surahId: 114,
    number: 2,
    ar: 'مَلِكِ ٱلنَّاسِ',
    ru: 'Царя людей,',
  },
  {
    surahId: 114,
    number: 3,
    ar: 'إِلَٰهِ ٱلنَّاسِ',
    ru: 'Бога людей,',
  },
  {
    surahId: 114,
    number: 4,
    ar: 'مِن شَرِّ ٱلْوَسْوَاسِ ٱلْخَنَّاسِ',
    ru: 'от зла искусителя, отступающего (при поминании Аллаха),',
  },
  {
    surahId: 114,
    number: 5,
    ar: 'ٱلَّذِى يُوَسْوِسُ فِى صُدُورِ ٱلنَّاسِ',
    ru: 'который наущает в груди людей,',
  },
  {
    surahId: 114,
    number: 6,
    ar: 'مِنَ ٱلْجِنَّةِ وَٱلنَّاسِ',
    ru: 'от джиннов и людей».',
  },
]

export function getSurahById(id: number): Surah | undefined {
  return demoSurahs.find((s) => s.id === id)
}

export function getAyahsBySurahId(surahId: number): Ayah[] {
  return demoAyahs.filter((a) => a.surahId === surahId).sort((a, b) => a.number - b.number)
}


$ErrorActionPreference = 'Stop'

function Get-Json($Url) {
  return Invoke-RestMethod -Uri $Url -Headers @{ 'User-Agent' = 'Mozilla/5.0' }
}

function Clean-Text($Text) {
  if ($null -eq $Text) { return '' }
  return ([regex]::Replace([string]$Text, '\s+', ' ')).Trim()
}

function Split-SurahList($Value) {
  if ([string]::IsNullOrWhiteSpace([string]$Value)) { return @() }
  return @([string]$Value -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function New-Slug($Text) {
  $value = ([string]$Text).ToLowerInvariant()
  $value = $value.Replace("'", '').Replace('’', '').Replace('`', '').Replace('&', 'and')
  $value = [regex]::Replace($value, '[^a-z0-9]+', '-')
  return $value.Trim('-')
}

$root = 'c:\Users\manuc\Desktop\kyril-html'
$outFile = Join-Path $root 'surah114.json'

$alquranArabic = Get-Json 'https://api.alquran.cloud/v1/surah/114/quran-uthmani'
$alquranEnglish = Get-Json 'https://api.alquran.cloud/v1/surah/114/en.asad'
$alquranRussian = Get-Json 'https://api.alquran.cloud/v1/surah/114/ru.kuliev'
$alquranAudioEditions = Get-Json 'https://api.alquran.cloud/v1/edition/format/audio'
$equran = Get-Json 'https://equran.id/api/v2/surat/114'
$mp3quran = Get-Json 'https://www.mp3quran.net/api/v3/reciters?language=eng'

$alEn = $alquranEnglish.data
$alRu = $alquranRussian.data
$eq = $equran.data

$parts = @(
  [ordered]@{
    id = 'part-1'
    title = 'Обращение за защитой'
    ayahRange = '1'
    ayahNumbers = @(1)
    theme = 'Начало суры формулирует прямую мольбу о защите у Господа людей.'
  },
  [ordered]@{
    id = 'part-2'
    title = 'Три атрибута Господа людей'
    ayahRange = '2-3'
    ayahNumbers = @(2, 3)
    theme = 'Защита связывается с царской властью Аллаха, Его господством и исключительной божественностью.'
  },
  [ordered]@{
    id = 'part-3'
    title = 'Описание скрытой угрозы'
    ayahRange = '4-5'
    ayahNumbers = @(4, 5)
    theme = 'Сура указывает на опасность наущения, которое действует незаметно и проникает в сердца людей.'
  },
  [ordered]@{
    id = 'part-4'
    title = 'Источники наущения'
    ayahRange = '6'
    ayahNumbers = @(6)
    theme = 'Финальный аят уточняет, что искушение может исходить как от джиннов, так и от людей.'
  }
)

$ayahToPart = @{}
foreach ($part in $parts) {
  foreach ($ayahNumber in $part.ayahNumbers) {
    $ayahToPart["$ayahNumber"] = $part.id
  }
}

$ayahs = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $eq.ayat.Count; $i++) {
  $ayah = $eq.ayat[$i]
  $enAyah = $alEn.ayahs[$i]
  $ruAyah = $alRu.ayahs[$i]
  $ayahNumber = $i + 1

  $ayahs.Add([ordered]@{
    ayahNumber = $ayahNumber
    partId = $ayahToPart["$ayahNumber"]
    arabic = Clean-Text $ayah.teksArab
    transliteration = Clean-Text $ayah.teksLatin
    translations = [ordered]@{
      ru = Clean-Text $ruAyah.text
      en = Clean-Text $enAyah.text
      id = Clean-Text $ayah.teksIndonesia
    }
    location = [ordered]@{
      globalAyahNumber = $enAyah.number
      juz = $enAyah.juz
      manzil = $enAyah.manzil
      page = $enAyah.page
      ruku = $enAyah.ruku
      hizbQuarter = $enAyah.hizbQuarter
    }
    audioSamples = [ordered]@{
      equranPartial = $ayah.audio
    }
  })
}

$reciters = New-Object System.Collections.Generic.List[object]
foreach ($reciter in $mp3quran.reciters) {
  $variants = New-Object System.Collections.Generic.List[object]
  foreach ($moshaf in $reciter.moshaf) {
    $surahs = Split-SurahList $moshaf.surah_list
    if ($surahs -notcontains '114') { continue }

    $server = Clean-Text $moshaf.server
    if ($server.EndsWith('/')) {
      $server = $server.Substring(0, $server.Length - 1)
    }
    $profileLabel = Clean-Text $moshaf.name
    $pieces = @($profileLabel -split ' - ' | ForEach-Object { Clean-Text $_ } | Where-Object { $_ })
    $riwayah = if ($pieces.Count -gt 0) { $pieces[0] } else { '' }
    $style = if ($pieces.Count -gt 1) { $pieces[$pieces.Count - 1] } else { $profileLabel }

    $variants.Add([ordered]@{
      source = 'mp3quran.net'
      moshafId = $moshaf.id
      profileLabel = $profileLabel
      riwayahOrEdition = $riwayah
      style = $style
      surahTotalReportedBySource = $moshaf.surah_total
      moshafType = $moshaf.moshaf_type
      baseServer = if ($server) { "$server/" } else { $null }
      surah114Url = if ($server) { "$server/114.mp3" } else { $null }
    })
  }

  if ($variants.Count -eq 0) { continue }

  $uniqueRiwayat = @($variants | ForEach-Object { $_.riwayahOrEdition } | Where-Object { $_ } | Sort-Object -Unique)
  $uniqueStyles = @($variants | ForEach-Object { $_.style } | Where-Object { $_ } | Sort-Object -Unique)
  $uniqueProfiles = @($variants | ForEach-Object { $_.profileLabel } | Where-Object { $_ } | Sort-Object -Unique)

  $reciters.Add([ordered]@{
    id = "mp3quran-$($reciter.id)"
    fullName = Clean-Text $reciter.name
    slug = New-Slug $reciter.name
    catalogSource = 'mp3quran.net'
    letterGroup = $reciter.letter
    lastUpdatedAtSource = $reciter.date
    characteristics = [ordered]@{
      riwayatOrEditions = $uniqueRiwayat
      styles = $uniqueStyles
      availableProfilesCount = $uniqueProfiles.Count
    }
    audioMaterials = @($variants)
  })
}

$reciters = @($reciters | Sort-Object fullName)

$alquranCloudArabicAudio = New-Object System.Collections.Generic.List[object]
$seenAlq = @{}
foreach ($edition in $alquranAudioEditions.data) {
  if ($edition.language -ne 'ar') { continue }
  if ([string]$edition.type -match 'translation') { continue }
  $key = ('{0}|{1}' -f ([string]$edition.englishName).ToLowerInvariant(), [string]$edition.type)
  if ($seenAlq.ContainsKey($key)) { continue }
  $seenAlq[$key] = $true
  $alquranCloudArabicAudio.Add([ordered]@{
    identifier = $edition.identifier
    englishName = Clean-Text $edition.englishName
    arabicName = Clean-Text $edition.name
    type = $edition.type
    note = 'Доступно как аудио-издание в AlQuran Cloud для суры 114 через edition-based endpoints.'
  })
}
$alquranCloudArabicAudio = @($alquranCloudArabicAudio | Sort-Object englishName)

$equranReciters = @(
  [ordered]@{ key = '01'; fullName = 'Abdullah Al-Juhany'; surah114Url = $eq.audioFull.'01'; source = 'eQuran.id' },
  [ordered]@{ key = '02'; fullName = 'Abdul Muhsin Al-Qasim'; surah114Url = $eq.audioFull.'02'; source = 'eQuran.id' },
  [ordered]@{ key = '03'; fullName = 'Abdurrahman as-Sudais'; surah114Url = $eq.audioFull.'03'; source = 'eQuran.id' },
  [ordered]@{ key = '04'; fullName = 'Ibrahim Al-Dossari'; surah114Url = $eq.audioFull.'04'; source = 'eQuran.id' },
  [ordered]@{ key = '05'; fullName = 'Misyari Rasyid Al-Afasi'; surah114Url = $eq.audioFull.'05'; source = 'eQuran.id' },
  [ordered]@{ key = '06'; fullName = 'Yasser Al-Dosari'; surah114Url = $eq.audioFull.'06'; source = 'eQuran.id' }
)

$audioVariantsCount = (@($reciters | ForEach-Object { $_.audioMaterials.Count }) | Measure-Object -Sum).Sum

$output = [ordered]@{
  fileId = 'surah114'
  generatedAt = ([DateTime]::UtcNow.ToString('o'))
  encoding = 'utf-8'
  sourcePolicy = [ordered]@{
    primaryTextSource = 'AlQuran Cloud'
    supplementarySources = @('eQuran.id', 'mp3quran.net')
    notes = @(
      'Основной текстовый слой и переводы собраны вокруг AlQuran Cloud.',
      'Транслитерация и компактные поаятные аудиоссылки добавлены из eQuran.id.',
      'Полный каталог чтецов и ссылки на mp3 114-й суры собраны из mp3quran.net.'
    )
  }
  surah = [ordered]@{
    number = 114
    arabicName = 'الناس'
    transliteratedName = 'An-Nas'
    englishName = $alEn.englishName
    meaning = [ordered]@{
      en = $alEn.englishNameTranslation
      id = $eq.arti
      ru = 'Люди'
    }
    numberOfAyahs = $alEn.numberOfAyahs
    location = [ordered]@{
      juz = $alEn.ayahs[0].juz
      manzil = $alEn.ayahs[0].manzil
      page = $alEn.ayahs[0].page
      ruku = $alEn.ayahs[0].ruku
      hizbQuarter = $alEn.ayahs[0].hizbQuarter
    }
    classification = [ordered]@{
      preferredValue = $alEn.revelationType
      sourceDisagreement = @(
        [ordered]@{ source = 'AlQuran Cloud'; value = $alEn.revelationType },
        [ordered]@{ source = 'eQuran.id'; value = $eq.tempatTurun },
        [ordered]@{ source = 'eQuran.id description'; value = 'Makkiyah (внутри описания источника)' }
      )
      note = 'Источники расходятся по месту ниспослания; конфликт сохранён в файле явно.'
    }
    bismillah = [ordered]@{
      arabic = 'بسم الله الرحمن الرحيم'
      transliteration = 'Bismillahir-rahmanir-rahim'
      includedInAyahCount = $false
    }
  }
  structure = [ordered]@{
    summary = 'Сура 114 строится как краткая молитва о защите: сначала идёт обращение к Аллаху, затем перечисляются Его отношения к людям, после чего раскрывается природа скрытого наущения и указывается, что оно может исходить как от джиннов, так и от людей.'
    logicalParts = @($parts)
  }
  ayahs = @($ayahs)
  recitersAudit = [ordered]@{
    surahNumberChecked = 114
    uniqueReciters = $reciters.Count
    audioVariants = $audioVariantsCount
    sourcesScanned = @('mp3quran.net', 'AlQuran Cloud', 'eQuran.id')
    deduplicationRule = 'В основном каталоге каждый чтец хранится один раз по уникальному идентификатору reciter из mp3quran.net; разные риваяты и стили объединены в массив audioMaterials.'
    knownAdditionalOpenCatalogs = [ordered]@{
      alquranCloudArabicAudioEditions = @($alquranCloudArabicAudio)
      equranIdReciters = $equranReciters
    }
  }
  reciters = @($reciters)
}

$json = $output | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))

[pscustomobject]@{
  written = $outFile
  ayahs = $ayahs.Count
  logicalParts = $parts.Count
  uniqueReciters = $reciters.Count
  audioVariants = $audioVariantsCount
} | ConvertTo-Json -Depth 5

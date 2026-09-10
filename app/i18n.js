// Interface strings for both the converter and the generated player.
//
// The player's strings are resolved at build time and written into
// content/pages.json, so the shipped package carries only the language its
// learners will read and the player needs no lookup logic of its own. The
// converter's own strings are swapped live via data-i18n attributes.
//
// Adding a language means adding one entry to each table. Placeholders are
// {name} and are substituted by the consumer, so word order can differ freely
// between languages.

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
];

// Shipped inside each package and read by player.js.
export const PLAYER_STRINGS = {
  en: {
    previous: 'Previous',
    next: 'Next',
    pageNumber: 'Page number',
    pageOf: 'Page {n} of {total}',
    goToPage: 'Go to page {n}',
    viewed: '{percent}% viewed',
    pagesViewed: 'Pages viewed',
    thumbnails: 'Show page thumbnails',
    pages: 'Pages',
    pageContent: 'Page content',
    fitPage: 'Fit page',
    fitWidth: 'Fit width',
    actualSize: 'Actual size',
    changeZoom: 'Change zoom',
    fullscreen: 'Full screen',
    fullscreenUnavailable: 'Full screen is not available here',
    connected: 'Connected',
    connectedMode: 'Connected ({mode})',
    notConnected: 'Not connected - progress is not being saved',
    lmsUnavailable: 'LMS unavailable - progress is not being saved',
    loading: 'Loading…',
    loadFailed: 'This course could not be loaded: {message}',
    resumed: 'Resumed on page {n}',
    markedComplete: 'Course marked complete',
    returnToLms: 'Return to the LMS',
    course: 'Course',
  },
  cs: {
    previous: 'Předchozí',
    next: 'Další',
    pageNumber: 'Číslo stránky',
    pageOf: 'Stránka {n} z {total}',
    goToPage: 'Přejít na stránku {n}',
    viewed: 'Zobrazeno {percent} %',
    pagesViewed: 'Zobrazené stránky',
    thumbnails: 'Zobrazit náhledy stránek',
    pages: 'Stránky',
    pageContent: 'Obsah stránky',
    fitPage: 'Přizpůsobit stránce',
    fitWidth: 'Přizpůsobit šířce',
    actualSize: 'Skutečná velikost',
    changeZoom: 'Změnit zvětšení',
    fullscreen: 'Celá obrazovka',
    fullscreenUnavailable: 'Celá obrazovka zde není dostupná',
    connected: 'Připojeno',
    connectedMode: 'Připojeno ({mode})',
    notConnected: 'Nepřipojeno - postup se neukládá',
    lmsUnavailable: 'LMS není dostupný - postup se neukládá',
    loading: 'Načítání…',
    loadFailed: 'Tento kurz se nepodařilo načíst: {message}',
    resumed: 'Pokračování na stránce {n}',
    markedComplete: 'Kurz byl označen jako dokončený',
    returnToLms: 'Zpět do LMS',
    course: 'Kurz',
  },
};

// Used by the converter page itself, keyed by the data-i18n attribute value.
export const UI_STRINGS = {
  en: {
    'app.title': 'PDF to SCORM',
    'app.language': 'Interface language',

    'hero.title': 'Turn a PDF into an e-learning course',
    'hero.sub': 'You get SCORM 1.2, which every LMS accepts; other formats are '
      + 'under Settings. Runs in your browser; the file is never uploaded.',
    'settings.heading': 'Settings',
    'settings.note': 'optional',
    'course.fallbackTitle': 'Course',
    'source.drop': 'Drop PDFs here, or click to browse — one or many',
    'source.hint': 'Nothing leaves your computer.',
    'source.reading': 'reading…',
    'source.page': 'page',
    'source.pages': 'pages',
    'source.notPdf': '{name} does not look like a PDF.',
    'source.locked': 'This PDF is password-protected, so it cannot be read. ' +
      'Save a copy without the password and try that one.',
    'source.corrupt': 'This PDF is damaged and cannot be read. ' +
      'Try opening it in a PDF reader and saving a fresh copy.',
    'source.openFailed': 'This PDF could not be opened: {message}',

    // What the tool worked out for itself. Shown on the first screen, because a
    // decision nobody can see is worse than no decision.
    'notice.titleFromPage': 'Course name taken from the first page: “{title}”',
    'notice.titleFromFile': 'The PDF carries no title, so the file name is ' +
      'used: “{title}”',
    'notice.language': 'The document is in {language}, so the course will be too.',
    // Language names as they read inside that sentence, which is not the same
    // as the names in the picker: Czech needs a case ending there.
    'lang.en': 'English',
    'lang.cs': 'Czech',
    'notice.scanned': 'This PDF is scanned — it holds pictures of pages, not ' +
      'text. It converts fine, but there is nothing to attach for screen readers.',
    'notice.settings': 'Anything here can be changed under Settings.',

    'course.heading': 'Course details',
    'course.title': 'Course title',
    'course.titlePlaceholder': 'Taken from the PDF if left empty',
    'course.description': 'Description',
    'course.descriptionPlaceholder': 'Shown by some LMSs in the catalogue',
    'course.identifier': 'Identifier',
    'course.identifierPlaceholder': 'derived from the title',
    'course.identifierHint': 'The file name, and the course identifier inside the '
      + 'LMS. Keep it the same when you re-convert an updated PDF: that is how '
      + 'an LMS recognises the new version as the same course and keeps '
      + 'learners\u2019 progress. Changing it starts a new course, and progress '
      + 'is lost.',
    'course.language': 'Course language',
    'course.languageHint': 'Sets the language of the buttons and labels inside the course.',
    'course.iri': 'Unique address of the course',
    'course.iriScope': 'xAPI and cmi5 only',
    'course.iriHint': 'Must be unique and never change afterwards, because reports ' +
      'recognise the course by it. Use an address on a domain of your own, such as ' +
      'https://example.com/courses/gdpr. Left empty, a stand-in is generated: it works, ' +
      'but is worth replacing.',

    'standards.heading': 'Standards to build',
    'standards.scorm12note': 'Widest LMS support. Start here if unsure.',
    'standards.scorm2004note': 'Separate completion and pass/fail, plus partial progress.',
    'standards.xapinote': 'Needs an LRS. Can record which pages were read.',
    'standards.cmi5note': 'xAPI with a defined launch and course structure.',

    'tracking.heading': 'Completion and tracking',
    'tracking.rule': 'Mark complete when',
    'tracking.ruleAll': 'every page has been viewed',
    'tracking.rulePercent': 'a share of pages has been viewed',
    'tracking.ruleLaunch': 'the course is opened',
    'tracking.threshold': 'Pages viewed (%)',
    'tracking.mastery': 'Mastery score (%)',
    'tracking.masteryHint': 'Set this only if the LMS needs a pass/fail rather than just ' +
      'complete. A page-turner has nothing to grade, so the score is the share of pages read.',
    'tracking.perPage': 'Track individual pages',
    'tracking.perPageNote': 'Reports will show which pages each person opened. '
      + 'xAPI only.',

    'images.heading': 'Page images',
    'images.dpi': 'Resolution (DPI)',
    'images.dpi96': '96 - smallest files',
    'images.dpi150': '150 - balanced',
    'images.dpi200': '200 - sharp',
    'images.dpi300': '300 - print quality, large files',
    'images.format': 'Image format',
    'images.formatWebp': 'WebP - smallest',
    'images.formatJpeg': 'JPEG - most compatible',
    'images.formatPng': 'PNG - lossless, largest',
    'images.quality': 'Quality',
    'images.qualityHint': '% — ignored for PNG.',
    'images.advanced': 'Advanced',
    'images.schemas': 'Include the schema files',
    'images.schemasNote': 'Turn this on only if your LMS refuses the package with a ' +
      'complaint about schemas. Most do not need it, and it makes every package about ' +
      '50 kB bigger.',
    'images.text': 'Include page text for screen readers',
    'images.textNote': "Each page's text travels along invisibly, so someone using a " +
      'screen reader can read the course too. Best left on.',
    'build.action': 'Build packages',
    'build.actionMany': 'Build packages for {count}',
    'build.course': '{title} ({index} of {total})',
    'build.downloadFormat': 'Download all {standard} — {count}',
    'queue.remove': 'Remove',
    'course.bulkNote': 'With several files, each course takes its name and ' +
      'language from its own PDF. Change them in the list above the button.',
    // Counted nouns, by plural category.
    'unit.course.one': 'course',
    'unit.course.other': 'courses',
    'build.reading': 'Reading the PDF…',
    'build.rendering': 'Rendering page {done} of {total}…',
    'build.packaging': 'Packaging {standard}…',
    'build.done': 'Done — {count} packages built.',
    'build.noStandards': 'Pick at least one standard to build.',
    'build.results': 'Packages',
    'build.download': 'Download',
    'build.downloadAll': 'Download all as one zip',
    'build.uploadHint': 'Upload one course ZIP to your LMS and do not unzip it: ' +
      'SCORM is not a single file, it is that ZIP, and what makes it SCORM is ' +
      'the imsmanifest.xml inside it.',
    'build.bundleHint': 'A combined download (all formats, or one ZIP per format) ' +
      'is only an envelope holding several course packages — unzip that one, and ' +
      'upload the individual ZIPs from inside it.',
    'build.unzipWarning': 'If your browser unzips downloads on its own (Safari does, ' +
      'by default), an LMS cannot take the unpacked folder — download it again or ' +
      'turn that off.',
    'build.bundleFailed': 'Could not bundle the packages: {message}',
    'build.preview': 'Rendered pages',
    'build.more': '+{count} more',

    'optional': 'optional',
    'footer': 'Built with pdf.js and JSZip, both bundled locally so the converter ' +
      'works offline.',
  },
  cs: {
    'app.title': 'PDF do SCORM',
    'app.language': 'Jazyk rozhraní',

    'hero.title': 'Udělejte z PDF e-learningový kurz',
    'hero.sub': 'Vznikne SCORM 1.2, který bere každý LMS. Další formáty jsou '
      + 'v Nastavení. Běží ve vašem prohlížeči, soubor se nikam neodesílá.',
    'settings.heading': 'Nastavení',
    'settings.note': 'nepovinné',
    'course.fallbackTitle': 'Kurz',
    'source.drop': 'Přetáhněte sem PDF — jedno nebo víc — nebo klikněte pro výběr',
    'source.hint': 'Nic neopustí váš počítač.',
    'source.reading': 'čtení…',
    'source.page': 'stránka',
    'source.pages': 'stránek',
    'source.notPdf': 'Soubor {name} nevypadá jako PDF.',
    'source.locked': 'Toto PDF je chráněné heslem, takže se nedá přečíst. ' +
      'Uložte si kopii bez hesla a zkuste tu.',
    'source.corrupt': 'Toto PDF je poškozené a nedá se přečíst. ' +
      'Zkuste ho otevřít v prohlížeči PDF a uložit znovu.',
    'source.openFailed': 'Toto PDF se nepodařilo otevřít: {message}',

    // Co si nástroj zjistil sám. Ukazuje se na první obrazovce, protože
    // rozhodnutí, které nikdo nevidí, je horší než žádné.
    'notice.titleFromPage': 'Název kurzu jsme vzali z první stránky: „{title}“',
    'notice.titleFromFile': 'PDF nemá vlastní název, použil se název ' +
      'souboru: „{title}“',
    'notice.language': 'Dokument je v {language}, kurz bude taky.',
    // Skloněné do té věty — v nabídce jazyků stojí „Angličtina“, tady musí být
    // „v angličtině“.
    'lang.en': 'angličtině',
    'lang.cs': 'češtině',
    'notice.scanned': 'Tohle PDF je naskenované — jsou to obrázky stránek, ne ' +
      'text. Převede se v pořádku, ale není co přiložit pro čtečky obrazovky.',
    'notice.settings': 'Cokoli z toho můžete změnit v Nastavení.',

    'course.heading': 'Údaje o kurzu',
    'course.title': 'Název kurzu',
    'course.titlePlaceholder': 'Pokud necháte prázdné, převezme se z PDF',
    'course.description': 'Popis',
    'course.descriptionPlaceholder': 'Některé LMS jej zobrazují v katalogu',
    'course.identifier': 'Identifikátor',
    'course.identifierPlaceholder': 'odvozeno z názvu',
    'course.identifierHint': 'Název souboru a označení kurzu v LMS. Když budete '
      + 'převádět opravené PDF, nechte ho stejný — podle něj LMS pozná, že jde '
      + 'o novou verzi téhož kurzu, a zachová lidem rozdělanou práci. Změna '
      + 'znamená nový kurz a postup se ztratí.',
    'course.language': 'Jazyk kurzu',
    'course.languageHint': 'Určuje jazyk tlačítek a popisků uvnitř kurzu.',
    'course.iri': 'Jednoznačná adresa kurzu',
    'course.iriScope': 'jen pro xAPI a cmi5',
    'course.iriHint': 'Musí být jedinečná a už se nikdy nemění, protože podle ní kurz ' +
      'poznávají reporty. Použijte adresu na vlastní doméně, třeba ' +
      'https://example.com/kurzy/gdpr. Když pole necháte prázdné, vyrobí se náhradní: ' +
      'funguje, ale je lepší ji nahradit.',

    'standards.heading': 'Formáty k vytvoření',
    'standards.scorm12note': 'Nejširší podpora v LMS. Pokud si nejste jistí, začněte tímto.',
    'standards.scorm2004note': 'Odděluje dokončení a hodnocení, umí i průběžný postup.',
    'standards.xapinote': 'Vyžaduje LRS. Umí zaznamenat, které stránky byly přečteny.',
    'standards.cmi5note': 'xAPI s definovaným spuštěním a strukturou kurzu.',

    'tracking.heading': 'Dokončení a sledování',
    'tracking.rule': 'Označit jako dokončené, když',
    'tracking.ruleAll': 'jsou zobrazeny všechny stránky',
    'tracking.rulePercent': 'je zobrazena část stránek',
    'tracking.ruleLaunch': 'se kurz otevře',
    'tracking.threshold': 'Zobrazené stránky (%)',
    'tracking.mastery': 'Hranice úspěšnosti (%)',
    'tracking.masteryHint': 'Nastavte jen tehdy, když LMS potřebuje výsledek prošel/neprošel, ' +
      'a nikoli jen dokončení. Prohlížení dokumentu není z čeho známkovat, skóre proto ' +
      'odpovídá podílu přečtených stránek.',
    'tracking.perPage': 'Sledovat jednotlivé stránky',
    'tracking.perPageNote': 'V reportech bude vidět, které stránky si kdo otevřel. '
      + 'Funguje jen u xAPI.',

    'images.heading': 'Obrázky stránek',
    'images.dpi': 'Rozlišení (DPI)',
    'images.dpi96': '96 - nejmenší soubory',
    'images.dpi150': '150 - vyvážené',
    'images.dpi200': '200 - ostré',
    'images.dpi300': '300 - tisková kvalita, velké soubory',
    'images.format': 'Formát obrázků',
    'images.formatWebp': 'WebP - nejmenší',
    'images.formatJpeg': 'JPEG - nejlépe podporovaný',
    'images.formatPng': 'PNG - bezeztrátový, největší',
    'images.quality': 'Kvalita',
    'images.qualityHint': ' % — u PNG se neuplatní.',
    'images.advanced': 'Pokročilé',
    'images.schemas': 'Přiložit soubory se schématy',
    'images.schemasNote': 'Zapněte jen tehdy, když váš LMS balíček odmítne s chybou ' +
      'o schématech. Většina LMS to nepotřebuje a každý balíček se zvětší asi o 50 kB.',
    'images.text': 'Přiložit text stránek pro čtečky obrazovky',
    'images.textNote': 'Text každé stránky putuje s kurzem skrytě, aby si ho mohl ' +
      'přečíst i někdo, kdo používá čtečku obrazovky. Doporučujeme nechat zapnuté.',
    'build.action': 'Vytvořit balíčky',
    'build.actionMany': 'Vytvořit balíčky pro {count}',
    'build.course': '{title} ({index} z {total})',
    'build.downloadFormat': 'Stáhnout vše {standard} — {count}',
    'queue.remove': 'Odebrat',
    'course.bulkNote': 'U více souborů dostane každý kurz název a jazyk ze ' +
      'svého PDF. Upravíte je v seznamu nad tlačítkem.',
    // Počítaná podstatná jména podle tvaru množného čísla.
    'unit.course.one': 'kurz',
    'unit.course.few': 'kurzy',
    'unit.course.other': 'kurzů',
    'build.reading': 'Čtení PDF…',
    'build.rendering': 'Vykreslování stránky {done} z {total}…',
    'build.packaging': 'Balení {standard}…',
    'build.done': 'Hotovo — vytvořeno balíčků: {count}.',
    'build.noStandards': 'Vyberte alespoň jeden formát.',
    'build.results': 'Balíčky',
    'build.download': 'Stáhnout',
    'build.downloadAll': 'Stáhnout vše v jednom ZIP',
    'build.uploadHint': 'Do LMS nahrajte ZIP jednoho kurzu a nerozbalujte ho: ' +
      'SCORM není jeden soubor, je to právě ten ZIP, a dělá z něj SCORM ' +
      'soubor imsmanifest.xml uvnitř.',
    'build.bundleHint': 'Sbalené stažení (vše najednou nebo jeden ZIP na formát) ' +
      'je jen obálka s více balíčky — tu rozbalte a do LMS nahrajte jednotlivé ' +
      'ZIPy z ní.',
    'build.unzipWarning': 'Pokud prohlížeč rozbaluje stažené soubory sám (Safari to ' +
      've výchozím stavu dělá), rozbalenou složku LMS nevezme — stáhněte ZIP znovu ' +
      'nebo to v prohlížeči vypněte.',
    'build.bundleFailed': 'Balíčky se nepodařilo spojit: {message}',
    'build.preview': 'Vykreslené stránky',
    'build.more': 'a další: {count}',

    'optional': 'nepovinné',
    'footer': 'Postaveno na pdf.js a JSZip. Obě knihovny jsou přiloženy lokálně, ' +
      'takže převodník funguje i bez internetu.',
  },
};

/** Substitutes {name} placeholders. */
export function fill(template, values) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    (values && key in values ? String(values[key]) : whole));
}

/**
 * Resolves a language tag such as "cs-CZ" to a table we have, falling back to
 * the base subtag and then to English.
 */
export function resolve(tag, table) {
  const wanted = String(tag || '').toLowerCase();
  if (table[wanted]) return wanted;
  const base = wanted.split(/[-_]/)[0];
  if (table[base]) return base;
  return 'en';
}

/** The player string set for a course language, always complete. */
export function playerStrings(languageTag) {
  const code = resolve(languageTag, PLAYER_STRINGS);
  // Merged over English so a partially translated table can never leave a
  // button with no label.
  return { ...PLAYER_STRINGS.en, ...PLAYER_STRINGS[code] };
}

export function uiStrings(languageTag) {
  const code = resolve(languageTag, UI_STRINGS);
  return { ...UI_STRINGS.en, ...UI_STRINGS[code] };
}

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
    notConnected: 'Not connected',
    lmsUnavailable: 'LMS unavailable',
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
    notConnected: 'Nepřipojeno',
    lmsUnavailable: 'LMS není dostupný',
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
    'app.tagline': 'Turn a PDF into a SCORM 1.2, SCORM 2004, xAPI or cmi5 course. ' +
      'Everything runs in this browser tab — the file is never uploaded.',
    'app.language': 'Interface language',

    'source.heading': 'Choose a PDF',
    'source.drop': 'Drop a PDF here, or click to browse',
    'source.hint': 'Nothing leaves your computer.',
    'source.reading': 'reading…',
    'source.page': 'page',
    'source.pages': 'pages',
    'source.notPdf': '{name} does not look like a PDF.',
    'source.openFailed': 'This PDF could not be opened: {message}. ' +
      'A password-protected or corrupt file will fail here.',

    'course.heading': 'Course details',
    'course.title': 'Course title',
    'course.titlePlaceholder': 'Taken from the PDF if left empty',
    'course.description': 'Description',
    'course.descriptionPlaceholder': 'Shown by some LMSs in the catalogue',
    'course.identifier': 'Identifier',
    'course.identifierPlaceholder': 'derived from the title',
    'course.identifierHint': 'Used as the file name, and as the course identifier '
      + 'inside the LMS.',
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

    'build.heading': 'Build',
    'build.action': 'Build packages',
    'build.reading': 'Reading the PDF…',
    'build.rendering': 'Rendering page {done} of {total}…',
    'build.packaging': 'Packaging {standard}…',
    'build.done': 'Done — {count} packages built.',
    'build.noStandards': 'Pick at least one standard to build.',
    'build.results': 'Packages',
    'build.download': 'Download',
    'build.downloadAll': 'Download all as one zip',
    'build.bundleFailed': 'Could not bundle the packages: {message}',
    'build.preview': 'Rendered pages',
    'build.more': '+{count} more',

    'optional': 'optional',
    'footer': 'Built with pdf.js and JSZip, both bundled locally so the converter ' +
      'works offline.',
  },
  cs: {
    'app.title': 'PDF do SCORM',
    'app.tagline': 'Převeďte PDF na kurz ve formátu SCORM 1.2, SCORM 2004, xAPI nebo cmi5. ' +
      'Vše běží v tomto okně prohlížeče — soubor se nikam neodesílá.',
    'app.language': 'Jazyk rozhraní',

    'source.heading': 'Vyberte PDF',
    'source.drop': 'Přetáhněte sem PDF nebo klikněte pro výběr',
    'source.hint': 'Nic neopustí váš počítač.',
    'source.reading': 'čtení…',
    'source.page': 'stránka',
    'source.pages': 'stránek',
    'source.notPdf': 'Soubor {name} nevypadá jako PDF.',
    'source.openFailed': 'Toto PDF se nepodařilo otevřít: {message}. ' +
      'Soubor chráněný heslem nebo poškozený soubor zde selže.',

    'course.heading': 'Údaje o kurzu',
    'course.title': 'Název kurzu',
    'course.titlePlaceholder': 'Pokud necháte prázdné, převezme se z PDF',
    'course.description': 'Popis',
    'course.descriptionPlaceholder': 'Některé LMS jej zobrazují v katalogu',
    'course.identifier': 'Identifikátor',
    'course.identifierPlaceholder': 'odvozeno z názvu',
    'course.identifierHint': 'Použije se jako název souboru a jako označení kurzu '
      + 'uvnitř LMS.',
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

    'build.heading': 'Vytvoření',
    'build.action': 'Vytvořit balíčky',
    'build.reading': 'Čtení PDF…',
    'build.rendering': 'Vykreslování stránky {done} z {total}…',
    'build.packaging': 'Balení {standard}…',
    'build.done': 'Hotovo — vytvořeno balíčků: {count}.',
    'build.noStandards': 'Vyberte alespoň jeden formát.',
    'build.results': 'Balíčky',
    'build.download': 'Stáhnout',
    'build.downloadAll': 'Stáhnout vše v jednom ZIP',
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

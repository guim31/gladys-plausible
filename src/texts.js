// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs.
// Four languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './plausible/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// What is missing in the configuration (src/config.js missingCredentials).
export const CONNECTION_TEXT = {
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:8000',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:8000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:8000',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:8000',
  },
  noKey: {
    en: 'Paste a Stats API key (Plausible: Settings → API keys).',
    fr: 'Collez une clé « Stats API » (Plausible : Settings → API keys).',
    de: 'Füge einen „Stats API“-Schlüssel ein (Plausible: Settings → API keys).',
    es: 'Pegue una clave «Stats API» (Plausible: Settings → API keys).',
  },
  noSites: {
    en: 'Enter the domains of your sites, as in Plausible.',
    fr: 'Indiquez les domaines de vos sites, comme dans Plausible.',
    de: 'Gib die Domains deiner Websites an, wie in Plausible.',
    es: 'Indique los dominios de sus sitios, como en Plausible.',
  },
};

// One short explanation per error kind (src/plausible/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Plausible does not answer',
    fr: 'Plausible ne répond pas',
    de: 'Plausible antwortet nicht',
    es: 'Plausible no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key refused, or no domain known to Plausible',
    fr: "clé d'API refusée, ou aucun domaine connu de Plausible",
    de: 'API-Schlüssel abgelehnt, oder keine Domain ist Plausible bekannt',
    es: 'clave de API rechazada, o ningún dominio conocido por Plausible',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests: choose a longer interval, or follow fewer sites',
    fr: 'trop de requêtes : choisissez un intervalle plus long, ou moins de sites',
    de: 'zu viele Anfragen: Wähle ein längeres Intervall oder weniger Websites',
    es: 'demasiadas peticiones: elija un intervalo más largo o menos sitios',
  },
  [ERROR_KINDS.NOT_PLAUSIBLE]: {
    en: 'no Plausible Stats API at this address (Plausible 2.1 or later)',
    fr: 'aucune API Stats de Plausible à cette adresse (Plausible 2.1 ou plus)',
    de: 'keine Plausible-Stats-API unter dieser Adresse (Plausible 2.1 oder neuer)',
    es: 'no hay API Stats de Plausible en esta dirección (Plausible 2.1 o posterior)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    websites: (n) => `${n} site(s)`,
    visitors: (n) => `${n} visitor(s) today`,
    active: (n) => `${n} right now`,
    refused: (list) => `not readable with this key: ${list}`,
  },
  fr: {
    ok: 'Connecté',
    websites: (n) => `${n} site(s)`,
    visitors: (n) => `${n} visiteur(s) aujourd'hui`,
    active: (n) => `${n} en ce moment`,
    refused: (list) => `illisibles avec cette clé : ${list}`,
  },
  de: {
    ok: 'Verbunden',
    websites: (n) => `${n} Website(s)`,
    visitors: (n) => `${n} Besucher heute`,
    active: (n) => `${n} gerade jetzt`,
    refused: (list) => `mit diesem Schlüssel nicht lesbar: ${list}`,
  },
  es: {
    ok: 'Conectado',
    websites: (n) => `${n} sitio(s)`,
    visitors: (n) => `${n} visitante(s) hoy`,
    active: (n) => `${n} ahora mismo`,
    refused: (list) => `no legibles con esta clave: ${list}`,
  },
};

export const ACTION_TEXT = {
  unknownWebsite: {
    en: 'This device is not a site followed in Plausible.',
    fr: "Cet appareil n'est pas un site suivi dans Plausible.",
    de: 'Dieses Gerät ist keine in Plausible verfolgte Website.',
    es: 'Este dispositivo no es un sitio seguido en Plausible.',
  },
  refusedWebsite: {
    en: 'Plausible refuses this site to the key: check its domain.',
    fr: 'Plausible refuse ce site à la clé : vérifiez son domaine.',
    de: 'Plausible verweigert diese Website für den Schlüssel: Prüfe ihre Domain.',
    es: 'Plausible rechaza este sitio para la clave: compruebe su dominio.',
  },
};

// The `sentence` output of "Read the figures of a site".
export const SENTENCE_TEXT = {
  en: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} visitor(s) and ${pageviews} page view(s) today`,
    active: (n) => `${n} right now`,
    top: (page) => `most viewed page ${page}`,
  },
  fr: {
    today: (name, visitors, pageviews) =>
      `${name} : ${visitors} visiteur(s) et ${pageviews} page(s) vue(s) aujourd'hui`,
    active: (n) => `${n} en ce moment`,
    top: (page) => `page la plus vue ${page}`,
  },
  de: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} Besucher und ${pageviews} Seitenaufrufe heute`,
    active: (n) => `${n} gerade jetzt`,
    top: (page) => `meistbesuchte Seite ${page}`,
  },
  es: {
    today: (name, visitors, pageviews) =>
      `${name}: ${visitors} visitante(s) y ${pageviews} página(s) vista(s) hoy`,
    active: (n) => `${n} ahora mismo`,
    top: (page) => `página más vista ${page}`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

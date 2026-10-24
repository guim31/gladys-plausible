// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `plausible_today`.
//
// The use case: a glance at the wall tablet tells how the day goes on the
// websites — visitors right now, visitors, visits and page views today — and,
// for several websites, which one draws the visitors. One website: its most
// viewed page of the day under the figures.
//
// Every website by default, or the ones chosen in the widget settings
// (devices added to Gladys). The figures are sent as values, not bound to
// device features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): four tiles, one text when Plausible does not
// answer, one caption (one website) or one status list of ten rows at most
// (several), a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { missingCredentials } from './config.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, labelled, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Fill in your Plausible key and sites in the configuration of the integration.',
    fr: "Renseignez votre clé et vos sites Plausible dans la configuration de l'intégration.",
    de: 'Trage deinen Plausible-Schlüssel und deine Websites in der Konfiguration der Integration ein.',
    es: 'Indique su clave y sus sitios de Plausible en la configuración de la integración.',
  },
  empty: {
    en: 'No readable site: check the domains in the configuration.',
    fr: 'Aucun site lisible : vérifiez les domaines dans la configuration.',
    de: 'Keine lesbare Website: Prüfe die Domains in der Konfiguration.',
    es: 'Ningún sitio legible: compruebe los dominios en la configuración.',
  },
  active: { en: 'Right now', fr: 'En ce moment', de: 'Gerade jetzt', es: 'Ahora mismo' },
  visitors: { en: 'Visitors', fr: 'Visiteurs', de: 'Besucher', es: 'Visitantes' },
  visits: { en: 'Visits', fr: 'Visites', de: 'Besuche', es: 'Visitas' },
  pageviews: { en: 'Page views', fr: 'Pages vues', de: 'Seitenaufrufe', es: 'Páginas vistas' },
  now: { en: 'now', fr: 'en ligne', de: 'jetzt', es: 'ahora' },
  top: {
    en: 'Most viewed page',
    fr: 'Page la plus vue',
    de: 'Meistbesuchte Seite',
    es: 'Página más vista',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Plausible read again.',
    fr: 'Plausible relu.',
    de: 'Plausible neu gelesen.',
    es: 'Plausible leído de nuevo.',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The sites the widget shows: the chosen devices, or every site; not the refused ones. */
export function selectSites(hub, settings) {
  const chosen = [settings?.websites ?? []].flat().filter((id) => typeof id === 'string' && id);
  const sites =
    chosen.length === 0
      ? [...hub.sites.values()]
      : [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
  return sites.filter((site) => !site.refused);
}

const visitorsOf = (site) => site.today?.visitors ?? 0;

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client || missingCredentials(hub.config)) {
    return message(TEXT.pick, language);
  }
  const sites = selectSites(hub, settings).sort(
    (a, b) =>
      visitorsOf(b) - visitorsOf(a) ||
      (b.active ?? 0) - (a.active ?? 0) ||
      a.name.localeCompare(b.name),
  );
  if (sites.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const sum = (read) => sites.reduce((total, site) => total + (read(site) ?? 0), 0);
  const active = sum((site) => site.active);
  const components = [
    {
      type: 'value',
      value: active,
      label: pick(TEXT.active, language),
      icon: 'radio',
      color: active > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: sum(visitorsOf),
      label: pick(TEXT.visitors, language),
      icon: 'users',
      color: WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      value: sum((site) => site.today?.visits),
      label: pick(TEXT.visits, language),
      icon: 'log-in',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: sum((site) => site.today?.pageviews),
      label: pick(TEXT.pageviews, language),
      icon: 'file-text',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (sites.length === 1) {
    if (sites[0].topPage) {
      components.push({
        type: 'text',
        variant: 'caption',
        text: fit(labelled(pick(TEXT.top, language), sites[0].topPage, language), 80),
      });
    }
  } else if (sites.length > 1) {
    const shown = sites.length > MAX_ROWS ? sites.slice(0, MAX_ROWS - 1) : sites;
    const now = pick(TEXT.now, language);
    const items = shown.map((site) => ({
      label: fit(site.name, 40),
      value: fit(`${visitorsOf(site)} · ${site.active ?? 0} ${now}`, 40),
      icon: (site.active ?? 0) > 0 ? 'radio' : 'globe',
      color: (site.active ?? 0) > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    }));
    if (sites.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${sites.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  // Not more often than every 15 seconds: Plausible may limit the requests.
  await hub.refreshIfStale();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};

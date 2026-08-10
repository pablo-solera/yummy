import * as cheerio from "cheerio";
import type { MenuItem, RestaurantMenu, Scraper } from "./types.js";

/**
 * La Grosella publica la oferta para oficinas en su propia portada, renderizada
 * en servidor. No se usa su WooCommerce Store API (`/wp-json/wc/store/v1`)
 * aunque esté abierta: devuelve el catálogo histórico completo (cientos de
 * primeros y segundos) sin ningún filtro fiable por el que acotar la carta
 * vigente, ni siquiera por estado de stock.
 */
const SITE_URL = "https://lagrosella.es/";
/** La portada ronda los 320 KB, por lo que se da algo más de margen. */
const REQUEST_TIMEOUT_MS = 15_000;

const USER_AGENT = "Mozilla/5.0 (compatible; menu-bot/1.0)";

/**
 * A diferencia del resto de restaurantes, La Grosella no ofrece un menú del
 * día sino una carta que se renueva por semanas, y no tiene local en
 * Alcobendas: reparte desde San Sebastián de los Reyes.
 */
const NOTE =
  "Carta semanal para oficinas (no es un menú diario). Reparto en Alcobendas desde San Sebastián de los Reyes.";

/** Encabezado que precede al bloque de acordeones con la carta de oficinas. */
const SECTION_HEADING = /^carta de la semana/i;

/** Conjunto de nodos devuelto por `$(...)`, sin depender del tipo de elemento
 * concreto que exponga la versión de cheerio en uso. */
type CheerioSelection = ReturnType<cheerio.CheerioAPI>;

async function fetchHomepage(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(SITE_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al llamar a ${SITE_URL}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Localiza el bloque `.toggles` que contiene la carta para oficinas.
 *
 * El anclaje en el encabezado es imprescindible: la portada incluye otros
 * bloques `.toggles` (por ejemplo el de zonas de reparto del pie de página),
 * de modo que un selector global capturaría contenido que no son platos.
 */
function findOfficeCartaSection($: cheerio.CheerioAPI): CheerioSelection | undefined {
  let section: CheerioSelection | undefined;

  $("h1, h2, h3, h4").each((_, heading) => {
    if (section) return;
    if (!SECTION_HEADING.test($(heading).text().trim())) return;

    const candidate = $(heading).closest(".wpb_text_column").nextAll(".toggles").first();
    if (candidate.length > 0) {
      section = candidate;
    }
  });

  return section;
}

/**
 * Extrae los platos de cada acordeón. Cada `.toggle` es una categoría
 * ("Ensaladas", "Primeros platos", ...) cuyo contenido es una lista de
 * enlaces, uno por plato. Las categorías sin platos se descartan: la web
 * mantiene alguna publicada aunque esté vacía.
 */
function parseCarta($: cheerio.CheerioAPI, section: CheerioSelection): MenuItem[] {
  const items: MenuItem[] = [];

  section.find(".toggle").each((_, toggle) => {
    const category = $(toggle).find(".toggle-title").first().text().trim();
    if (!category) return;

    $(toggle)
      .find("li a")
      .each((_, link) => {
        const name = $(link).text().trim();
        if (!name) return;
        items.push({ category, name });
      });
  });

  return items;
}

export const laGrosellaScraper: Scraper = {
  name: "La Grosella (a oficinas)",

  async fetchMenu(): Promise<RestaurantMenu> {
    try {
      const html = await fetchHomepage();
      const $ = cheerio.load(html);

      const section = findOfficeCartaSection($);
      if (!section) {
        return {
          restaurant: laGrosellaScraper.name,
          items: [],
          available: false,
          note: "No se encontró la sección de carta para oficinas en la web (puede haber cambiado la maquetación).",
        };
      }

      const items = parseCarta($, section);

      if (items.length === 0) {
        return {
          restaurant: laGrosellaScraper.name,
          items: [],
          available: false,
          note: "La sección de carta para oficinas no contiene platos en este momento.",
        };
      }

      return {
        restaurant: laGrosellaScraper.name,
        items,
        available: true,
        note: NOTE,
      };
    } catch (err) {
      return {
        restaurant: laGrosellaScraper.name,
        items: [],
        available: false,
        note: `Error al obtener el menú: ${(err as Error).message}`,
      };
    }
  },
};

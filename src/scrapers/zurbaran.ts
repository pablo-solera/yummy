import * as cheerio from "cheerio";
import type { MenuItem, RestaurantMenu, Scraper } from "./types.js";

/**
 * La web de Zurbarán (WordPress) no publica el menú en su propio HTML: lo
 * inyecta por JavaScript desde la plataforma TuMenuEn, que devuelve el menú
 * del día ya renderizado como fragmento de HTML.
 */
const ENDPOINT = "https://tumenuen.com/php_includes/menu_endpoint.php";
/** Identificador del restaurante dentro de TuMenuEn (Zurbarán, Alcobendas). */
const CLIENT_ID = "592";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * El servidor de TuMenuEn está detrás de ModSecurity y responde 406 ante
 * User-Agents que considera automatizados (entre ellos el de curl por
 * defecto). El User-Agent que ya usan el resto de scrapers del proyecto sí es
 * aceptado, así que se mantiene por coherencia.
 */
const USER_AGENT = "Mozilla/5.0 (compatible; menu-bot/1.0)";

async function fetchMenuHtml(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ client: CLIENT_ID }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al llamar a ${ENDPOINT}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Las categorías llegan en mayúsculas ("PRIMEROS", "SEGUNDOS", "POSTRES").
 * Se pasan a "Primeros"/"Segundos"/"Postres" para que la salida sea
 * consistente con la del resto de scrapers.
 */
function normalizeCategory(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
}

/**
 * Extrae los platos del fragmento devuelto por TuMenuEn.
 *
 * La estructura es una tabla en la que cada fila contiene un
 * `<label class="titulo_plato">` con el nombre de la categoría y un
 * `<div class="capa_resultado_platos">` con los platos de esa categoría
 * separados por `<BR>`.
 */
function parseMenuHtml(html: string): MenuItem[] {
  const $ = cheerio.load(html);
  const items: MenuItem[] = [];

  $(".capa_resultado_platos").each((_, container) => {
    const category = normalizeCategory(
      $(container).closest("td").find("label.titulo_plato").first().text(),
    );
    if (!category) return;

    const inner = $(container).html() ?? "";
    for (const fragment of inner.split(/<br\s*\/?>/i)) {
      // Cada fragmento puede llevar etiquetas sueltas; se reduce a texto plano.
      const name = cheerio.load(fragment).root().text().trim();
      if (!name) continue;
      items.push({ category, name });
    }
  });

  return items;
}

/**
 * El fragmento incluye un encabezado con la fecha del menú publicado
 * (p.ej. "Lunes 10.08.2026"). Se devuelve para poder avisar cuando el menú
 * mostrado no corresponde al día actual: Zurbarán cierra los fines de semana,
 * así que fuera de laborables el endpoint sigue sirviendo el último menú
 * publicado.
 */
function extractPublishedDate(html: string): string | undefined {
  const $ = cheerio.load(html);
  let date: string | undefined;

  $(".titulo_estadistica").each((_, el) => {
    const text = $(el).text().trim();
    if (/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(text)) {
      date = text;
    }
  });

  return date;
}

/** Fecha de hoy en el mismo formato que publica TuMenuEn: "DD.MM.YYYY". */
function todayAsDottedDate(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${now.getFullYear()}`;
}

function buildNote(publishedDate: string | undefined): string | undefined {
  if (!publishedDate) return undefined;
  if (publishedDate.includes(todayAsDottedDate())) return publishedDate;
  return `${publishedDate} (último menú publicado; no corresponde al día de hoy)`;
}

export const zurbaranScraper: Scraper = {
  name: "Restaurante Zurbarán (Alcobendas)",

  async fetchMenu(): Promise<RestaurantMenu> {
    try {
      const html = await fetchMenuHtml();

      if (!html.trim()) {
        return {
          restaurant: zurbaranScraper.name,
          items: [],
          available: false,
          note: "El servidor no devolvió contenido de menú.",
        };
      }

      const items = parseMenuHtml(html);

      if (items.length === 0) {
        const plainText = cheerio.load(html).root().text().trim();
        return {
          restaurant: zurbaranScraper.name,
          items: [],
          available: false,
          note: plainText.slice(0, 300) || "Menú no disponible en este momento.",
        };
      }

      return {
        restaurant: zurbaranScraper.name,
        items,
        available: true,
        note: buildNote(extractPublishedDate(html)),
      };
    } catch (err) {
      return {
        restaurant: zurbaranScraper.name,
        items: [],
        available: false,
        note: `Error al obtener el menú: ${(err as Error).message}`,
      };
    }
  },
};

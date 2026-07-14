import * as cheerio from "cheerio";
import type { MenuItem, RestaurantMenu, Scraper } from "./types.js";

const BASE_URL = "https://restaurantesjumar.com/alcobendas";
const AJAX_URL = `${BASE_URL}/wp-admin/admin-ajax.php`;
const CODIGO_POSTAL = "28108"; // Alcobendas
const REQUEST_TIMEOUT_MS = 10_000;

interface MenuOnlineResponse {
  ce?: string;
  html?: string;
  configuracion?: unknown;
}

async function postAjax(body: URLSearchParams): Promise<MenuOnlineResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(AJAX_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (compatible; menu-bot/1.0)",
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} al llamar a ${AJAX_URL}`);
    }
    return (await res.json()) as MenuOnlineResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/** Categorías del menú que se muestran (en este orden). El resto (Guarnición,
 * Bebida adicional, Opciones/checkboxes) se omite por ser extras opcionales
 * o duplicados con recargo. */
const INCLUDED_CATEGORIES = ["Primer plato", "Segundo plato", "Postre", "Bebida"];

/**
 * Parsea el HTML devuelto por el paso "menu" y extrae categorías/platos.
 *
 * La estructura real usa, dentro de `.menudehoy`, un `<select
 * data-categoria="Primer plato">` (etc.) por cada categoría del menú, con un
 * `<option>` por plato disponible ese día. Algunos `<select>` incluyen además
 * un `<optgroup>` con platos "alternativos" (p.ej. los del segundo plato
 * ofrecidos también como primer plato con recargo); esos se excluyen para no
 * duplicar platos que ya aparecen en su categoría principal.
 */
function parseMenuHtml(html: string): MenuItem[] {
  const $ = cheerio.load(html);
  const items: MenuItem[] = [];

  $("select[data-categoria]").each((_, select) => {
    const category = $(select).attr("data-categoria")?.trim();
    if (!category || !INCLUDED_CATEGORIES.includes(category)) return;

    $(select)
      .children("option")
      .each((_, option) => {
        const name = $(option).text().trim();
        // Algunas opciones son placeholders vacíos o un simple "." (error de
        // carga de datos del propio restaurante); se descartan.
        if (!name || name === ".") return;
        items.push({ category, name });
      });
  });

  // Ordenar según el orden definido en INCLUDED_CATEGORIES, preservando el
  // orden de aparición dentro de cada categoría.
  return items.sort(
    (a, b) =>
      INCLUDED_CATEGORIES.indexOf(a.category ?? "") - INCLUDED_CATEGORIES.indexOf(b.category ?? ""),
  );
}

export const jumarScraper: Scraper = {
  name: "Restaurante Jumar (Alcobendas)",

  async fetchMenu(): Promise<RestaurantMenu> {
    try {
      // Paso 1: enviar código postal para obtener el "restaurante" asociado
      const step1 = await postAjax(
        new URLSearchParams({
          action: "menuonline",
          uniqid: "menubot",
          cpinicial: "",
          paso: "codigopostal",
          configuracion: JSON.stringify({ codigopostal: CODIGO_POSTAL }),
        }),
      );

      const configuracion =
        typeof step1.configuracion === "object" && step1.configuracion !== null
          ? (step1.configuracion as Record<string, unknown>)
          : { codigopostal: CODIGO_POSTAL };

      // Paso 2: pedir el menú del día con la configuración acumulada
      const step2 = await postAjax(
        new URLSearchParams({
          action: "menuonline",
          uniqid: "menubot",
          cpinicial: "",
          paso: "menu",
          configuracion: JSON.stringify(configuracion),
        }),
      );

      const html = step2.html ?? "";
      if (!html) {
        return {
          restaurant: jumarScraper.name,
          items: [],
          available: false,
          note: "El servidor no devolvió contenido de menú.",
        };
      }

      const plainText = cheerio.load(html).root().text().trim();
      const looksUnavailable = /a[uú]n no est[aá]|estamos preparando|no disponible/i.test(
        plainText,
      );

      const items = parseMenuHtml(html);

      if (looksUnavailable || items.length === 0) {
        return {
          restaurant: jumarScraper.name,
          items: [],
          available: false,
          note: plainText.slice(0, 300) || "Menú no disponible en este momento.",
        };
      }

      return {
        restaurant: jumarScraper.name,
        items,
        available: true,
      };
    } catch (err) {
      return {
        restaurant: jumarScraper.name,
        items: [],
        available: false,
        note: `Error al obtener el menú: ${(err as Error).message}`,
      };
    }
  },
};

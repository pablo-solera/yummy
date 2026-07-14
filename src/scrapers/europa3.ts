import * as cheerio from "cheerio";
import type { MenuItem, RestaurantMenu, Scraper } from "./types.js";

const SITE_URL = "https://europa3restaurante.eatbu.com/";
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; menu-bot/1.0)" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} al llamar a ${url}`);
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/** Busca el enlace de descarga del PDF de "Menú" en la sección de descargas. */
function findMenuPdfUrl(html: string): string | undefined {
  const $ = cheerio.load(html);
  let menuHref: string | undefined;

  $('.menu-downloads a, a[data-button="menu-download"]').each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    const href = $(el).attr("href");
    if (!href) return;
    // Preferir el enlace cuyo texto sea exactamente "Menú" (o lo contenga)
    if (text === "menú" || text === "menu") {
      menuHref = href;
    } else if (!menuHref && text.includes("menú")) {
      menuHref = href;
    }
  });

  return menuHref;
}

/**
 * Algunos PDFs codifican el texto con una fuente que introduce un espacio
 * entre cada carácter (p.ej. "P o s t r e s" en vez de "Postres").
 * Si una línea está compuesta enteramente por tokens de un solo carácter,
 * se colapsan los espacios para reconstruir la palabra original.
 */
function collapseLetterSpacing(line: string): string {
  const tokens = line.split(/ +/).filter(Boolean);
  if (tokens.length < 3) return line;
  const allSingleChar = tokens.every((t) => t.length === 1);
  return allSingleChar ? tokens.join("") : line;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

/**
 * pdf-parse (vía pdf.js) por defecto concatena el texto en el orden en que
 * aparece dentro del stream del PDF, que no siempre coincide con el orden
 * visual de lectura (esto pasa con PDFs diseñados con cajas de texto
 * posicionadas libremente, como el de Europa III). Esta función personalizada
 * reconstruye el orden de lectura ordenando cada fragmento de texto por su
 * posición real en la página (de arriba a abajo, y de izquierda a derecha
 * dentro de cada línea).
 */
async function renderPageInReadingOrder(pageData: {
  getTextContent: (opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }) => Promise<{
    items: PdfTextItem[];
  }>;
}): Promise<string> {
  const textContent = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  });

  const items = textContent.items
    .map((item) => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
    }))
    .filter((item) => item.str.trim().length > 0);

  // Agrupar en líneas: elementos cuya coordenada Y difiere poco se consideran
  // la misma línea (el PDF puede tener pequeñas variaciones de Y dentro de
  // una misma línea visual).
  const Y_TOLERANCE = 3;
  const sortedByY = [...items].sort((a, b) => b.y - a.y);

  const lines: { y: number; items: typeof items }[] = [];
  for (const item of sortedByY) {
    const line = lines.find((l) => Math.abs(l.y - item.y) <= Y_TOLERANCE);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => {
      const sorted = line.items.sort((a, b) => a.x - b.x);
      let text = "";
      let prevEndX: number | null = null;
      for (const item of sorted) {
        if (
          prevEndX !== null &&
          !text.endsWith(" ") &&
          !item.str.startsWith(" ") &&
          item.x - prevEndX > 1
        ) {
          text += " ";
        }
        text += item.str;
        prevEndX = item.x + item.width;
      }
      return text;
    })
    .join("\n");
}

const KNOWN_CATEGORIES = ["primeros", "segundos", "postres"];

/** Líneas de ruido (avisos, pie de página, nombre repetido...) que no son platos. */
const NOISE_LINE_PATTERNS = [
  /^menú$/i,
  /^europa\s*iii$/i,
  /^restaurante$/i,
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/, // fechas tipo 13/07/26
  /^importante/i,
  /^antes de/i,
  /^nota informativa:?$/i,
  /^de guarnición/i,
  /^come$/i,
  /^como en$/i,
  /^casa$/i,
];

/**
 * Convierte el texto plano extraído del PDF (ya en orden de lectura) en una
 * lista estructurada de platos agrupados por categoría (Primeros/Segundos/
 * Postres). Se descarta cualquier línea de ruido (avisos, pie de página,
 * notas informativas, fecha, nombre del restaurante repetido, etc.) y todo
 * lo que aparezca antes de la primera categoría reconocida.
 */
function parseMenuText(rawText: string): MenuItem[] {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items: MenuItem[] = [];
  let currentCategory: string | undefined;
  let skipNextLine = false;

  for (const line of lines) {
    if (skipNextLine) {
      skipNextLine = false;
      continue;
    }

    const normalized = line.toLowerCase();

    if (KNOWN_CATEGORIES.includes(normalized)) {
      currentCategory = line[0].toUpperCase() + line.slice(1).toLowerCase();
      continue;
    }

    if (NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
      // Una línea de ruido marca el fin de la sección de platos actual
      // (p.ej. tras "Postres" aparece de nuevo "Restaurante"/"NOTA
      // INFORMATIVA:" seguido de texto que no es un plato). Reiniciamos la
      // categoría activa para no capturar ese texto por error.
      currentCategory = undefined;
      continue;
    }

    // Solo se guardan líneas mientras estemos dentro de una categoría
    // reconocida (Primeros/Segundos/Postres); todo lo anterior o posterior
    // a esas secciones (avisos, notas, pie de página) se descarta.
    if (currentCategory) {
      items.push({ category: currentCategory, name: line });
    }
  }

  return mergeWrappedItems(items);
}

/** Palabras que, al final de una línea, suelen indicar que el texto
 * continúa en la siguiente línea (preposiciones/conjunciones típicas de un
 * corte de línea a mitad de frase). */
const CONTINUATION_WORDS = new Set([
  "y",
  "o",
  "de",
  "con",
  "a",
  "en",
  "la",
  "el",
  "los",
  "las",
  "del",
  "al",
  "sin",
  "por",
  "que",
  "como",
  "su",
  "sus",
]);

function countUnclosedParens(text: string): number {
  const open = (text.match(/\(/g) ?? []).length;
  const close = (text.match(/\)/g) ?? []).length;
  return open - close;
}

/**
 * Decide si el texto acumulado de un plato parece incompleto (es decir, si
 * la siguiente línea del PDF es en realidad la continuación de este mismo
 * plato y no un plato nuevo). Esto ocurre cuando el nombre de un plato es
 * largo y el PDF lo divide en dos líneas visuales.
 */
function looksIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (countUnclosedParens(trimmed) > 0) return true;
  if (/[.!?]$/.test(trimmed)) return false;
  if (trimmed.endsWith(",") || trimmed.endsWith(":")) return true;

  const lastWord = trimmed.split(/\s+/).pop()?.toLowerCase() ?? "";
  return CONTINUATION_WORDS.has(lastWord);
}

/**
 * Fusiona items consecutivos de la misma categoría cuando el anterior
 * "parece incompleto" (ver `looksIncomplete`), uniéndolos con un salto de
 * línea en vez de dejarlos como dos platos independientes.
 */
function mergeWrappedItems(items: MenuItem[]): MenuItem[] {
  const merged: MenuItem[] = [];

  for (const item of items) {
    const prev = merged[merged.length - 1];
    if (prev && prev.category === item.category && looksIncomplete(prev.name)) {
      prev.name = `${prev.name}\n${item.name}`;
    } else {
      merged.push({ ...item });
    }
  }

  return merged;
}

export const europa3Scraper: Scraper = {
  name: "Europa III",

  async fetchMenu(): Promise<RestaurantMenu> {
    try {
      const homeRes = await fetchWithTimeout(SITE_URL);
      const html = await homeRes.text();

      const pdfUrl = findMenuPdfUrl(html);
      if (!pdfUrl) {
        return {
          restaurant: europa3Scraper.name,
          items: [],
          available: false,
          note: "No se encontró un enlace al PDF del menú en la web.",
        };
      }

      const pdfRes = await fetchWithTimeout(pdfUrl);
      const arrayBuffer = await pdfRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Import diferido: pdf-parse ejecuta código al cargar el módulo que
      // intenta leer un fichero de ejemplo si no se usa con cuidado.
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer, { pagerender: renderPageInReadingOrder });

      const text = parsed.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map(collapseLetterSpacing)
        .join("\n");

      if (!text) {
        return {
          restaurant: europa3Scraper.name,
          items: [],
          available: false,
          note: `No se pudo extraer texto del PDF (${pdfUrl}).`,
        };
      }

      const items = parseMenuText(text);

      if (items.length === 0) {
        return {
          restaurant: europa3Scraper.name,
          items: [],
          available: false,
          note: `No se pudieron identificar platos en el PDF (${pdfUrl}).`,
        };
      }

      return {
        restaurant: europa3Scraper.name,
        items,
        available: true,
        note: `Fuente: ${pdfUrl}`,
      };
    } catch (err) {
      return {
        restaurant: europa3Scraper.name,
        items: [],
        available: false,
        note: `Error al obtener el menú: ${(err as Error).message}`,
      };
    }
  },
};

import type { Scraper } from "./scrapers/types.js";
import { jumarScraper } from "./scrapers/jumar.js";
import { europa3Scraper } from "./scrapers/europa3.js";

/**
 * Lista de restaurantes activos.
 * Para añadir uno nuevo en el futuro: crea un fichero en src/scrapers/
 * que implemente la interfaz `Scraper` y añádelo aquí.
 */
export const scrapers: Scraper[] = [jumarScraper, europa3Scraper];

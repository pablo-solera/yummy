import Table from "cli-table3";
import type { RestaurantMenu } from "../scrapers/types.js";

/** Formatea los menús como tabla ASCII para consola (CLI), agrupando los
 * platos de cada categoría en una sola celda (uno por línea, con "- "). */
export function formatAsCliTable(menus: RestaurantMenu[]): string {
  const table = new Table({
    head: ["Restaurante", "Categoría", "Platos"],
    wordWrap: true,
    colWidths: [20, 15, 70],
  });

  for (const menu of menus) {
    if (!menu.available) {
      table.push([menu.restaurant, "-", menu.note ?? "No disponible"]);
      continue;
    }

    if (menu.items.length === 0) {
      table.push([menu.restaurant, "-", "Sin platos"]);
      continue;
    }

    const grouped = new Map<string, string[]>();
    for (const item of menu.items) {
      const cat = item.category ?? "Menú";
      const list = grouped.get(cat) ?? [];
      list.push(item.price ? `${item.name} — ${item.price}` : item.name);
      grouped.set(cat, list);
    }

    for (const [category, dishes] of grouped) {
      table.push([menu.restaurant, category, dishes.map((d) => `- ${d}`).join("\n")]);
    }
  }

  return table.toString();
}

/**
 * Formatea los menús como texto Markdown (MarkdownV2 de Telegram), agrupando
 * los platos por categoría con el formato:
 *
 * *Restaurante*
 *
 * *Primeros*
 * - Plato1
 * - Plato2
 */
export function formatAsMarkdown(menus: RestaurantMenu[]): string {
  const sections = menus.map((menu) => {
    const title = `*${escapeMd(menu.restaurant)}*`;

    if (!menu.available) {
      return `${title}\n_${escapeMd(menu.note ?? "No disponible")}_`;
    }

    if (menu.items.length === 0) {
      return `${title}\n_Sin platos disponibles_`;
    }

    const grouped = new Map<string, string[]>();
    for (const item of menu.items) {
      const cat = item.category ?? "Menú";
      const list = grouped.get(cat) ?? [];
      list.push(item.price ? `${item.name} — ${item.price}` : item.name);
      grouped.set(cat, list);
    }

    const body = [...grouped.entries()]
      .map(([cat, dishes]) => `*${escapeMd(cat)}*\n${dishes.map((d) => `\\- ${escapeMd(d)}`).join("\n")}`)
      .join("\n\n");

    return `${title}\n\n${body}`;
  });

  return sections.join("\n\n▬▬▬▬▬▬▬▬▬▬\n\n");
}

function escapeMd(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

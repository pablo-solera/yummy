import { scrapers } from "./config.js";
import { formatAsCliTable } from "./formatters/table.js";
import type { RestaurantMenu } from "./scrapers/types.js";

async function main() {
  console.log("Consultando menús del día...\n");

  const results = await Promise.allSettled(scrapers.map((s) => s.fetchMenu()));

  const menus: RestaurantMenu[] = results.map((result, idx) => {
    if (result.status === "fulfilled") return result.value;
    return {
      restaurant: scrapers[idx].name,
      items: [],
      available: false,
      note: `Error inesperado: ${result.reason}`,
    };
  });

  console.log(formatAsCliTable(menus));
}

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});

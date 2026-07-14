import "dotenv/config";
import { Bot } from "grammy";
import { scrapers } from "../config.js";
import { formatAsMarkdown } from "../formatters/table.js";
import type { RestaurantMenu } from "../scrapers/types.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error(
    "Falta la variable de entorno TELEGRAM_BOT_TOKEN. Crea un fichero .env (ver .env.example).",
  );
  process.exit(1);
}

const bot = new Bot(token);

async function getMenus(): Promise<RestaurantMenu[]> {
  const results = await Promise.allSettled(scrapers.map((s) => s.fetchMenu()));
  return results.map((result, idx) => {
    if (result.status === "fulfilled") return result.value;
    return {
      restaurant: scrapers[idx].name,
      items: [],
      available: false,
      note: `Error inesperado: ${result.reason}`,
    };
  });
}

bot.command("start", (ctx) =>
  ctx.reply("¡Hola! Usa /menu para consultar el menú del día de los restaurantes configurados."),
);

bot.command("menu", async (ctx) => {
  await ctx.reply("Consultando menús, un momento...");
  const menus = await getMenus();
  const text = formatAsMarkdown(menus);

  // Telegram limita mensajes a 4096 caracteres; se trocea si hace falta.
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "MarkdownV2" });
  }
});

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

bot.catch((err) => {
  console.error("Error en el bot:", err);
});

bot.start();
console.log("Bot de Telegram iniciado. Usa /menu en el chat con el bot.");

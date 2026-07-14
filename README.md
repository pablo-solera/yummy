# Yummy — Bot de menús del día

Consulta el menú del día de varios restaurantes desde la terminal o desde Telegram.

Restaurantes soportados actualmente:
- **Restaurante Jumar** (Alcobendas) — vía el widget AJAX de `restaurantesjumar.com`.
- **Europa III** — extrae el texto del PDF de menú publicado en `europa3restaurante.eatbu.com`.

## Instalación

```bash
npm install
```

## Uso por CLI

```bash
npm run menu
```

Muestra una tabla en la terminal con el menú de cada restaurante configurado.

## Uso por Telegram

1. Crea un bot con [@BotFather](https://t.me/BotFather) y copia el token.
2. Copia `.env.example` a `.env` y rellena `TELEGRAM_BOT_TOKEN`.
3. Arranca el bot:

   ```bash
   npm run bot
   ```

4. En Telegram, escribe `/menu` al bot para recibir el menú del día de todos los restaurantes.

## Añadir un nuevo restaurante

1. Crea un fichero en `src/scrapers/<nombre>.ts` que exporte un objeto que implemente la interfaz `Scraper` (ver `src/scrapers/types.ts`):

   ```ts
   export const miRestauranteScraper: Scraper = {
     name: "Mi Restaurante",
     async fetchMenu() {
       // scrapear y devolver un RestaurantMenu
     },
   };
   ```

2. Añádelo al array `scrapers` en `src/config.ts`.

Eso es todo: tanto el CLI como el bot de Telegram usan automáticamente esa lista.

## Notas y limitaciones conocidas

- **Jumar**: el menú del día solo se publica en una ventana horaria concreta (aprox. a partir de las 17:00 del día anterior). Si consultas fuera de esa ventana, el bot mostrará el mensaje de "no disponible" tal como lo devuelve la web. El código postal usado para la consulta es el de Alcobendas (28108); si cambias de local, ajusta `CODIGO_POSTAL` y `BASE_URL` en `src/scrapers/jumar.ts`.
- **Europa III**: el "menú" en esta web es un PDF (no hay datos estructurados de platos/precios en HTML). El bot descarga el PDF enlazado como "Menú" y extrae su texto plano. Si el restaurante cambia el nombre del enlace o el formato del PDF, puede que haya que ajustar el selector en `src/scrapers/europa3.ts`.

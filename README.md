# Yummy — Bot de menús del día

Consulta el menú del día de varios restaurantes desde la terminal o desde Telegram.

Restaurantes soportados actualmente:
- **Restaurante Jumar** (Alcobendas) — vía el widget AJAX de `restaurantesjumar.com`.
- **Europa III** — extrae el texto del PDF de menú publicado en `europa3restaurante.eatbu.com`.
- **Restaurante Zurbarán** (Alcobendas) — vía el endpoint de TuMenuEn que alimenta su web.
- **La Grosella** — carta semanal para oficinas publicada en la portada de `lagrosella.es`.

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

## Uso con Docker

El bot puede ejecutarse en un contenedor Docker (imagen multi-stage basada en `node:20-alpine`, sin devDependencies en la imagen final, usuario sin privilegios y `tini` como init).

1. Copia `.env.example` a `.env` y rellena `TELEGRAM_BOT_TOKEN`.
2. Arranca el bot con Docker Compose:

   ```bash
   docker compose up -d --build
   ```

3. Ver logs:

   ```bash
   docker compose logs -f
   ```

4. Parar el bot:

   ```bash
   docker compose down
   ```

Alternativamente, sin Compose:

```bash
docker build -t yummy-bot .
docker run -d --name yummy-bot --env-file .env --restart unless-stopped yummy-bot
```

La misma imagen sirve para ejecutar el CLI puntualmente (sin dejar el bot corriendo):

```bash
docker run --rm --env-file .env yummy-bot node dist/cli.js
```

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
- **Zurbarán**: su web no publica el menú en su propio HTML, sino que lo carga por JavaScript desde la plataforma TuMenuEn (`tumenuen.com/php_includes/menu_endpoint.php`, con el identificador de cliente `592`). Ese servidor está detrás de ModSecurity y responde `406 Not Acceptable` ante User-Agents que considera automatizados, entre ellos el de `curl` por defecto; el User-Agent que usa el proyecto sí es aceptado, así que conviene no cambiarlo a la ligera. El restaurante cierra los fines de semana: fuera de días laborables el endpoint sigue devolviendo el último menú publicado, por lo que el scraper compara la fecha del menú con la de hoy y lo indica en la nota cuando no coinciden.
- **La Grosella**: es el único que **no ofrece un menú diario** sino una carta que se renueva por semanas, y tampoco tiene local en Alcobendas (reparte desde San Sebastián de los Reyes); ambas cosas se reflejan en la nota del resultado. Los platos se extraen de los acordeones de la portada, anclando en el encabezado "Carta de la semana…": ese anclaje es necesario porque la página incluye otros bloques `.toggles` (como el de zonas de reparto del pie) que no son platos. **No usar su WooCommerce Store API** (`/wp-json/wc/store/v1/products`) aunque esté abierta: devuelve el catálogo histórico completo (más de 300 primeros y 300 segundos) y no hay forma fiable de acotar la carta vigente, ni siquiera filtrando por estado de stock.

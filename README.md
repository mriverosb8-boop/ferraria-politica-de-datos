# privacidad.ferraria.net

Sitio estático que sirve las páginas legales públicas de FerrarIA: la política de tratamiento de datos personales del canal de atención por WhatsApp, las condiciones del servicio y el procedimiento de eliminación de datos.

No usa framework. Es HTML con CSS plano embebido, más un script de build en Node que inyecta datos de Supabase.

## Páginas del sitio

| Ruta | Archivo | Cómo se produce |
| --- | --- | --- |
| `/` | `index.html` | Generada en cada build desde `index.template.html`. |
| `/terminos` | `terminos.html` | Estática. Committeada. No pasa por el build. |
| `/eliminacion-datos` | `eliminacion-datos.html` | Estática. Committeada. No pasa por el build. |

Las dos páginas estáticas llevan la fecha de última actualización **hardcodeada en el HTML**. Si su contenido cambia, hay que actualizar esa fecha a mano (aparece dos veces en cada archivo: en el párrafo `.updated` y en el footer).

## Flujo de build

```
npm run build
```

Ejecuta `scripts/build-policy.js`, que:

1. Consulta la tabla `hotel_legal_entities` en Supabase, con filtro `is_published = true` y join embebido a `hotels(name)`. Columnas leídas: `legal_name`, `nit`, `habeas_data_email`.
2. Ordena los resultados alfabéticamente por nombre del hotel (locale `es`). Si no hay filas publicadas, pinta una fila con el texto "Información en actualización".
3. Reemplaza los marcadores `<!-- HOTELS_ROWS -->` y `<!-- FECHA -->` de `index.template.html` con las filas de la tabla y la fecha del build formateada en español colombiano.
4. Escribe el resultado en `index.html`.

El build **falla duro** (exit 1) si faltan las variables de entorno o si Supabase devuelve error. Nunca publica una página a medias: aborta el deploy.

`index.html` está en `.gitignore` y se regenera en cada build. **Nunca se commitea ni se edita a mano** — todo cambio a la política va en `index.template.html`.

## Variables de entorno

| Variable | Uso |
| --- | --- |
| `SUPABASE_URL` | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key, usada solo para leer `hotel_legal_entities` en build. |

En local van en `.env.local` (gitignoreado). En producción se configuran en Vercel → Project Settings → Environment Variables.

El service role key se usa **exclusivamente en tiempo de build, en el servidor**. No se expone en el HTML generado ni llega nunca al navegador.

## Redeploy automático

Este repo es **pasivo**: no tiene endpoint receptor ni webhook propio.

El redeploy lo dispara el repo `ferraria-dashboard`, desde `app/api/hotels/[hotelId]/legal-entity/route.ts`, con un POST fire-and-forget a un Deploy Hook de Vercel guardado en la variable `VERCEL_POLICY_DEPLOY_HOOK_URL`. Si la variable no está definida, el dashboard solo registra un aviso y continúa sin fallar.

Consecuencia: al añadir o modificar un hotel desde el dashboard, este sitio se reconstruye solo y la tabla de responsables queda actualizada. Como el render es estático puro (sin SSR, sin ISR, sin fetch en el cliente), **el redeploy es la única forma de refrescar el contenido de la tabla**.

## Mantenimiento del CSS

Todos los estilos del sitio viven en **`styles.css`** en la raíz. Es la única fuente de verdad: cada página lo enlaza con `<link rel="stylesheet" href="/styles.css">` y ninguna lleva estilos embebidos.

La ruta del `<link>` es **absoluta** a propósito. Las páginas por hotel se sirven desde un subdirectorio (`/politica/<slug>`), y una ruta relativa se rompería allí.

Al cambiar un estilo se edita un solo archivo y el cambio aplica a todas las páginas, incluidas las generadas.

## Desarrollo local

```
npm run dev
```

Levanta el sitio en `http://localhost:3001`. Corre `npm run build` antes para tener `index.html` generado.

Las URLs sin extensión (`/terminos`, `/eliminacion-datos`) funcionan tanto en local como en producción: `serve` las resuelve por defecto, y en Vercel las habilita `"cleanUrls": true` en `vercel.json`.

## Despliegue

Configurado en `vercel.json`: build command `npm run build`, output directory la raíz del repo. Cada push a `main` y cada disparo del Deploy Hook regeneran el sitio.

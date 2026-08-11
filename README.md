# privacidad.ferraria.net

Sitio estático que sirve las páginas legales públicas de FerrarIA: la política de tratamiento de datos personales del canal de atención por WhatsApp, las condiciones del servicio y el procedimiento de eliminación de datos.

No usa framework. Es HTML con CSS plano, más un script de build en Node que inyecta datos de Supabase.

## Páginas del sitio

| Ruta | Archivo | Cómo se produce |
| --- | --- | --- |
| `/` | `index.html` | Generada en el build desde `index.template.html`. Política general de la plataforma. No lista hoteles. |
| `/politica/<slug>` | `politica/<slug>.html` | Una por hotel publicado. Generada en el build desde `hotel.template.html`. |
| `/terminos` | `terminos.html` | Estática. Committeada. No pasa por el build. |
| `/eliminacion-datos` | `eliminacion-datos.html` | Estática. Committeada. No pasa por el build. |

La raíz es la URL registrada en la app de Meta. Las páginas por hotel son las que el engine le comparte al huésped en la conversación: cada una identifica a **un solo** responsable del tratamiento.

Las dos páginas estáticas llevan la fecha de última actualización **hardcodeada en el HTML**. Si su contenido cambia, hay que actualizar esa fecha a mano (aparece dos veces en cada archivo: en el párrafo `.updated` y en el footer). Las generadas toman la fecha del build.

## Flujo de build

```
npm run build
```

Ejecuta `scripts/build-policy.js`, que:

1. Consulta `hotel_legal_entities` en Supabase, con filtro `is_published = true` y join embebido a `hotels(name)`. Columnas leídas: `hotel_id`, `legal_name`, `nit`, `habeas_data_email`, `policy_slug`. Pagina con `.range()` porque PostgREST corta en 1000 filas sin importar el `.limit()`.
2. Valida que toda fila publicada tenga un `policy_slug` con formato válido.
3. Ordena por nombre del hotel (locale `es`).
4. Genera `index.html` desde `index.template.html`, inyectando la fecha del build formateada en español colombiano.
5. Borra y regenera el directorio `politica/`, escribiendo un archivo por hotel publicado desde `hotel.template.html`.

El build **falla duro** (exit 1) si faltan las variables de entorno, si Supabase devuelve error, o si una fila publicada no tiene `policy_slug` válido. En ese último caso identifica la fila por `hotel_id` en el mensaje de error.

Fallar es lo correcto: Vercel no promueve un build fallido, así que el sitio anterior sigue en pie. Saltar la fila en silencio dejaría a ese hotel sin política, y el enlace que el engine ya le envió al huésped devolvería 404 — un incumplimiento invisible.

### El `policy_slug` no se calcula acá

El build **solo lee** `policy_slug`. Nunca lo deriva del nombre del hotel.

El slug lo genera y lo persiste `ferraria-dashboard` al guardar la entidad legal, y es **inmutable**: los enlaces ya enviados a huéspedes por WhatsApp dependen de que no cambie. En Supabase está protegido por un `UNIQUE`, un `CHECK` de formato y un `CHECK` que impide publicar sin slug.

No confundir con `hotels.slug`, que es un identificador operativo distinto y **sí es editable** desde el dashboard.

## Archivos generados: por qué el `.gitignore` es un mecanismo de seguridad

`index.html` y el directorio `politica/` están en `.gitignore`. **Nunca se commitean ni se editan a mano** — todo cambio va en los templates.

Esto no es higiene, es lo que garantiza que **un hotel despublicado desaparezca del sitio**.

Cada deploy de Vercel parte de un checkout limpio del repo: no hay estado acumulado entre deploys. Como `politica/` no está en el repo, el único contenido que existe es el que el build acaba de generar. Si un hotel pasa a `is_published = false`, su archivo simplemente no se genera y la URL devuelve 404.

Si alguien commitea esos archivos, viajan en el checkout y **sobreviven a la despublicación**: la página de un hotel dado de baja seguiría accesible en producción indefinidamente, con sus datos legales expuestos.

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

Consecuencia: al añadir o modificar un hotel desde el dashboard, este sitio se reconstruye solo y la página de ese hotel queda actualizada. Como el render es estático puro (sin SSR, sin ISR, sin fetch en el cliente), **el redeploy es la única forma de refrescar el contenido**.

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

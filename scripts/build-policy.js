"use strict";

// Carga .env.local en desarrollo local. En Vercel no existe el archivo y las
// variables ya están en process.env, así que esto es un no-op inofensivo allá.
require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const INDEX_TEMPLATE_PATH = path.join(ROOT, "index.template.html");
const HOTEL_TEMPLATE_PATH = path.join(ROOT, "hotel.template.html");
const INDEX_OUTPUT_PATH = path.join(ROOT, "index.html");
const HOTELS_OUTPUT_DIR = path.join(ROOT, "politica");

// PostgREST corta en 1000 filas sin importar el .limit(); paginamos con .range().
const PAGE_SIZE = 1000;

// Mismo formato que el CHECK de la columna policy_slug en Supabase. Se revalida
// acá porque el slug se usa como nombre de archivo: un valor con "/" o ".."
// escribiría fuera del directorio de salida.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Escapa caracteres con significado especial en HTML para no romper el markup. */
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateEsCO(date) {
  return date.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Reemplaza todas las ocurrencias de un marcador, sin interpretar $ ni regex. */
function fillMarker(html, marker, value) {
  return html.split(marker).join(value);
}

// --- Datos -----------------------------------------------------------------

function readEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    const missing = [
      !url && "SUPABASE_URL",
      !key && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    throw new Error(
      `Build abortado: faltan variables de entorno requeridas: ${missing.join(
        ", "
      )}. Configúralas en Vercel (Project Settings → Environment Variables).`
    );
  }

  return { url, key };
}

/** Trae todas las entidades legales publicadas, paginando por el corte de PostgREST. */
async function fetchPublishedEntities(supabase) {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("hotel_legal_entities")
      .select("hotel_id, legal_name, nit, habeas_data_email, policy_slug, hotels(name)")
      .eq("is_published", true)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Build abortado: error consultando Supabase: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * El embedded de hotels puede venir como objeto o como array según cómo
 * supabase-js infiera la FK; normalizamos a un solo objeto.
 */
function hotelNameOf(row) {
  const hotel = Array.isArray(row.hotels) ? row.hotels[0] : row.hotels;
  return (hotel && hotel.name) || "";
}

/**
 * Un hotel publicado sin slug válido no puede tener página, y saltarlo en
 * silencio dejaría al huésped con un 404 en su política. Fallamos duro: Vercel
 * no promueve un build fallido, así que el sitio anterior sigue en pie.
 */
function assertSlugs(rows) {
  const invalid = rows
    .filter((row) => !row.policy_slug || !SLUG_RE.test(row.policy_slug))
    .map((row) => `hotel_id=${row.hotel_id} policy_slug=${JSON.stringify(row.policy_slug)}`);

  if (invalid.length > 0) {
    throw new Error(
      `Build abortado: ${invalid.length} fila(s) publicada(s) con policy_slug ausente o inválido:\n  ` +
        invalid.join("\n  ") +
        `\nCorrige el slug en hotel_legal_entities o despublica la fila.`
    );
  }
}

// --- Renderizado -----------------------------------------------------------

function renderIndex(template, fecha) {
  return fillMarker(template, "<!-- FECHA -->", fecha);
}

function renderHotelPage(template, row, fecha) {
  let html = fillMarker(template, "<!-- FECHA -->", fecha);
  html = fillMarker(html, "<!-- HOTEL_NAME -->", escapeHtml(hotelNameOf(row)));
  html = fillMarker(html, "<!-- LEGAL_NAME -->", escapeHtml(row.legal_name));
  html = fillMarker(html, "<!-- NIT -->", escapeHtml(row.nit));
  html = fillMarker(html, "<!-- EMAIL -->", escapeHtml(row.habeas_data_email));
  return html;
}

/**
 * Se regenera desde cero para que un hotel despublicado no sobreviva como
 * archivo huérfano de un build anterior.
 */
function resetHotelsDir() {
  fs.rmSync(HOTELS_OUTPUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(HOTELS_OUTPUT_DIR, { recursive: true });
}

// --- Build -----------------------------------------------------------------

async function main() {
  const { url, key } = readEnv();

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = await fetchPublishedEntities(supabase);
  assertSlugs(rows);

  const sorted = [...rows].sort((a, b) =>
    hotelNameOf(a).localeCompare(hotelNameOf(b), "es")
  );

  const fecha = formatDateEsCO(new Date());

  const indexTemplate = fs.readFileSync(INDEX_TEMPLATE_PATH, "utf8");
  fs.writeFileSync(INDEX_OUTPUT_PATH, renderIndex(indexTemplate, fecha), "utf8");

  const hotelTemplate = fs.readFileSync(HOTEL_TEMPLATE_PATH, "utf8");
  resetHotelsDir();

  const generated = [];
  for (const row of sorted) {
    const outputPath = path.join(HOTELS_OUTPUT_DIR, `${row.policy_slug}.html`);
    fs.writeFileSync(outputPath, renderHotelPage(hotelTemplate, row, fecha), "utf8");
    generated.push(row.policy_slug);
  }

  console.log(`Build completado (fecha ${fecha}).`);
  console.log(`  index.html — política general de la plataforma`);
  console.log(`  ${generated.length} página(s) de hotel en politica/:`);
  for (const slug of generated) {
    console.log(`    /politica/${slug}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

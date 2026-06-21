"use strict";

// Carga .env.local en desarrollo local. En Vercel no existe el archivo y las
// variables ya están en process.env, así que esto es un no-op inofensivo allá.
require("dotenv").config({ path: ".env.local" });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "index.template.html");
const OUTPUT_PATH = path.join(ROOT, "index.html");

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

async function main() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      !SUPABASE_URL && "SUPABASE_URL",
      !SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    throw new Error(
      `Build abortado: faltan variables de entorno requeridas: ${missing.join(
        ", "
      )}. Configúralas en Vercel (Project Settings → Environment Variables).`
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("hotel_legal_entities")
    .select("legal_name, nit, habeas_data_email, hotels(name)")
    .eq("is_published", true);

  if (error) {
    throw new Error(`Build abortado: error consultando Supabase: ${error.message}`);
  }

  // El embedded de hotels puede venir como objeto o como array según cómo
  // supabase-js infiera la FK; normalizamos a un solo objeto.
  const hotelOf = (row) =>
    Array.isArray(row.hotels) ? row.hotels[0] : row.hotels;

  let rowsHtml;
  if (!data || data.length === 0) {
    rowsHtml = `<tr><td colspan="4">Información en actualización.</td></tr>`;
  } else {
    const sorted = [...data].sort((a, b) => {
      const nameA = (hotelOf(a) && hotelOf(a).name) || "";
      const nameB = (hotelOf(b) && hotelOf(b).name) || "";
      return nameA.localeCompare(nameB, "es");
    });

    rowsHtml = sorted
      .map((row) => {
        const hotelObj = hotelOf(row);
        const hotelName = escapeHtml(hotelObj && hotelObj.name);
        const legalName = escapeHtml(row.legal_name);
        const nit = escapeHtml(row.nit);
        const email = escapeHtml(row.habeas_data_email);
        return `<tr><td>${hotelName}</td><td>${legalName}</td><td>${nit}</td><td>${email}</td></tr>`;
      })
      .join("\n          ");
  }

  const fecha = formatDateEsCO(new Date());

  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const output = template
    .replace("<!-- HOTELS_ROWS -->", rowsHtml)
    .split("<!-- FECHA -->")
    .join(fecha);

  fs.writeFileSync(OUTPUT_PATH, output, "utf8");

  const count = !data || data.length === 0 ? 0 : data.length;
  console.log(
    `Política generada: index.html (${count} responsable(s) publicado(s), fecha ${fecha}).`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

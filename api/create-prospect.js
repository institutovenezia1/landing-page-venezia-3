const {
  buildProspectRecord,
  getMissingConfig,
  insertProspect,
  readJsonBody,
  sendJson,
  validateProspectPayload,
} = require("./_lib/prospect-flow");

module.exports = async function createProspect(request, response) {
  if (request.method === "OPTIONS") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { ok: false, error: "Metodo no permitido." });
  }

  const missingConfig = getMissingConfig();
  if (missingConfig.length > 0) {
    return sendJson(response, 500, {
      ok: false,
      error: "Faltan variables de Supabase para crear el prospecto.",
      missingConfig,
    });
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch (error) {
    return sendJson(response, 400, { ok: false, error: "JSON invalido." });
  }

  const validation = validateProspectPayload(payload);
  if (!validation.ok) {
    return sendJson(response, 422, {
      ok: false,
      error: "Revisa los datos del formulario.",
      details: validation.errors,
    });
  }

  const prospectRecord = buildProspectRecord(validation.data);

  try {
    const prospect = await insertProspect(prospectRecord);

    return sendJson(response, 200, {
      ok: true,
      prospectId: prospect.id,
      prospect,
    });
  } catch (error) {
    console.error("create-prospect error", {
      message: error.message,
      status: error.status,
      payload: error.payload,
    });

    return sendJson(response, error.status && error.status < 500 ? error.status : 500, {
      ok: false,
      error: "No se pudo guardar el prospecto en Venezia One.",
      detail: error.message || String(error),
    });
  }
};

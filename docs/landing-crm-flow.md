# Landing Venezia 3.0 - Integracion CRM

## Variables locales

Crear `.env.local` con:

```bash
SUPABASE_URL=https://cvcmvvfobuelmvobsvue.supabase.co
SUPABASE_ANON_KEY=...
```

Tambien se puede usar `SUPABASE_SERVICE_ROLE_KEY` en lugar de `SUPABASE_ANON_KEY` si se quiere escribir desde el servidor con permisos administrativos.

## Flujo actual (implementado en `script.js`)

1. Usuario envia el formulario.
2. La landing llama `POST /api/create-checkout` (no `/api/create-prospect`).
3. El endpoint valida nombre, WhatsApp, curso, horario y tipo de reserva.
4. Se inserta un registro en `prospects` (mismo mapeo de campos que se describe abajo).
5. Se crea una intencion de pago en `landing_payment_intents` ligada al `prospect_id`.
6. Se genera una preferencia en Mercado Pago y la landing redirige al usuario al checkout.
7. La respuesta de `/api/create-checkout` devuelve `prospectId`, `intentId`, `preferenceId` y `checkoutUrl`.

Ver `docs/mercado-pago-produccion.md` para el detalle completo del flujo de pago y el webhook.

## `api/create-prospect.js` (endpoint independiente, no usado por el frontend actual)

Este endpoint existe en el codigo y funciona de forma autonoma (valida el mismo payload e inserta en `prospects` sin crear intencion de pago ni checkout), pero **`script.js` no lo llama**: el formulario de la landing usa unicamente `/api/create-checkout`. Si en el futuro se necesita un flujo de captacion de prospectos sin pago inmediato, este endpoint ya esta disponible para conectarse, pero hoy no forma parte del camino que sigue un usuario real.

## Mapeo

```json
{
  "full_name": "Nombre",
  "phone": "WhatsApp",
  "contact_date": "YYYY-MM-DD",
  "branch_interest": "Tlaxcala",
  "course_interest": "Curso",
  "origin": "Landing Venezia 3.0",
  "contact_channel": "WhatsApp",
  "info_status": "Pendiente de enviar",
  "prospect_status": "Pago Pendiente",
  "request_type": "TipoReserva",
  "access_interest": "Beca Venezia",
  "enrolled_by": "Pendiente",
  "notes": "Metadata de Landing"
}
```

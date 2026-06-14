# Landing Venezia 3.0 - Integracion CRM

## Variables locales

Crear `.env.local` con:

```bash
SUPABASE_URL=https://cvcmvvfobuelmvobsvue.supabase.co
SUPABASE_ANON_KEY=...
```

Tambien se puede usar `SUPABASE_SERVICE_ROLE_KEY` en lugar de `SUPABASE_ANON_KEY` si se quiere escribir desde el servidor con permisos administrativos.

## Flujo

1. Usuario envia el formulario.
2. La landing llama `POST /api/create-prospect`.
3. El endpoint valida nombre, WhatsApp, curso y tipo de reserva.
4. Se inserta un registro en `prospects`.
5. La respuesta devuelve `prospectId`.
6. La landing muestra confirmacion local.

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

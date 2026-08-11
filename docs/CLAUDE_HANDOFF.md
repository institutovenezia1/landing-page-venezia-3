# Transferencia técnica — Landing Page Venezia 3.0

## Flujo actual
1. Usuario elige curso, horario y tipo de reserva.
2. `script.js` envía POST a `/api/create-checkout`.
3. Se crea prospecto en Supabase con origen `Landing Venezia 3.0` y estado `Pago Pendiente`.
4. Se crea una intención en `landing_payment_intents`.
5. Mercado Pago genera preferencia y URL.
6. Webhook valida y actualiza intención/prospecto/movimiento financiero.
7. Meta Pixel registra eventos con deduplicación por sesión/event ID.

## Variables esperadas
No copiar valores aquí. Configurarlas en Vercel y `.env.local`.

Requeridas (el runtime falla o responde error si faltan):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` o `SUPABASE_ANON_KEY` (basta una de las dos; `SUPABASE_SERVICE_ROLE_KEY` tiene prioridad si ambas están presentes)
- `MERCADOPAGO_ACCESS_TOKEN` (usada por `/api/create-checkout` y `/api/mercadopago-webhook`)

Opcionales (el código tiene fallback si faltan):
- `MERCADOPAGO_WEBHOOK_SECRET` — sin ella el webhook procesa notificaciones sin verificar firma; técnicamente opcional pero fuertemente recomendada en producción por seguridad (habilita la validación criptográfica HMAC de Mercado Pago).
- `MERCADOPAGO_WEBHOOK_URL` — si falta, se infiere como `{baseUrl}/api/mercadopago-webhook`.
- `LANDING_BASE_URL` — si falta, se infiere del host de la request.
- `MERCADOPAGO_USE_SANDBOX` — si falta, se asume `false`.

Reservada / uso futuro (el código actual no la lee):
- `MERCADOPAGO_PUBLIC_KEY` — pensada para un futuro SDK de Mercado Pago en el frontend. El checkout actual usa redirección a Checkout Pro y no la necesita.

## Estado comercial codificado confirmado
- Apartado: $399.99
- Inscripción completa: $999.99
- Cursos: Uñas Acrílicas Profesionales y Corte y Barbería Profesional
- Revisar horarios contra la oferta comercial vigente antes de cambiarlos; están duplicados en frontend y backend y deben mantenerse sincronizados.

## Validación
```bash
npm run check
python3 -m http.server 5173
```
Para funciones serverless, usar entorno local compatible con Vercel. Comprobar errores de consola/red y que no se filtren secretos.

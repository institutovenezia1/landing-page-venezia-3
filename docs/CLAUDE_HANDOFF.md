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
No copiar valores aquí. Configurarlas en Vercel y `.env.local`:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (solo servidor) o la clave permitida por el diseño
- `SUPABASE_ANON_KEY` cuando corresponda
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET` si el webhook lo requiere
- `MERCADOPAGO_WEBHOOK_URL`
- `MERCADOPAGO_USE_SANDBOX`
- `LANDING_BASE_URL`

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

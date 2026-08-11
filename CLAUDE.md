# Landing Page Venezia 3.0 — instrucciones para Claude

Lee `docs/CLAUDE_HANDOFF.md` antes de modificar código.

## Propósito
Landing de conversión para captar prospectos de Tlaxcala, registrar el lead en Supabase/Venezia One y cobrar apartado o inscripción mediante Mercado Pago.

## Arquitectura
- Frontend estático: `index.html`, `styles.css`, `script.js`.
- Serverless functions en `api/` para Vercel.
- Node >=18.
- Supabase para prospectos e intenciones/pagos.
- Mercado Pago para checkout y webhook.
- Meta Pixel para PageView, InitiateCheckout y Purchase.

## Reglas
1. No incrustes tokens, service-role keys ni secretos en frontend o Git.
2. `.env.local` y `.vercel` deben permanecer ignorados.
3. Mantén idempotencia de checkout/webhook y persistencia de `prospect_id`/`intent_id`.
4. No marques pagos como aprobados solo por el retorno del navegador; el webhook/API es la fuente de verdad.
5. Mantén Tlaxcala como única sucursal y cursos vigentes salvo indicación expresa.
6. No cambies precios, horarios, Pixel ID o eventos sin confirmación del usuario.
7. No mezcles el código con Venezia One; la integración es por Supabase.
8. Antes de deploy, ejecuta `npm run check` y prueba formulario, checkout y retorno.

## Estado de referencia
- Repo: `institutovenezia1/landing-page-venezia-3`
- Rama: `main`
- Último commit confirmado: `8a0bdb375442b7cd0ae87de67f23f1a119cc45a8`
- Producción conocida: `https://landing-page-venezia-3.vercel.app`

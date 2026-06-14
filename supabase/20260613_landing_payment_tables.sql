create table if not exists public.landing_payment_intents (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  preference_id text not null default '',
  payment_id text not null default '',
  status text not null default 'intent_created',
  payment_status text not null default '',
  payment_status_detail text not null default '',
  reservation_type_key text not null,
  reservation_type_label text not null,
  course_key text not null,
  course_label text not null,
  amount numeric(10, 2) not null,
  currency text not null default 'MXN',
  checkout_url text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  raw_preference jsonb not null default '{}'::jsonb,
  raw_payment jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists landing_payment_intents_prospect_id_idx
  on public.landing_payment_intents (prospect_id);

create index if not exists landing_payment_intents_preference_id_idx
  on public.landing_payment_intents (preference_id);

create index if not exists landing_payment_intents_payment_id_idx
  on public.landing_payment_intents (payment_id);

create table if not exists public.mercadopago_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null default '',
  action text not null default '',
  topic text not null default '',
  data_id text not null default '',
  payment_id text not null default '',
  signature_valid boolean not null default false,
  request_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  processed boolean not null default false,
  processing_error text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists mercadopago_webhook_events_data_id_idx
  on public.mercadopago_webhook_events (data_id);

create index if not exists mercadopago_webhook_events_payment_id_idx
  on public.mercadopago_webhook_events (payment_id);

alter table public.landing_payment_intents enable row level security;
alter table public.mercadopago_webhook_events enable row level security;

drop policy if exists "Landing payment intents can be read by app" on public.landing_payment_intents;
create policy "Landing payment intents can be read by app"
  on public.landing_payment_intents
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Landing payment intents can be inserted by app" on public.landing_payment_intents;
create policy "Landing payment intents can be inserted by app"
  on public.landing_payment_intents
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Landing payment intents can be updated by app" on public.landing_payment_intents;
create policy "Landing payment intents can be updated by app"
  on public.landing_payment_intents
  for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Mercado Pago webhook events can be read by app" on public.mercadopago_webhook_events;
create policy "Mercado Pago webhook events can be read by app"
  on public.mercadopago_webhook_events
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Mercado Pago webhook events can be inserted by app" on public.mercadopago_webhook_events;
create policy "Mercado Pago webhook events can be inserted by app"
  on public.mercadopago_webhook_events
  for insert
  to anon, authenticated
  with check (true);

alter table public.events
  add column if not exists capi_advanced_matching boolean not null default true;

comment on column public.events.capi_advanced_matching is
  'Autoatendimento: envia dados pessoais hasheados na CAPI da Meta (Purchase/Lead). Padrao ligado; recusa da cliente continua bloqueando.';
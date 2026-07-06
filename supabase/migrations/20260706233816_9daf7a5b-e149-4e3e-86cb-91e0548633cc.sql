DELETE FROM public.trocas_devolucoes WHERE codigo_devolucao = 'TD-2026-000001';
ALTER SEQUENCE public.trocas_devolucoes_codigo_seq RESTART WITH 1;
# Redirecionador de Live sem prazo de 3 horas

Hoje o link do redirecionador expira sozinho 3 horas depois de a live ser marcada como "AO VIVO" (ou depois da última troca de link). Quando o prazo estoura, o sistema desliga o "AO VIVO" sozinho e o link público passa a mostrar "ainda não estamos ao vivo", mesmo com a live rolando.

## O que muda

O link passa a valer enquanto o evento estiver marcado como "AO VIVO agora". Só deixa de valer quando:
- você desmarcar o "AO VIVO" / clicar em "Encerrar", ou
- o link do Instagram for trocado manualmente (aí o novo link passa a valer imediatamente).

Nada de desligamento automático por tempo.

## Detalhes técnicos

1. `supabase/functions/live-redirect/index.ts`
   - Remover `BROADCAST_TTL_HOURS` e todo o bloco de cálculo `freshestAt / ageMs / ttlMs`.
   - Remover o auto-desligamento (`update is_live_broadcasting = false`) e o motivo `ttl_expired`.
   - Manter a validação HEAD do link do Instagram (cache de 30s) e o motivo `url_unreachable`, para o caso de link quebrado.
   - Manter a gravação de cliques e a memória de atribuição sem alteração.

2. `src/components/events/LiveBroadcastBanner.tsx`
   - Remover `TTL_MS`, o contador regressivo, os estados "expirando" / "expirado" e as cores âmbar/laranja.
   - Banner fica sempre vermelho, com texto "AO VIVO — {evento} · no ar desde {hora}" e o link atual.
   - Manter os botões "Trocar link" e "Encerrar"; ajustar o texto do diálogo de troca (sem menção a "reinicia o TTL de 3h").
   - Continuar gravando `live_url_updated_at` na troca de link (vira apenas histórico/auditoria).

Sem migração de banco: as colunas `live_broadcast_started_at` e `live_url_updated_at` continuam existindo, só deixam de expirar o link.

# RH — automação VAGA e aviso WhatsApp

Data: 08/11/2026. Nenhuma publicação foi feita. Nenhuma mensagem real foi enviada durante os testes.

## Entregue

### Instagram
- Regra ativa `VAGA-RH`, tipo exclusivo `rh_vaga`, mídias post/REELS/IGTV/story/live, cooldown de 60 minutos e delay de 20–60 segundos.
- Correspondência tolerante somente nessa regra; regras `keyword` antigas continuam com substring simples.
- Link idempotente por @ usando `rh_create_link`; cadastro enviado reutiliza o mesmo registro e recebe confirmação sem botão.
- Direct na fila existente `ig_live_cart_notifications`, `kind='rh_vaga_link'`, uma linha por comentário/@, claim atômico e sem retry automático.
- Botão `Quero me candidatar` com URL oficial dinâmica; resposta pública no comentário; stories usam Direct por ID e a janela Meta.
- Moderação de comentários e tratamento de live não foram alterados.

### WhatsApp
- Depois da avaliação automática salva (completa ou parcial), um único aviso pode ser reservado e enviado se `aviso_ativo=true`.
- Reavaliação manual não gera aviso automático.
- Reenvio manual admin limitado a três; teste admin usa exemplo fictício e não cria candidato.
- Envio exige instância uazapi explícita. Sem fallback para outra instância.
- Painel mostra automação, aviso ligado/desligado e último resultado; detalhe mostra estado e reenvio.
- Configuração final: aviso desligado e instância vazia.

## Arquivos novos
- `supabase/functions/_shared/rh-vaga-matcher.ts`
- `supabase/functions/_shared/rh-vaga-automation.ts`
- `supabase/functions/rh-score/notify.ts`
- `supabase/functions/rh-score/notice-text.ts`
- `src/test/rhVagaAutomation.test.ts`
- `drizzle/migrations/0145_rh_instagram_and_whatsapp_notices.sql`

## Arquivos alterados
- `supabase/functions/_shared/instagram-comment-automation.ts`
- `supabase/functions/meta-messenger-webhook/index.ts`
- `supabase/functions/ig-live-cart-notify/index.ts`
- `supabase/functions/rh-score/index.ts`
- `src/components/marketing/InstagramCommentAutomation.tsx`
- `src/components/rh/RhDashboard.tsx`
- `src/components/rh/RhSettings.tsx`
- `src/pages/RhCandidatePage.tsx`
- `src/lib/rh/api.ts`
- `src/integrations/supabase/types.ts` (regenerado automaticamente)
- `supabase/functions/AGENTS.md`, `roadmap.md` e memória do RH.

## Banco
Nenhuma tabela nova.

Colunas aditivas:
- `ig_live_cart_notifications`: `source_key`, `comment_id`, `recipient_id`, `instagram_account_id`.
- `rh_avisos`: `claim_token`, `provider_message_id`, `updated_at`.
- `rh_settings`: `aviso_ultimo_status`, `aviso_ultimo_erro`, `aviso_ultimo_at`, `aviso_ultimo_tipo`.

Funções novas, somente `service_role`:
- `rh_aviso_claim(uuid,boolean)`
- `rh_aviso_finish(uuid,uuid,boolean,text,text)`

Funções administrativas atualizadas:
- `rh_admin_context()`
- `rh_candidate_detail(uuid)`

Índices parciais para uma regra RH e uma fila por comentário/@. Nenhum cron criado.

Funções implantadas: `rh-score`, `meta-messenger-webhook`, `ig-live-cart-notify`.

## Testes do matcher — executados com Vitest

| Entrada | Dispara |
|---|---|
| `vaga` | sim |
| `VAGA` | sim |
| `Vaga` | sim |
| `vagaa` | sim |
| `vagas` | sim |
| `vaaga` | sim |
| `vga` | sim |
| `vagá` | sim |
| `quero a vaga` | sim |
| `vaga!!` | sim |
| `v a g a` | sim |
| `vaja` | sim |
| `baga` | sim |
| `😊 VAGASS... 👇` | sim |
| `vara` | não |
| `vaca` | não |
| `quero uma vara de pescar` | não |
| `a vaca comeu` | não |
| `vago` | não |
| `viga` | não |
| `vagabundo` | não |
| `emprego` | não |
| texto vazio | não |

Resultado: 54 testes passaram (28 novos + 26 avaliação RH anterior).

## Testes no banco — executados de verdade
- Mesmo @ duas vezes: mesmo código e `reused=true`.
- Link marcado enviado: mesmo código, estado enviado, sem novo link.
- Aviso desligado: retorno `reason=disabled`, sem reserva.
- Primeira reserva: `ok=true`; segunda imediata: bloqueada por aviso em andamento.
- Duas inserções com mesmo comentário/@: somente uma linha persistiu.
- Função service-only chamada sem privilégio: permissão negada.
- Limpeza final: zero candidatos, links e jobs temporários.
- Candidato `7851813a-2eb2-4f05-8e32-99aeb4290348`: presente ao final.

## Testes no preview
- RH mostra `VAGA-RH Ativa` e aviso desligado/sem instância.
- Configurações mostram botão de teste; acioná-lo sem instância retorna bloqueio e não envia.
- Detalhe mostra aviso e ação manual.
- IG Automação mostra e abre VAGA-RH para edição, com cinco mídias, textos e `{rh_link}` protegido.
- Desktop e 390 px sem erros de execução nem rolagem horizontal.
- Senha temporária e tentativas removidas; área RH voltou a ficar sem senha.

## Não exercitado
- Nenhum Direct/comentário real na Meta.
- Nenhum envio real pelo uazapi.
- Entrega efetiva e janela da Meta dependem da primeira ocorrência real.
- Site não publicado.

## Complemento — stories, menções e DM direta (08/11/2026)

O recebimento de resposta a story (`message.reply_to.story`) e menção (`attachments.type=story_mention`) já existia e já chegava à automação RH. Faltava acionar a regra RH por uma DM direta comum; essa entrada foi adicionada sem executar regras antigas de stories em DMs.

- Todas as entradas usam o mesmo matcher, link idempotente, reserva de ação e fila, com intervalo compartilhado de 60 minutos por remetente na regra.
- Respostas a story, menções com texto e DMs não reservam resposta pública: somente Direct com botão oficial. Menção sem texto não dispara; não buscamos VAGA em imagens ou URLs de mídia.
- Ecos, mensagens apagadas, eventos de leitura e postbacks não disparam VAGA.
- O envio de Direct da fila agora bloqueia jobs com 24 horas ou mais; falha fica registrada sem reenvio automático.
- Nenhuma tela, tabela, permissão ou cron foi criado/alterado neste complemento. As duas funções de recebimento/envio foram implantadas; o site não foi publicado.

### Testes executados

58 testes Vitest (pontuação RH e matcher/entrada/janela) e 6 testes Deno chamando o handler real com armazenamento e credenciais simulados: **64 passaram**.

| Entrada/fluxo | Resultado |
|---|---|
| Resposta a story: `😊 V A G A!!` | Uma reserva de Direct com botão, sem comentário público |
| DM direta: `quero a vagá` | Uma reserva RH, sem executar regra antiga |
| Menção com texto: `vaja` | Reconhecida como story; handler reserva Direct |
| Entregas simultâneas da mesma DM + resposta de story do mesmo remetente | Somente um job e uma chamada de link |
| Cadastro já enviado: `vga` | Confirmação sem botão |
| DM: `uma vaca` | Zero consultas de automação e nenhum job |
| Eco com `VAGA`, mensagem apagada ou menção sem texto | Não elegível |
| Direct com idade de 23h59m59s / 24h | Permitido / bloqueado |

Consultas de tela continuam iguais (RH: 2; detalhe: 1). DM sem correspondência faz zero consultas adicionais de automação. DM VAGA faz uma leitura limitada à regra RH; se elegível, reutiliza as consultas de cooldown, link e reserva já existentes. Sem polling ou cron novo.

Não houve envio real à Meta nem inclusão de dados de teste no banco neste complemento. A entrega final no Instagram depende de um story reply e uma DM real recebidos pelo webhook da conta. Candidato do dono preservado; nenhuma limpeza destrutiva foi feita.

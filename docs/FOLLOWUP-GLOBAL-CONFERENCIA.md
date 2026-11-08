# Follow-up global — conferência

## Estado seguro da entrega
- Plano RH copiado byte a byte para `.lovable/plan-rh.md`; RH não alterado.
- Global desligado. Candidato protegido preservado. Nenhum envio real de teste. Front não publicado.
- Eventos > Follow-up: configuração A–F, variações, prazos, limites, prévia, histórico paginado e totais diários.
- Cada live tem interruptor ligado por padrão; instância WhatsApp sempre a configurada no evento.
- Apenas novos acontecimentos após ligar entram na fila; não dispara retroativamente toda a base.

## Inventário e tratamento
| Existente | Tratamento |
|---|---|
| Follow-ups Meta oficial e Instagram por evento | Rotinas scheduler/dispatcher reaproveitadas. Quando global ligado, novo motor substitui o antigo; pendências antigas são marcadas como substituídas. Enquanto global desligado, comportamento antigo permanece, conforme pedido. |
| Livete follow-up legado | Endpoint ausente no código e chamadas atuais retornam 404; não recriado, cron preservado. |
| Chat-payment-followup | Endpoint ausente e chamadas retornam 404; rotina preservada, não confundir com PDV/Ads. |
| Cart-notify selfservice_register_dm | Substituído somente com global ligado; outras notificações de comentário preservadas. |
| Confirmação #CODE, primeiro carrinho, PIX, pagamento confirmado | Preservados; reserva compartilhada impede B/C e primeiro carrinho automático concorrerem. |
| Catálogo individual | Convite/primeiro link preservados, E conta do primeiro item real. |
| Vitrine pública | Não enviava WhatsApp ao fechar sacola; D começa somente quando um link é efetivamente enviado, não por abrir/copiar página. |
| Crossell manual e envio em massa | Preservados, não são lembretes automáticos. |
| RH VAGA no mesmo worker de Instagram | Preservado e fora do gate de live. |

## Segurança / desempenho
- Fila isolada de lembretes: unique cliente+sequência+passo, reserva transacional e serial por instância.
- 20–60s mínimos sorteados, 40/h e 6/cliente/dia; rotina existente roda por minuto, por isso pode entregar mais devagar do que o intervalo mínimo. Nenhum cron novo.
- Falha/resultado incerto nunca gera retry automático; resultado incerto pausa imediatamente para não duplicar. Três erros claros ou desconexão/restrição também pausam.
- Verifica pagamento, pedido, resposta, opt-out, janela Meta e mensagem manual recente imediatamente antes do envio.
- E adiado para 08h–08h30 Brasília se fora de 08h–19h; D com atraso superior a 15 min não envia.
- RLS e grants explícitos; funções internas sem EXECUTE anon; administração valida sessão/administrador, withAccessLog.
- Tela: **3 consultas ao abrir** (configuração, histórico, totais); histórico/totais atualizam só por filtro/página/botão. Sem polling. Fontes alteradas processadas em lotes de 50, claim até 20, índices no histórico/chat/fontes.

## Testado
- 29 testes automatizados de valores concretos: prazos A–F, limites, janela 19h/08h, jitter, paradas.
- Simulação transacional real: unique_step=true, claim_first=true, claim_no_duplicate=true, hourly_40_limit=true, event_off_cancels=true, provider_calls=0; tudo desfeito ao sair.
- Tela autenticada: salvar global desligado, recarregar e conferir persistência. Desktop/celular.
- Chamadas sem sessão/inválidas: 401. Global false, fila zero, evento fictício zero, candidato protegido presente.

## Conferir antes de ligar
1. Textos e limites na nova aba; salvar ainda desligado.
2. Instância WhatsApp de cada live e interruptor por live.
3. Instagram: DM automática exige vínculo do @ com ID/instância e mensagem recebida dentro de 24h. Somente comentário não abre essa janela; não forçamos envio fora dela.
4. Cadastro preenchido **sem pedido existente** não possui link de carrinho: não criamos pedido fictício; B/C só mandam carrinho se houver pedido.
5. A rotina não substitui atendimento humano; nenhum envio real foi usado para comprovar entrega dos provedores. Conferência de entrega deve ocorrer depois de autorização, em live controlada.
6. O valor “pagos após follow-up” representa ordem temporal, não prova atribuição causal.
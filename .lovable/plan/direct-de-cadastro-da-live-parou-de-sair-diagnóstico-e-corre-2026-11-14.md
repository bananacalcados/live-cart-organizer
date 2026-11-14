# Direct de cadastro da live parou de sair: diagnóstico e correção

## Diagnóstico (confirmado nos dados e no código)

1. **Onde o envio é barrado.** A função que envia os avisos da live pelo Instagram tem uma regra que, com o follow-up global ligado, marca todo aviso de cadastro (o Direct com botão "CADASTRAR") como "substituído pelo follow-up global" antes de tentar enviar:
   - `supabase/functions/ig-live-cart-notify/index.ts`, linhas 217-220:
     `if (job.kind==='selfservice_register_dm' && await replacesLegacyFollowups(sb)) { ...status:'skipped', error:'substituído pelo follow-up global'... }`
   - Entrou no commit `01f7e182e` em 08/11 às 15:08 (horário de Brasília). Só passou a valer quando o follow-up global foi ligado, em 09/11 às 15:39, o que bate com o meio da live de 09/11.
   - Últimos 2 dias: 89 avisos de cadastro pulados e nenhum enviado. Hoje foram 9 de 9.

2. **O follow-up global não cobre esse caso.** Existe um tipo F (pelo Instagram, respondendo ao comentário), mas:
   - ele manda o **link do carrinho** e não o link de cadastro;
   - só manda 1 vez e só para quem está sem WhatsApp;
   - hoje não foi criado nenhum F (último foi em 12/11, 7 enviados). Para a @heldahairstylist não existe nenhum job. O motivo exato de o F não ter sido criado para ela ainda não está confirmado. A suspeita é que não achou a conta do Instagram da live, ou que o pedido foi lido quando ainda estava sem itens, e o follow-up descartou sem aviso. Isso fica como primeiro passo de verificação.
   - Quem tem WhatsApp mas não se cadastrou (ex.: @eliane_duraes10) só recebe o fluxo de WhatsApp, nunca o botão de cadastro no Instagram.
   - Conclusão: a substituição é a causa de ninguém receber o link de cadastro pelo Instagram.

3. **As mudanças do Direct (08-14/11) não quebraram o envio.** Os avisos "carrinho pronto" (89 enviados, o último hoje às 13:19) e os links da vaga RH (5 enviados hoje às 09:05) usam a mesma conta e o mesmo token. O link da vaga usa ainda o mesmo jeito de responder ao comentário. A parte do cadastro (botão, conta da live, busca do comentário) não foi alterada depois de 08/11. Ao reativar, o envio deve funcionar.

## Correção mínima proposta

- Tirar só o bloqueio das linhas 217-220. O aviso de cadastro volta a ser **exclusivo do Instagram**, mesmo com o global ligado.
- As travas que já existem continuam valendo:
  - pedido pago, cancelado ou enviado não recebe;
  - quem já se cadastrou é pulado;
  - só sai se ela comentou nesta live;
  - uma única resposta por comentário, sem reenvio automático;
  - se o botão for recusado, manda o texto com o link uma vez só.
- Para não duplicar com o tipo F (que também responde ao comentário, e a Meta só aceita 1 resposta por comentário): o F não é criado para pedido que já tem aviso de cadastro enviado ou pendente. O WhatsApp (tipos A/B/C/D) continua com o global, sem mudança.

## Reenvio para hoje (só com sua autorização)

- Regra da Meta: 1 resposta privada por comentário, até 7 dias depois do comentário. Pela regra do projeto, em comentário de live só enquanto a live está no ar. Esta live fica ativa até 00:23 de 15/11.
- Pedidos de hoje ainda abertos e sem cadastro:
  - **@heldahairstylist**, pedido 6563cbcd, sem WhatsApp;
  - **@eliane_duraes10**, aguardando confirmação.
- Os outros 7 já pagaram ou já se cadastraram e ficam de fora.
- Como fazer: voltar só esses 2 avisos para a fila, depois da correção publicada. As travas são conferidas de novo na hora do envio.

## Teste para não voltar

- Novo teste da regra de decisão do aviso de cadastro, separando a decisão do envio em uma função pura e testável:
  - com global ligado + pedido de comentário + sem cadastro → **enviar** (não pular);
  - já cadastrado → pular;
  - pedido pago ou cancelado → não enviar;
  - pedido com aviso de cadastro enviado → o follow-up global não cria tipo F.

## Detalhes técnicos

- Arquivos: `supabase/functions/ig-live-cart-notify/index.ts` (remover o bloqueio) e `supabase/functions/_shared/live-followup.ts` (pular F quando já existir `selfservice_register_dm` enviado ou pendente para o `order_id`; uma consulta indexada por pedido, só no caso F). Novo teste em `src/test/` cobrindo a decisão.
- Primeiro passo: confirmar nos registros do agendador por que o F não foi criado para a helda.
- Deploy das duas funções. Nada de tela muda, então não precisa publicar.
- Nenhum envio a cliente sem autorização: o reenvio dos 2 pedidos de hoje é um passo separado.

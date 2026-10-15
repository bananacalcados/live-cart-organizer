# Divisão de vendas por percentual entre gateways (com cascata de reserva)

## Objetivo
No módulo ADMINISTRAÇÃO, definir quantos % das vendas no cartão começam em cada gateway (Mercado Pago, Pagar.me, AppMax; AustPay fica bloqueada até ter credenciais de produção). Se o gateway sorteado recusar, a venda segue para os próximos, como acontece hoje.

Regras que não mudam:
- Pix continua só no Mercado Pago (desconto de 5% e regra do cashback intactos).
- Débito continua só no Mercado Pago.
- A proteção contra cobrança em dobro (pagamento em andamento por 20 min) continua igual.
- Com a divisão desligada, o sistema funciona exatamente como hoje.

## Etapas (uma de cada vez; peço sua autorização antes de começar a próxima)

### Etapa 1 — Configuração guardada (sem efeito nas vendas)
- Guardar os percentuais de cada gateway e um botão geral "Divisão ligada/desligada" (começa DESLIGADO).
- Só administradores podem alterar; toda alteração fica registrada (quem, quando, valores antes/depois).
- Auditoria: confirmar que a configuração salva, que vendedoras não conseguem mudar e que nenhuma venda mudou de caminho.

### Etapa 2 — Tela no ADMINISTRAÇÃO
- Quadro "Divisão entre gateways": um campo de % por gateway, soma obrigatória de 100%, gateway desativado aparece cinza e não aceita %.
- Mostra a ordem da cascata de reserva.
- Auditoria: testar salvar com soma diferente de 100% (deve barrar), salvar certo e recarregar a tela para ver os valores.

### Etapa 3 — Sorteio no checkout (ligado só em teste)
- A cada venda no cartão, o sistema sorteia o primeiro gateway conforme os %; se recusar, tenta os outros na ordem da cascata atual, sem repetir o que já recusou.
- O sorteio é gravado no pedido, então se a cliente tentar de novo ela continua no mesmo gateway inicial (evita cobrança em dois lugares).
- Auditoria: simulações de sorteio (ex.: 1.000 sorteios devem respeitar os %), teste de recusa caindo para o próximo, conferir que Pix e débito não mudaram. Só depois disso você liga a divisão.

### Etapa 4 — Acompanhamento
- No mesmo quadro do ADMINISTRAÇÃO: quanto foi vendido em cada gateway nos últimos 7/30 dias, quantas vendas caíram para a reserva e taxa de aprovação de cada um.
- Auditoria: comparar os números do quadro com as vendas reais do período.

## Detalhes técnicos
- Etapa 1: tabela pequena de configuração (ou chave em app_settings) + tabela de histórico; RLS com has_role admin; leitura pelas funções de cobrança via service_role.
- Etapa 3: a escolha entra no ponto de entrada da cascata de cartão (mercadopago/pagarme/appmax charge); gateway sorteado salvo no pedido junto do vínculo de gateway já existente; idempotência e DUPLICATE-GUARD preservados; fallback para a ordem fixa se a configuração não puder ser lida.
- Etapa 4: RPC agregada com período limitado, sem varrer tabela inteira.

# PDV no celular — Fase 2 WhatsApp

## Resultado e escopo

Construída a tela `/m/pdv/whatsapp`, independente do computador. Nenhum arquivo de envio ou tela do computador foi alterado; a única ligação é a rota mobile existente. Nenhuma publicação, mensagem real, troca real ou estorno real. Não foram criados segredos, filas de mensagens nem notificações da Fase 3.

As quatro fontes de produtos continuam `erp` e `pos_mobile_redirect` continua `off`, conferidos por leitura ao final.

### Lista e conversa
- Conversas por loja e instância, busca de nome/telefone no servidor, filtros de linha, pagamento, arquivadas e disparos; 50 por página, teto de 100 no servidor.
- Nomes, última mensagem, horário, não lidas e atendente; usa a tabela-resumo atual. Pedidos das lives ativas e clientes sem conversa aparecem no filtro da live. O marcador de live não substitui a linha normal de atendimento.
- Novas, Não lidas e Follow Up ordenadas pelas mais antigas; demais pelas mais recentes. Atualização manual/puxar para atualizar e ao voltar à aba. Nenhum polling novo.
- Uma assinatura do `useWaMessageBroadcast`, removida ao sair. Eventos são acumulados antes do debounce de 750 ms, para uma conversa não engolir o evento da outra.
- Histórico vivo de 50 em 50, cursor por data + id, depois arquivo; apenas mensagens visíveis são montadas. Atualização incremental sem buracos quando chegam mais de 50 mensagens.
- Fotos ampliáveis, player de áudio existente, vídeo, documento, carrossel e citação pelo ID do provedor. O campo acompanha a altura do visual viewport.

### Envio — Opção A
- Texto/mídia/áudio usam `useChatSender` intacto, com a instância da conversa. Foto da câmera/galeria usa a redução/orientação já existente no aparelho; documentos e gravação pelo microfone.
- Catálogo ERP usa a busca/adaptador e os helpers de foto/legenda do computador, várias cores e estoque por loja. Mesmos endpoints de catálogo e intervalo existente de 1,5 s entre cores; foto inacessível vira texto. Uma tentativa incerta interrompe as próximas cores.
- Respostas prontas e modelos aprovados da API oficial pelos endpoints existentes. A janela oficial e as proteções dos provedores continuam no servidor; nada foi liberado ou alterado.
- Trava síncrona no primeiro toque, inclusive durante preparo/upload no composer. Resposta perdida/erro/deadline local de 30 s deixa **“Não confirmada — confira na conversa antes de reenviar”**.
- Só `Reenviar` + confirmação humana repetem a tentativa. Reconexão, retorno à aba e restauração do navegador nunca enviam. Tentativas incertas ficam na sessão local; indisponibilidade de armazenamento não impede o envio.
- Eco só concilia com ID do provedor, telefone + instância exatos e, sem ID previamente conhecido, texto/mídia iguais, autor identificado e até 15 s. Ambiguidade conserva o aviso. Reenvio explícito conserva a tentativa anterior como evidência, sem fingir garantia de não duplicação.
- Opção B NÃO implementada.

### Ações da cliente
- Páginas de ficha, compras/pedidos, cashback e solicitações de estorno; detalhe do pedido com link salvo para ver/copiar/reenviar e acompanhamento.
- Edição da ficha pelo mesmo `EditCustomerDialog`/propagação existente, somente quando há uma identificação unificada única. Nenhum CPF é enriquecido por uma identidade ambígua.
- Pedido pago usa `CustomerOrderActions`, incluindo os fluxos existentes de troca presencial/com envio e devolução. O cartão de troca em andamento continua usando os mesmos controles de reposição, diferença, pagamento por fora e conversão. Estorno e decisões administrativas usam os mesmos diálogos de duas etapas e conferência de senha/fiscal.
- Marcar como lida, atribuir atendente da loja e mover linha usam os mesmos registros e chaves do computador. Identidade da vendedora ligada prevalece sobre a conta do aparelho, como hoje.
- As regras financeiras não foram reescritas. Esses controles são compartilhados, mas seus fluxos completos no celular ainda precisam de validação específica, conforme a lista abaixo.

## Migração — somente aditiva

0322–0326 acrescentam/revisam apenas `mobile_whatsapp_page` e um índice de telefone normalizado para os chamados de suporte abertos. Consulta SECURITY INVOKER, exige equipe + módulo `pos`, revoga PUBLIC/anon e concede execução explicitamente a authenticated/service_role. Não há tabela nova, trigger novo, cron, alteração de RLS, dados reais nem mudança de RPC do computador. As revisões alinham a permissão/cargos existentes e corrigem paridade/desempenho antes do uso.

## Consultas medidas

Medição na prévia autenticada, com gravações bloqueadas; tempos são de uma sessão, não promessa sob carga.

| Abertura | Consultas próprias | Resultado |
|---|---:|---|
| Lista, sem cache | 2 de configuração da loja/instâncias + 1 de conversas | 50 conversas, sem erro JS/HTTP |
| Lista já com configuração em cache | 1 por página/filtro/atualização | consulta medida em **450 ms**, depois **326 ms** |
| Conversa, abrindo pela lista | 1 para as últimas 50 mensagens | HTTP 200 em **93 ms** |
| Link direto de conversa | +1 consulta para resolver o alvo autorizado | antes de abrir o histórico |
| Mensagens anteriores | 1 por página viva; +1 ao mudar para arquivo | sem repetição automática |

As consultas comuns de login, permissões, lojas e vendedoras do contêiner mobile são adicionais e não estão escondidas nessa contagem. Ficha, pedidos, cashback e estornos consultam seus dados somente quando a página correspondente está montada.

Uma medição inicial da lista chegou a **4.217 ms**. A montagem de todos os candidatos da live foi retirada da abertura comum; as medições de 450/326 ms são posteriores. Não foi registrado EXPLAIN de produção nem teste de carga simultânea; isso permanece uma lacuna de desempenho.

## Testes realizados

- Suíte completa Vitest: **1.277 testes, 189 arquivos, zero falhas**.
- 30 testes focados: 17 de Opção A e 13 de paginação/permissões/linhas num PostgreSQL descartável. Repetidos após a última revisão da consulta.
- Diagnóstico anterior de reenvio continua válido: repetir explicitamente o caminho antigo faz outra chamada; não é um defeito corrigido nem promessa de entrega única.
- Navegador 390×844 com 100 conversas simuladas, histórico longo por páginas, toque duplo (uma chamada), resposta perdida, reconexão (zero reenvios), reenvio explícito, abertura da ficha e redução da altura para 500 px com campo dentro da área visível.
- Simulação: três chamadas de envio previstas, zero gravações reais, sem erro JS. Gravações/eventos auxiliares bloqueados ou respondidos em memória.
- Lista e uma conversa reais abertas somente para leitura, com HTTP 200 e sem erro JS; sem rolagem lateral na lista.
- Validação automática da prévia: último registro **build OK**. Não foi executado build/typecheck manual, vedado pelo ambiente.

## O que NÃO foi testado / limitações que impedem tratar tudo como homologado

- Teclado físico/virtual real de Android/iPhone, gravação real do microfone, câmera/galeria, HEIC, compressão e download da imagem por cada provedor.
- Envio real, eco real do provedor, 24 h/template real e cadência real. Nenhuma cliente/grupo recebeu teste.
- A nova tela de catálogo com múltiplas cores, foto ausente e upload não foi exercitada ponta a ponta no navegador nesta entrega; os helpers existentes estão cobertos pela suíte anterior.
- Fluxo completo de troca/devolução, reposição/diferença/pago por fora/conversão e solicitação/aprovação de estorno **não foram exercitados no contexto mobile**. A suíte testa regras existentes, não substitui essa homologação da montagem dos diálogos no aparelho.
- A ficha simulada foi aberta, mas a captura foi feita ainda no carregamento; não é prova visual de preenchimento/edição concluída.
- Não há comparação nova exaustiva de todas as linhas/instâncias reais entre as duas telas. O teste isolado cobre prioridades/ordem/permissões, mas não cobre a memória local de 5 minutos da linha anterior do desktop, grupos espelhados, todos os filtros legados nem falhas/reconexão de assinatura real.
- Build de produção e tipos separados, Deno completo e carga concorrente não foram executados nesta entrega.
- O computador não tem um atalho existente para abrir a conversa exata pela URL. Acrescentá-lo mudaria seu comportamento além de extração; **não foi feito**. Portanto o fallback direto para essa conversa e ferramentas especializadas (status, envio em massa, gestão de templates, apagar/editar mensagens, bloqueio e finalização detalhada) ficam fora desta entrega.

**Status:** interface e caminhos montados e verificações acima concluídas; homologação integral da Fase 2 ainda pendente. Não publicar como totalmente homologada com base somente na suíte.

## Roteiro no aparelho — depois de autorização para teste controlado

1. Abrir `/m/pdv/whatsapp`, escolher loja/vendedora em Mais; comparar lista, instância, linha, não lidas e atendente com o PC.
2. Buscar conversa antiga por nome/telefone; carregar mais, puxar para atualizar, abrir conversa e rolar até o arquivo.
3. Com contato de teste autorizado: texto/toque duplo, câmera/galeria, duas cores ERP, cor sem foto, documento e áudio; conferir a instância e a citação do outro lado.
4. Cortar internet durante envio: conferir aviso, reconectar e assegurar que nada é reenviado; só depois de olhar a conversa usar Reenviar. Testar eco seguro e ambíguo.
5. Abrir teclado Android/iPhone em retrato e paisagem; conferir campo/botão, ampliar foto e ouvir áudio.
6. Com venda inteiramente de teste: ficha, link, cashback, troca/devolução, diferença/pago por fora/conversão; depois solicitação de estorno com funcionário e aprovação com admin. Não usar pedido real para homologação.
7. Comparar alterações e permissões com o PC e observar consultas/tempo com várias pessoas simultaneamente antes de habilitar o convite.

## Fase 3

Permanece só a proposta já documentada em `FASE-2-BLOQUEIO-E-PROPOSTA-3-2026-11-28.md`; nenhum aviso push, inscrição de aparelho, segredo ou envio foi implementado.
# RH — fases 3 e 4

Implementadas sem publicação do front, aviso WhatsApp ou automação Instagram. Planos preservados.

## Consultas
- Aba RH: 2 RPCs ao abrir (`rh_admin_context`, `rh_list_links`). Confirmado pela rede do navegador.
- Detalhe: 1 RPC (`rh_candidate_detail`), confirmado pela rede.
- Troca para Candidatos, busca, filtro ou página: 1 RPC por ação. Configurações: 1 RPC ao abrir e 1 para salvar. Sem polling.
- Senha: chamadas adicionais apenas ao definir/destravar. Contagem acima não inclui sessão/permissão do PDV nem controles globais preexistentes.

## Testado
- 26 testes de nota: permanência 7,5 sem experiência, limites 3/6/12 meses, média, computador 0/3/5, transporte 6/6/6/5/3, bairro sem acento/caixa e teto 10, pergunta com emoji, aviso de retorno, tamanho 200/201, não topa sem mudar nota, componentes IA, parcial e privacidade do payload.
- Duas chamadas reais Gemini Flash no total: uma manual (86,5) e uma disparada pelo submit público (79,5). Segunda resposta avaliada com prompt reforçado para descrever ações das respostas, não traços pessoais.
- Submit público retornou em 221 ms sem aguardar IA; avaliação completa leu de volta pelo detalhe.
- Uma falha controlada, sem chamada à IA: parcial persistida; sem pontos inventados de ação/tom/situação.
- Quarta reavaliação bloqueada no servidor antes da IA (contador de teste em 3).
- Anônimo sem leitura ou execução de listagem; authenticated sem execução de claim. RH RPCs verificam admin no servidor.
- Senha inicialmente vazia bloqueia; primeira definição pela tela; exige destravar depois; 5 erros bloqueiam por 5 minutos.
- Aba, configurações e detalhe em 390 px; detalhe também em desktop. Sem chat/controles internos na candidatura pública.
- Paginação de 50, segunda página, busca no servidor, não topa no fim, status/observação com releitura, exclusão via confirmação com releitura nula.
- Adicionar/excluir bairro e salvar configuração pela tela.
- Link enviado impede novo cadastro; abertura sem digitar já cria candidato incompleto, encontrado pelo filtro do servidor.
- Detalhe sem sessão vai ao login com destino preservado; restauração de sessão volta ao mesmo detalhe.
- Compilação sem erros.

## Não testado
- Login com senha de uma conta real do início ao fim: retorno foi validado restaurando a sessão no login.
- Conta autenticada não-admin real: não há tal conta disponível; checagens admin e grants foram conferidos.
- Não foram repetidos testes de rascunho, menoridade, 10 experiências e limites de acesso da fase 2.
- Não testado em aparelho físico. Sem carga massiva de candidatos.
- Não houve aviso WhatsApp, automação Instagram ou publicação.

## Limpeza
Links/candidatos/avaliações fictícios e eventos de acesso RH desses links removidos. Senha e tentativas RH removidas, deixando configuração inicial vazia. Dados reais preservados; logs operacionais não foram apagados.

## Alterações
- `rh-score`: claim atômico, avaliação stream Gemini, nota regra/IA, parcial e limite manual.
- `rh-public`: dispara avaliação assíncrona, sem aguardar; `rh_public_open` inclui quem apenas abriu como incompleto.
- `RhDashboard`, `RhGate`, `RhCandidateActions`, `RhSettings`, `RhCandidatePage`, helpers RH, integração mínima no Dashboard/App/Login e ocultação específica em /vaga nos controles globais.
- Novas funções: `rh_admin_context`, `rh_list_candidatos`, `rh_candidate_detail`, `rh_update_candidato`, `rh_admin_config`, `rh_save_config`, `rh_score_claim`, `rh_score_finish`.
- Deploys: somente `rh-score` e `rh-public`.
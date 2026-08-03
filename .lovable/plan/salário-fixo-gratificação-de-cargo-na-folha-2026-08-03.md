# Salário fixo + gratificação de cargo na FOLHA

## Objetivo
Permitir cadastrar, por vendedora (uma única vez), o salário fixo e o percentual de gratificação de cargo de confiança, para que a aba FOLHA já mostre o valor final a pagar no mês (salário + gratificação + comissão), antes de enviar para a contabilidade.

## Como vai funcionar

1. **Cadastro por pessoa (permanente)**
   Na seção de configuração de pessoas da FOLHA (onde hoje ficam "Recebe todas as lives" e "Meta manual"), entram duas novas colunas:
   - **Salário fixo (R$)** — valor mensal, salvo na vendedora e reaproveitado todo mês.
   - **Gratificação de cargo (%)** — ex.: Viviane gerente = 40%.
   Ambos são opcionais; em branco = 0.

2. **Cálculo do salário final**
   ```text
   Gratificação = Salário fixo x (% cargo / 100)
   Base salarial = Salário fixo + Gratificação
   Total a pagar = Base salarial + Comissão do período
   ```

3. **Exibição na tabela da FOLHA**
   Novas colunas por vendedora: Salário, Gratificação, Comissão (já existe) e **Total a pagar** (destacado).
   Rodapé com os totais gerais: soma de salários, gratificações, comissões e total geral da folha.

4. **Exportação**
   O CSV/exportação atual da FOLHA passa a incluir as novas colunas.

## Detalhes técnicos

- Migração: adicionar em `pos_commission_people` as colunas `base_salary numeric default 0` e `role_bonus_percent numeric default 0`.
- `src/lib/pos/payroll.ts`: `PayrollPerson` ganha `base_salary` e `role_bonus_percent`; `PersonRow` ganha `baseSalary`, `roleBonusPercent`, `roleBonusValue` e `totalPayout` (salário + gratificação + comissão). Cálculo puro, coberto por testes em `src/test/payroll.test.ts`.
- `src/components/pos/POSPayrollTab.tsx`: carregar os novos campos no select, dois inputs de edição (salvamento onBlur, igual à meta manual), novas colunas na tabela + linha de totais e ajuste do export.
- `src/components/pos/POSStoreScaledGoals.tsx` continua focado em metas/comissão; sem alteração (salário é assunto da FOLHA).

## Fora do escopo
Descontos (INSS, faltas, vale), adiantamentos e histórico mensal de salário — o valor cadastrado é sempre o vigente.

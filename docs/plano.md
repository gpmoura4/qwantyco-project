# Plano incremental

Prazo: 5 dias corridos a partir do recebimento;

Regras: um passo por vez; cada passo termina com algo verificável; ao fim de cada passo, atualizar este arquivo, `docs/requisitos.md` e `docs/decisoes.md`, entregar o relatório e esperar o OK.

Status: `[ ]` pendente · `[~]` em andamento / aguardando OK · `[x]` concluído

| # | Status | Passo | Termina com (verificação) | Requisitos | Git |
|---|--------|-------|---------------------------|------------|-----|
| 1 | [x] | **Setup**: Next.js + TS estrito, Vitest, `.env.example`, `.gitignore`, Node fixado, docs, CLAUDE.md, README esqueleto | `npm run dev`, `npm run build` e `npm test` funcionando | E01, E02 (esqueleto) | commit + **push** |
| 2 | [x] | **Domínio sem LLM**: massa mockada, schemas Zod dos contratos, 3 tools como funções puras, guarda "só aberto escalona" na função | Testes unitários de mocks, schemas, tools e guarda | R03–R07 | commit |
| 3 | [x] | **Grafo mínimo**: estado tipado, nó do modelo, executor com allowlist + validação de argumentos, checkpointer em memória com `thread_id` por sessão, modelo injetável (fake nos testes). Ao final: escolher o modelo local e rodar um smoke manual com ele | T01, T07, tool desconhecida e args inválidos passando; smoke com modelo real | R08–R10, R13 (parcial) | commit + **push** |
| 4 | [x] | **Aprovação humana**: proposta (chamado, resumo, justificativa), `interrupt` e retomada, validação da aprovação contra a proposta pendente, idempotência, rejeição sem registro | T02, T03, T04 passando | R02, R11 (backend), R12 | commit |
| 5 | [ ] | **Falhas e limites**: falha transitória com retry limitado, timeout por tool, limite total de execução ativa (sem contar espera humana), erro controlado | T05, T06 passando | R13, R14 | commit + **push** |
| 6 | [ ] | **Rotas de API Next.js**: mensagem e decisão de aprovação, separação de sessões | Testes das rotas | R11, R12 | commit |
| 7 | [ ] | **UI de chat**: mostra a proposta exata com aprovar/rejeitar | Fluxo manual no navegador | R11 | commit + **push** |
| 8 | [ ] | **Tracing LangSmith**: modelo, nós, tools, args, resultados, erros, aprovação/retomada; metadata/tags de sessão e execução; sem segredos | Trace completo visível no LangSmith | R15 | commit |
| 9a | [ ] | **Dataset + avaliador por código (offline)** | Avaliador aprova resposta correta e reprova "pulou a consulta" e "inventou chamado" | R16–R18 | commit |
| 9b | [ ] | **Experimento com modelo real** no LangSmith | Experimento visível no LangSmith | R16, R19 | commit + **push** |
| 10 | [ ] | **README final + revisão** contra `docs/requisitos.md` | Checklist completo | E01–E05 | commit + **push** |
| 11 | [ ] | **(Opcional) Bônus**: Assistants (suporte/viagens) no mesmo grafo + RAG local — só se o Guilherme decidir | Testes de separação | B1–B4 | commit + **push** |

## Cadência de git

- Commit ao fim de cada passo, **somente após o OK do Guilherme**.
- Push nos passos marcados acima (1, 3, 5, 7, 9b, 10, 11) ou quando o Guilherme pedir.
- Antes de qualquer commit: conferir `git status` para garantir que `.env`, PDFs e `docs/references/` não entram.

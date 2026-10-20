# Fluxo de execução

Mostra **quem chama quem** entre os arquivos quando o assistente roda. Atualizado ao fim de cada passo.
Os diagramas são Mermaid (renderizam no GitHub e no preview de Markdown do VS Code).

**Estado atual:** Passo 7 (com ajustes D38, D40 e D41). A UI de chat (`src/app/chat.tsx`) usa a API Next.js (`/api/chat` e `/api/chat/decision`), que expõe o agente: consulta, escalonamento com aprovação humana, retry, timeout e limites. O tracing no LangSmith entra no Passo 8.

---

## 1. Visão em camadas (caminho de uma requisição)

```mermaid
flowchart TD
    C["UI de chat (src/app/chat.tsx)<br/>ou curl"] -->|"fetch POST"| R["Rotas Next.js<br/>api/chat · api/chat/decision<br/>(Zod → core → HTTP)"]
    R -.->|getRuntime| RT["runtime.ts<br/>grafo + store + checkpointer<br/>(um por processo, globalThis)"]
    R --> CH["chat.ts<br/>sendMessage · sendDecision"]
    CH --> AP["approval.ts<br/>decideProposal<br/>(valida a decisão)"]
    CH --> RUN["run.ts · runAgent<br/>limite de passos e tempo"]
    AP --> RUN
    RUN --> G["graph.ts (LangGraph)<br/>callModel · executeTools · humanApproval"]
    G --> M["Modelo<br/>ChatOllama (qwen2.5) ou fakeModel"]
    G --> X["executor.ts<br/>allowlist · Zod · regras · saída"]
    G --> GD["guard.ts · checkReply<br/>resposta final x evidência das tools"]
    X --> T["tools.ts<br/>listar_chamados · get_ticket"]
    T --> D["domain/<br/>tickets · escalations · schemas"]
    G -->|"humanApproval:<br/>registerEscalation"| D
    X -->|"checkEscalationAllowed<br/>(proposta)"| D
```

Leitura de cima para baixo: cada camada só conhece a de baixo. As regras de negócio ficam em `domain/` e no executor, nunca nas rotas nem no prompt.

---

## 2. Mapa detalhado de arquivos (quem importa/chama quem)

```mermaid
flowchart TD
    subgraph Entrada["Pontos de entrada"]
        PAGE["src/app/page.tsx<br/>(Server Component)"]
        CLIENT["src/app/chat.tsx<br/>'use client' · fetch"]
        SMOKE["scripts/smoke.ts<br/>(modelo real)"]
        TEST["tests/*.test.ts<br/>(fakeModel)"]
    end

    subgraph Next["src/app/api/chat — Next.js (rotas finas)"]
        RCHAT["route.ts<br/>POST /api/chat"]
        RDEC["decision/route.ts<br/>POST /api/chat/decision"]
        HTTPH["http.ts<br/>parseBody() · toResponse()"]
    end

    subgraph Core["src/agent — core (nunca importa next)"]
        RUNTIME["runtime.ts<br/>getRuntime() em globalThis · createRuntime()"]
        CHAT["chat.ts<br/>sendMessage() · sendDecision() · schemas da API"]
        MODEL["model.ts<br/>createChatModel() → ChatOllama"]
        RUN["run.ts<br/>runAgent() · DEFAULT_LIMITS"]
        APPROVAL["approval.ts<br/>decideProposal() · getPendingProposal() · confirmationText()"]
        FAULTS["faults.ts<br/>parseFaults() · TransientToolError"]
        GRAPH["graph.ts<br/>buildGraph() · callModel · executeTools · humanApproval"]
        PROMPT["prompt.ts<br/>SYSTEM_PROMPT"]
        EXEC["executor.ts<br/>executeToolCall() · toToolMessage()"]
        GUARD["guard.ts<br/>findReplyViolation() · alreadyCorrected()"]
        TOOLS["tools.ts<br/>createTools(store): listar_chamados · get_ticket · register_escalation"]
        subgraph Domain["domain/ — funções puras"]
            TICKETS["tickets.ts<br/>listTickets() · getTicket() · mocks"]
            ESC["escalations.ts<br/>store · checkEscalationAllowed() · registerEscalation()<br/>getTicketView() · listTicketViews()"]
            SCHEMAS["schemas.ts<br/>contratos Zod · Proposal · Decision · ToolResult"]
        end
    end

    OLLAMA[("Ollama local<br/>qwen2.5:7b-instruct")]
    SAVER[("MemorySaver<br/>checkpoint por thread_id")]

    PAGE --> CLIENT
    CLIENT -->|"POST { sessionId, message }"| RCHAT
    CLIENT -->|"POST { sessionId, proposta_id, decisao }"| RDEC
    RCHAT --> HTTPH
    RDEC --> HTTPH
    RCHAT -->|getRuntime| RUNTIME
    RDEC -->|getRuntime| RUNTIME
    RCHAT -->|sendMessage| CHAT
    RDEC -->|sendDecision| CHAT
    RUNTIME --> MODEL
    RUNTIME -->|"buildGraph + MemorySaver"| GRAPH
    RUNTIME -->|"parseFaults(env)"| FAULTS
    RUNTIME -->|createEscalationStore| ESC
    CHAT -->|"runAgent(mensagem)"| RUN
    CHAT -->|"getPendingProposal · decideProposal"| APPROVAL
    SMOKE -->|"buildGraph · runAgent · decideProposal"| GRAPH
    TEST -->|"rotas, createRuntime, buildGraph..."| RUNTIME
    MODEL -.->|HTTP| OLLAMA
    RUN -->|"invoke com recursionLimit + signal"| GRAPH
    APPROVAL -->|getState| GRAPH
    APPROVAL -->|"runAgent(Command resume)"| RUN
    APPROVAL --> ESC
    GRAPH --> PROMPT
    GRAPH --> TOOLS
    GRAPH --> EXEC
    GRAPH -->|"checkReply"| GUARD
    GRAPH -->|"humanApproval: registerEscalation()"| ESC
    GRAPH -->|confirmationText| APPROVAL
    GRAPH <-.->|"lê e grava o estado"| SAVER
    EXEC --> TOOLS
    EXEC -->|"falhas simuladas"| FAULTS
    GRAPH -->|"retryOn"| FAULTS
    EXEC -->|"checkEscalationAllowed()"| ESC
    TOOLS -->|"visão chamado + escalonamento"| ESC
    TOOLS --> TICKETS
    ESC --> TICKETS
    TICKETS --> SCHEMAS
    ESC --> SCHEMAS
    EXEC --> SCHEMAS
```

> As **rotas** só validam o corpo (Zod), chamam `chat.ts` e traduzem o resultado em HTTP. Nenhuma regra de negócio fica nelas.
>
> `runtime.ts` guarda **um** grafo, store e checkpointer por processo em `globalThis`, para o hot reload do `next dev` não apagar as sessões. Os testes trocam o modelo por `fakeModel()` com `setRuntimeForTests()`. O grafo, o executor e o domínio são os mesmos.
>
> `run.ts` é a porta de entrada de **toda execução**: aplica o limite de passos e de tempo por invocação e converte estouros em erro controlado.
>
> `approval.ts` é a porta de entrada da **decisão humana**, chamada pela rota de decisão via `chat.ts`.

---

## 3. O grafo (nós e arestas do LangGraph)

```mermaid
flowchart LR
    START((START)) --> CM["callModel<br/>(LLM decide)"]
    CM --> R1{"routeAfterModel<br/>tem tool_calls?"}
    R1 -- não --> CR{"checkReply<br/>(guard da resposta)<br/>violação?"}
    CR -- não --> END((END))
    CR -->|"1ª violação no turno:<br/>remove resposta + correção"| CM
    CR -->|"2ª violação:<br/>mensagem honesta"| END
    R1 -- sim --> ET["executeTools<br/>(valida; leitura executa;<br/>escrita vira proposta)"]
    ET --> R2{"routeAfterTools<br/>pendingProposal?"}
    R2 -- não --> CM
    R2 -- sim --> HA["humanApproval<br/>interrupt(proposta)<br/>⏸ espera decisão"]
    HA -->|"aprovar: registra<br/>rejeitar: nada"| END
```

Estado (`AgentState`): `messages` (histórico) + `pendingProposal` (proposta aguardando decisão, ou `null`).

`checkReply` (D40) confere a resposta final contra as tools: (1) pedido de escalonamento explícito, chamado aberto e sem escalonamento no `get_ticket` do turno, mas sem `register_escalation`; (2) texto afirma proposta criada sem `register_escalation`; (3) cita `CH-xxx`/`ESC-xxx` que nenhuma tool retornou. No máximo uma correção por turno.

Políticas por nó (nativas do LangGraph, D29):

| Nó | Retry | Timeout por tentativa | Retenta quando |
|----|-------|-----------------------|----------------|
| `callModel` | até 2 tentativas | 60 s | qualquer erro, exceto abort |
| `executeTools` | até 3 tentativas (backoff 0,5 s → 1 s) | 5 s | `TransientToolError` ou `NodeTimeoutError` |
| `humanApproval` | — | — | — |

Por invocação (`runAgent`, D30): no máximo 12 passos e 120 s. A espera humana fica fora porque a pausa encerra a invocação.

---

## 4. Sequência: consulta simples ("Liste todos os chamados abertos.")

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant E as smoke.ts / teste
    participant G as graph.ts
    participant S as MemorySaver
    participant M as Modelo (ChatOllama ou fakeModel)
    participant X as executor.ts
    participant T as tools.ts
    participant D as domain/tickets.ts

    U->>E: "Liste todos os chamados abertos."
    E->>G: runAgent → graph.invoke({ messages }, { thread_id, recursionLimit, signal })
    G->>S: carrega o histórico do thread_id
    Note over G: nó callModel
    G->>M: [SystemMessage(prompt.ts), ...messages] + tools (bindTools)
    M-->>G: AIMessage com tool_call listar_chamados { situacao: "aberto" }
    Note over G: executeTools
    G->>X: executeToolCall(toolCall, allowlist, store)
    X->>X: allowlist ok · Zod ok
    X->>T: tool.invoke({ situacao: "aberto" })
    T->>D: listTicketViews(store, { situacao: "aberto" })
    D-->>X: { ok: true, data: [CH-101, CH-103] } (cada um com "escalonamento")
    X-->>G: ToolMessage (status "success")
    Note over G: sem proposta → volta para callModel
    G->>M: [System, Human, AIMessage(tool_call), ToolMessage]
    M-->>G: AIMessage "Chamados abertos: CH-101 e CH-103"
    G->>S: checkpoint final
    G-->>E: estado final
    E-->>U: resposta do assistente
```

Pontos-chave:
- O **modelo nunca executa nada**: ele só devolve uma `AIMessage` com a intenção (nome + argumentos).
- Quem executa é o **executor**, depois de validar. O resultado volta ao modelo como `ToolMessage`, e a resposta final é baseada nele.
- O **MemorySaver** guarda o estado por `thread_id`. Na próxima mensagem da mesma sessão, o histórico é carregado no início do `invoke`.

---

## 5. Sequência: escalonamento com aprovação ("Consulte o CH-101 e prepare um escalonamento")

São **duas chamadas** ao grafo: a primeira pausa no `interrupt`; a segunda (a decisão humana) retoma do ponto salvo no checkpoint.

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant E as UI (chat.tsx) → rotas /api/chat* → chat.ts
    participant A as approval.ts
    participant G as graph.ts
    participant S as MemorySaver
    participant M as Modelo
    participant X as executor.ts
    participant ES as domain/escalations.ts

    U->>E: POST /api/chat { sessionId, "Consulte o CH-101 e prepare um escalonamento" }
    E->>E: parseBody (Zod) · sem proposta pendente nesta sessão?
    E->>G: runAgent → graph.invoke(HumanMessage, { thread_id: sessionId })
    G->>M: callModel
    M-->>G: tool_call get_ticket { chamado_id: "CH-101" }
    G->>X: executeTools → get_ticket executa
    X-->>G: ToolMessage (CH-101 aberto)
    G->>M: callModel
    M-->>G: tool_call register_escalation { chamado_id, resumo, justificativa }
    G->>X: executeTools
    X->>X: allowlist ok (requiresApproval) · Zod ok
    X->>ES: checkEscalationAllowed(store, "CH-101")
    ES-->>X: ok (aberto e ainda não escalonado)
    X-->>G: proposta { id: "prop-…", chamado_id, resumo, justificativa } — nada registrado
    Note over G: routeAfterTools → humanApproval
    G->>G: interrupt(proposta) ⏸
    G->>S: checkpoint (grafo pausado)
    G-->>E: retorna com a proposta pendente
    E->>A: getPendingProposal(thread_id)
    A-->>E: proposta exata
    E-->>U: 200 { kind: "approval_required", proposal, reply } → cartão com Aprovar / Rejeitar, campo de mensagem bloqueado

    Note over U,ES: ... tempo de espera humana (não consome o limite de execução) ...

    U->>E: clica Aprovar → POST /api/chat/decision { sessionId, proposta_id, decisao: "aprovar" }
    E->>A: parseBody (Zod) → decideProposal({ proposta_id, decisao })
    A->>G: getState → proposta pendente?
    A->>A: mesma proposta_id? sim
    A->>G: runAgent(Command({ resume: decisão })) — orçamento novo
    G->>S: carrega o checkpoint pausado
    Note over G: humanApproval roda de novo desde o começo —<br/>interrupt() agora devolve a decisão (validada por Zod)
    G->>ES: registerEscalation(store, proposta)
    ES->>ES: idempotência por proposta_id · guardas de novo
    ES-->>G: { ok: true, data: ESC-001 }
    G->>ES: getTicketView(CH-101) → chamado + escalonamento ESC-001
    G->>G: ToolMessage (visão atualizada, mesmo formato do get_ticket) + AIMessage determinística
    G->>S: checkpoint final (pendingProposal = null)
    G-->>A: estado final
    A-->>E: "Escalonamento ESC-001 registrado para o chamado CH-101."
    E-->>U: 200 { kind: "reply", reply }
```

Se a decisão for **rejeitar**, o passo `registerEscalation` não acontece e a mensagem é "Escalonamento rejeitado. Nada foi registrado."

---

## 6. Sequência: falha transitória, retry e erro controlado

Exemplo com `SIMULATE_TOOL_FAILURE=listar_chamados:error:2` (cada chamada falha nas 2 primeiras tentativas).

```mermaid
sequenceDiagram
    autonumber
    participant E as smoke.ts / teste
    participant R as run.ts
    participant G as graph.ts (LangGraph)
    participant M as Modelo
    participant X as executor.ts
    participant F as faults.ts
    participant T as tools.ts

    E->>R: runAgent(graph, { messages }, threadId)
    R->>G: invoke(..., { recursionLimit: 12, signal: AbortSignal.timeout(120 s) })
    G->>M: callModel
    M-->>G: tool_call listar_chamados { situacao: "aberto" }
    loop retryPolicy do nó executeTools (até 3 tentativas)
        G->>X: executeTools (tentativa n)
        X->>F: falha simulada para esta tentativa?
        alt tentativas 1 e 2
            F-->>X: lança TransientToolError
            X-->>G: exceção → retryOn = true → espera (backoff) e tenta de novo
        else tentativa 3
            X->>T: tool.invoke → listTickets
            T-->>X: { ok: true, data: [CH-101, CH-103] }
            X->>X: outputSchema ok
            X-->>G: ToolMessage success
        end
    end
    G->>M: callModel com o resultado real
    M-->>G: "Chamados abertos: CH-101 e CH-103"
    G-->>R: estado final
    R-->>E: { ok: true, data }
```

Se as 3 tentativas falharem (`listar_chamados:error:3`), a exceção sai do grafo, e o `runAgent` devolve `{ ok: false, error: { code: "EXECUTION_FAILED" } }`. O modelo **não** é chamado de novo, então nenhuma resposta é inventada. Estouro de passos (`GraphRecursionError`) ou de tempo (abort) viram `EXECUTION_LIMIT`.

---

## 7. Decisões dentro do executor (`executeToolCall`)

```mermaid
flowchart TD
    A["tool_call do modelo<br/>{ name, args, id }"] --> B{"name está na<br/>allowlist?"}
    B -- não --> E1["ToolMessage error<br/>UNKNOWN_TOOL"]
    B -- sim --> C{"args passam no<br/>schema Zod?"}
    C -- não --> E2["ToolMessage error<br/>INVALID_ARGS<br/>(nada é executado)"]
    C -- sim --> W{"requiresApproval?<br/>(register_escalation)"}
    W -- não --> FS{"falha simulada<br/>nesta tentativa?"}
    FS -- "error / timeout" --> RT["exceção → retryPolicy do nó<br/>(ou EXECUTION_FAILED ao esgotar)"]
    FS -- "invalid_output" --> O
    FS -- não --> D["tool.invoke(args)<br/>→ função do domínio"]
    D --> O{"saída passa no<br/>outputSchema?"}
    O -- não --> E5["ToolMessage error<br/>INVALID_OUTPUT<br/>(dado descartado)"]
    O -- sim --> F{"ToolResult.ok?"}
    F -- sim --> OK["ToolMessage success"]
    F -- não --> E3["ToolMessage error<br/>ex.: TICKET_NOT_FOUND"]
    W -- sim --> G{"checkEscalationAllowed<br/>aberto e não escalonado?"}
    G -- não --> E4["ToolMessage error<br/>TICKET_NOT_OPEN /<br/>ALREADY_ESCALATED<br/>(sem proposta, sem interrupt)"]
    G -- sim --> P["proposta prop-uuid<br/>→ pendingProposal<br/>(nada registrado)"]
```

---

## 8. Barreiras da decisão humana (`decideProposal` → `humanApproval` → store)

```mermaid
flowchart TD
    D["decisão chega<br/>{ proposta_id, decisao }"] --> P{"há proposta pendente<br/>nesta sessão?"}
    P -- não --> R{"proposta_id já<br/>registrada no store?"}
    R -- sim --> RE["devolve o registro existente<br/>(idempotente, sem duplicar)"]
    R -- não --> N["NO_PENDING_PROPOSAL<br/>(grafo intocado)"]
    P -- sim --> M{"proposta_id igual à<br/>pendente?"}
    M -- não --> MM["PROPOSAL_MISMATCH<br/>(grafo intocado)"]
    M -- sim --> Z{"Zod responseSchema<br/>aceita o valor?"}
    Z -- não --> ZE["erro; grafo continua pausado"]
    Z -- sim --> H{"decisao"}
    H -- rejeitar --> REJ["nada registrado<br/>'Escalonamento rejeitado...'"]
    H -- aprovar --> REG["registerEscalation:<br/>idempotência + guardas de novo"]
    REG --> OKR["ESC-xxx registrado<br/>ou ALREADY_ESCALATED"]
```

---

## Histórico de atualizações

| Passo | O que mudou no fluxo |
|-------|----------------------|
| 2 | Domínio isolado: `tickets.ts`, `escalations.ts` e `schemas.ts`, chamados só pelos testes. |
| 3 | Grafo `callModel ⇄ executeTools`, executor com allowlist + Zod, tools do LangChain, checkpointer por `thread_id`, entradas `smoke.ts` e testes. |
| 4 | Nó `humanApproval` com `interrupt`, campo `pendingProposal` no estado, `register_escalation` vira proposta no executor, `approval.ts` (`decideProposal`) valida e retoma, store idempotente por `proposta_id`, confirmação determinística. |
| 5 | `run.ts` (`runAgent`: limite de passos e tempo por invocação, erro controlado), `faults.ts` (falhas simuladas), `retryPolicy` e `timeout` nativos nos nós, validação de saída das tools (`outputSchema`) e tratamento de `invalid_tool_calls`. |
| 6 | Rotas `POST /api/chat` e `POST /api/chat/decision` (finas: Zod → core → HTTP), `chat.ts` (`sendMessage` recusa mensagem com proposta pendente, `sendDecision`), `runtime.ts` (runtime único em `globalThis`). |
| 7 | UI: `page.tsx` (Server Component) renderiza `chat.tsx` (`'use client'`), que chama as rotas com `fetch`, mostra o cartão da proposta e bloqueia o envio enquanto há proposta pendente. |
| 7 (ajuste) | Tools de leitura criadas por runtime (`createTools(store)`) e devolvendo a visão chamado + `escalonamento`; após a aprovação, o `ToolMessage` traz a visão atualizada (D38). Prompt reorganizado em passos. |
| 7 (ajuste 2) | Nó `checkReply` (`guard.ts`) após a resposta final: correção única ou mensagem honesta quando a resposta afirma ação não feita, cita dado sem fonte ou ignora pedido explícito de escalonamento (D40). UI com "Como usar" e ações rápidas (D41). |

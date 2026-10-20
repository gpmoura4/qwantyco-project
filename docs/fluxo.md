# Fluxo de execução

Mostra **quem chama quem** entre os arquivos quando o assistente roda. Atualizado ao fim de cada passo.
Os diagramas são Mermaid (renderizam no GitHub e no preview de Markdown do VS Code).

**Estado atual:** Passo 4. O grafo consulta chamados e prepara escalonamentos que pausam para aprovação humana. A API Next.js entra no Passo 6.

---

## 1. Mapa de arquivos (quem importa/chama quem)

```mermaid
flowchart TD
    subgraph Entrada["Pontos de entrada"]
        SMOKE["scripts/smoke.ts<br/>(modelo real)"]
        TEST["tests/*.test.ts<br/>(fakeModel)"]
    end

    subgraph Core["src/agent — core (nunca importa next)"]
        MODEL["model.ts<br/>createChatModel() → ChatOllama"]
        APPROVAL["approval.ts<br/>decideProposal() · getPendingProposal() · confirmationText()"]
        GRAPH["graph.ts<br/>buildGraph() · callModel · executeTools · humanApproval"]
        PROMPT["prompt.ts<br/>SYSTEM_PROMPT"]
        EXEC["executor.ts<br/>executeToolCall() · toToolMessage()"]
        TOOLS["tools.ts<br/>listar_chamados · get_ticket · register_escalation · TOOLS"]
        subgraph Domain["domain/ — funções puras"]
            TICKETS["tickets.ts<br/>listTickets() · getTicket() · mocks"]
            ESC["escalations.ts<br/>store · checkEscalationAllowed() · registerEscalation()"]
            SCHEMAS["schemas.ts<br/>contratos Zod · Proposal · Decision · ToolResult"]
        end
    end

    OLLAMA[("Ollama local<br/>qwen2.5:7b-instruct")]
    SAVER[("MemorySaver<br/>checkpoint por thread_id")]

    SMOKE --> MODEL
    SMOKE --> GRAPH
    SMOKE --> APPROVAL
    TEST --> GRAPH
    TEST --> APPROVAL
    MODEL -.->|HTTP| OLLAMA
    APPROVAL -->|"getState / invoke(Command resume)"| GRAPH
    APPROVAL --> ESC
    GRAPH --> PROMPT
    GRAPH --> TOOLS
    GRAPH --> EXEC
    GRAPH -->|"humanApproval: registerEscalation()"| ESC
    GRAPH -->|confirmationText| APPROVAL
    GRAPH <-.->|"lê e grava o estado"| SAVER
    EXEC --> TOOLS
    EXEC -->|"checkEscalationAllowed()"| ESC
    TOOLS --> TICKETS
    ESC --> TICKETS
    TICKETS --> SCHEMAS
    ESC --> SCHEMAS
    EXEC --> SCHEMAS
```

> O teste não usa `model.ts`: injeta o `fakeModel()` direto no `buildGraph`. O grafo, o executor e o domínio são os mesmos nos dois casos.
>
> `approval.ts` é a porta de entrada da **decisão humana**: no Passo 6, a rota da API vai chamar `decideProposal()` em vez do `smoke.ts`.

---

## 2. O grafo (nós e arestas do LangGraph)

```mermaid
flowchart LR
    START((START)) --> CM["callModel<br/>(LLM decide)"]
    CM --> R1{"routeAfterModel<br/>tem tool_calls?"}
    R1 -- não --> END((END))
    R1 -- sim --> ET["executeTools<br/>(valida; leitura executa;<br/>escrita vira proposta)"]
    ET --> R2{"routeAfterTools<br/>pendingProposal?"}
    R2 -- não --> CM
    R2 -- sim --> HA["humanApproval<br/>interrupt(proposta)<br/>⏸ espera decisão"]
    HA -->|"aprovar: registra<br/>rejeitar: nada"| END
```

Estado (`AgentState`): `messages` (histórico) + `pendingProposal` (proposta aguardando decisão, ou `null`).

---

## 3. Sequência: consulta simples ("Liste todos os chamados abertos.")

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
    E->>G: graph.invoke({ messages: [HumanMessage] }, { thread_id })
    G->>S: carrega o histórico do thread_id
    Note over G: nó callModel
    G->>M: [SystemMessage(prompt.ts), ...messages] + tools (bindTools)
    M-->>G: AIMessage com tool_call listar_chamados { situacao: "aberto" }
    Note over G: executeTools
    G->>X: executeToolCall(toolCall, allowlist, store)
    X->>X: allowlist ok · Zod ok
    X->>T: tool.invoke({ situacao: "aberto" })
    T->>D: listTickets({ situacao: "aberto" })
    D-->>X: { ok: true, data: [CH-101, CH-103] }
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

## 4. Sequência: escalonamento com aprovação ("Consulte o CH-101 e prepare um escalonamento")

São **duas chamadas** ao grafo: a primeira pausa no `interrupt`; a segunda (a decisão humana) retoma do ponto salvo no checkpoint.

```mermaid
sequenceDiagram
    autonumber
    actor U as Usuário
    participant E as smoke.ts / teste (Passo 6: rota da API)
    participant A as approval.ts
    participant G as graph.ts
    participant S as MemorySaver
    participant M as Modelo
    participant X as executor.ts
    participant ES as domain/escalations.ts

    U->>E: "Consulte o CH-101 e prepare um escalonamento"
    E->>G: graph.invoke(HumanMessage, { thread_id })
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
    E-->>U: mostra a proposta (aprovar / rejeitar)

    Note over U,ES: ... tempo de espera humana (não consome o limite de execução) ...

    U->>E: aprovar
    E->>A: decideProposal({ proposta_id, decisao: "aprovar" })
    A->>G: getState → proposta pendente?
    A->>A: mesma proposta_id? sim
    A->>G: invoke(Command({ resume: decisão }))
    G->>S: carrega o checkpoint pausado
    Note over G: humanApproval roda de novo desde o começo —<br/>interrupt() agora devolve a decisão (validada por Zod)
    G->>ES: registerEscalation(store, proposta)
    ES->>ES: idempotência por proposta_id · guardas de novo
    ES-->>G: { ok: true, data: ESC-001 }
    G->>G: ToolMessage + AIMessage determinística (confirmationText)
    G->>S: checkpoint final (pendingProposal = null)
    G-->>A: estado final
    A-->>E: "Escalonamento ESC-001 registrado para o chamado CH-101."
    E-->>U: confirmação
```

Se a decisão for **rejeitar**, o passo `registerEscalation` não acontece e a mensagem é "Escalonamento rejeitado. Nada foi registrado."

---

## 5. Decisões dentro do executor (`executeToolCall`)

```mermaid
flowchart TD
    A["tool_call do modelo<br/>{ name, args, id }"] --> B{"name está na<br/>allowlist?"}
    B -- não --> E1["ToolMessage error<br/>UNKNOWN_TOOL"]
    B -- sim --> C{"args passam no<br/>schema Zod?"}
    C -- não --> E2["ToolMessage error<br/>INVALID_ARGS<br/>(nada é executado)"]
    C -- sim --> W{"requiresApproval?<br/>(register_escalation)"}
    W -- não --> D["tool.invoke(args)<br/>→ função do domínio"]
    D --> F{"ToolResult.ok?"}
    F -- sim --> OK["ToolMessage success"]
    F -- não --> E3["ToolMessage error<br/>ex.: TICKET_NOT_FOUND"]
    W -- sim --> G{"checkEscalationAllowed<br/>aberto e não escalonado?"}
    G -- não --> E4["ToolMessage error<br/>TICKET_NOT_OPEN /<br/>ALREADY_ESCALATED<br/>(sem proposta, sem interrupt)"]
    G -- sim --> P["proposta prop-uuid<br/>→ pendingProposal<br/>(nada registrado)"]
```

---

## 6. Barreiras da decisão humana (`decideProposal` → `humanApproval` → store)

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

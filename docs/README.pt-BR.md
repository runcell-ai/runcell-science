# Runcell Science

**Um workspace de AI aberto e neutro em modelos para código de pesquisa, notebooks e artefatos científicos.**

Runcell Science é um workspace open source para pesquisadores e research engineers que querem AI coding agents mais fáceis de inspecionar, customizar e adaptar ao trabalho científico.

Em vez de tratar uma execução de agent como um chat descartável, Runcell mantém o ciclo de pesquisa em um só lugar: o prompt, a atividade de ferramentas, os arquivos do projeto, os artefatos gerados, a execução de notebooks, as perguntas de acompanhamento e os arquivos que o agent alterou.

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | Português

## Demo

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## O Que Torna Diferente

Muitas ferramentas de AI coding são excelentes para gerar texto e patches, mas pesquisa produz mais do que texto. Ela produz notebooks, gráficos, esboços moleculares, relatórios, arquivos intermediários, diffs e experimentos em andamento que precisam continuar inspecionáveis e interativos.

Runcell Science foi desenhado em torno dessa realidade:

- **Aberto e customizável** — o workspace, o server, os componentes de UI, os conectores científicos e os renderizadores de artefatos foram pensados para serem inspecionados, estendidos e adaptados.
- **Artefatos interativos, não anexos estáticos** — o trabalho gerado pode abrir ao lado da conversa, manter estado de UI e virar parte do próximo turno.
- **Skills e superfícies científicas** — notebooks, artefatos de química, conectores científicos, arquivos gerados e renderizadores customizados são partes centrais do workflow.
- **Neutro em modelo e runtime** — use Codex, Claude Code e as opções de modelo expostas por esses runtimes, sem ficar preso a uma única UI de assistant hospedado.
- **Traga sua assinatura existente** — Runcell pode trabalhar com o setup de Codex ou Claude Code que você já usa, incluindo acesso baseado em assinatura quando essas ferramentas oferecem suporte.
- **Um workspace, não só um chat box** — sessions, prompts, escolha de modelo, artefatos, conectores, skills e worktree diffs vivem em uma superfície focada.

## O Que Ele Pode Fazer

| Capacidade | O que oferece |
| --- | --- |
| **Agent-backed research sessions** | Inicie e continue sessões movidas por Codex ou Claude Code a partir de uma UI web, com eventos em streaming e histórico persistente. |
| **Painel de artefatos interativos** | Abra arquivos gerados, rascunhe artefatos, inspecione outputs e mantenha estado específico do renderer entre atualizações da sessão. |
| **Execução de notebooks** | Trabalhe com notebooks apoiados por Jupyter e deixe workflows de agent focarem arquivos de notebook específicos. |
| **Worktree diffs** | Revise o que mudou no projeto sem sair da conversa de pesquisa. |
| **Science connectors** | Habilite conectores MCP-style incluídos para PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide e mais. |
| **Skills-aware prompting** | Mostre skills disponíveis no composer para invocar workflows científicos de forma mais direta. |
| **Runtime choice** | Escolha o runtime e a configuração de modelo que você quer, em vez de organizar o workflow em torno de uma única UI de fornecedor. |

## Para Quem

Runcell Science é para pessoas cujo trabalho atravessa código, dados, notebooks, artigos e resultados gerados:

- research engineers criando protótipos e pipelines de análise;
- cientistas iterando em notebooks, gráficos, relatórios e código de validação;
- estudantes e equipes técnicas que não querem espalhar contexto entre terminais e janelas de chat;
- desenvolvedores criando AI-assisted scientific tools, renderers ou connectors.

## Estrutura Do Projeto

Este repositório é um monorepo TypeScript:

- `apps/web` — o browser workspace.
- `apps/server` — o API server, persistência de sessions, provider runtimes, gerenciamento Jupyter e integração MCP.
- `apps/desktop` — a shell desktop Electron para distribuição empacotada a usuários finais.
- `packages/ui` — componentes de UI compartilhados para agent sessions e superfícies de pesquisa.
- `packages/science-connectors` — registry de conectores científicos incluídos e tools compatíveis com MCP.
- `packages/nbcli` — notebook helper CLI usado por workflows de agent.

As integrações runtime atuais são:

- **Codex** por meio de uma integração JSON-RPC app-server.
- **Claude** por meio do Claude Agent SDK.

## Começando

Clone o repositório e inicie o ambiente de desenvolvimento:

```bash
./scripts/dev.sh
```

Depois abra o app web:

```text
http://127.0.0.1:27183
```

Sessões com agents esperam que o runtime correspondente de Codex ou Claude Code esteja instalado e autenticado.

Runcell Science agora também suporta um app desktop Electron para usuários finais que preferem uma aplicação instalável. O desenvolvimento diário continua passando pelo web app e pelo servidor local; o app desktop empacota essas mesmas superfícies web e server para distribuição.

## Configuração Manual

Se preferir iniciar os serviços manualmente:

```bash
yarn install
yarn dev
```

Comandos úteis:

```bash
yarn dev:web
yarn dev:server
yarn dev:desktop
yarn typecheck
yarn lint
yarn build
yarn build:desktop
yarn dist:desktop
```

## Estado Do Projeto

Runcell Science está em estágio inicial e evolui rapidamente. A direção principal é um workspace prático e hackeável para pesquisa e desenvolvimento assistidos por AI, com foco em scientific skills, interactive artifacts e agent sessions neutras em modelo.

O objetivo de curto prazo não é substituir uma plataforma completa de laboratório. É tornar o ciclo diário de pesquisa mais compacto: perguntar, executar, inspecionar, revisar e manter juntos os arquivos resultantes e o contexto.

## Visão E Roadmap

Runcell Science pretende se tornar um open research workbench que equipes possam moldar em torno de seus próprios modelos, ferramentas, datasets e domínios científicos.

Áreas que nos interessam especialmente:

- **Mais opções de modelo** — suporte mais amplo para custom providers, modelos locais ou self-hosted, OpenAI-compatible endpoints e model routing mais rico por sessão.
- **Mais scientific skills** — workflow packs mais profundos para revisão de literatura, análise de dados, química, biologia, notebooks computacionais, escrita de relatórios e verificações de reprodutibilidade.
- **Interactive artifacts mais ricos** — mais renderers para objetos científicos, melhor artifact provenance e loops mais estreitos em que outputs podem ser inspecionados, editados e enviados de volta ao agent.
- **Distribuição desktop** — o app Electron agora é suportado; os próximos passos são hardening de release, assinatura, notarização e fluxo de atualização/distribuição.
- **Connector ecosystem** — mais conectores first-party e mantidos pela comunidade para bases científicas, plataformas de computação, notebooks e ferramentas de laboratório.
- **Melhor superfície de customização** — formas mais fáceis de adicionar skills, artifact renderers, connector definitions, model presets e workflows específicos do projeto.

A direção de longo prazo é simples: manter a experiência de agent aberta, inspecionável e adaptável, enquanto outputs científicos parecem nativos em vez de anexados depois.

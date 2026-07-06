# Open Science

Open Science é um workspace local-first para pesquisadores que querem trabalhar com AI coding agents sem perder contexto, arquivos ou controle sobre o projeto.

Ele reúne conversas com agents, estado do projeto, artefatos gerados e trabalho de acompanhamento em uma interface focada. Em vez de alternar entre terminal, janelas de chat e notas espalhadas, você pode manter o fluxo de pesquisa em um só lugar.

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | Português

## O Que Ele Resolve

Pesquisa normalmente passa por código, dados, artigos, notebooks e experimentos. Open Science foi pensado para tornar esse ciclo mais fácil de gerenciar:

- Iniciar e continuar sessões de programação assistida por AI a partir de uma interface web.
- Manter respostas do agent, atividade de ferramentas e resultados gerados dentro da mesma sessão.
- Trabalhar com arquivos locais do projeto em vez de depender apenas de um fluxo de chat hospedado.
- Usar agents para ajudar com código de análise, protótipos, notebooks, documentação e tarefas de pesquisa reproduzível.

## Para Quem

Open Science é para pesquisadores, research engineers, estudantes e equipes técnicas que querem um ambiente de desenvolvimento assistido por AI mais parecido com um workspace de projeto do que com uma conversa descartável.

Ele é especialmente útil quando o trabalho é iterativo: explorar um dataset, criar um protótipo, depurar um pipeline, escrever código de análise ou transformar uma ideia em um artefato reproduzível.

## Começando

Clone o repositório e inicie o ambiente local:

```bash
./scripts/dev.sh
```

Depois abra o app web em:

```text
http://127.0.0.1:27183
```

Para executar sessões com agents, CLIs locais como `codex` ou `claude` precisam estar instaladas e autenticadas.

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
yarn typecheck
yarn lint
yarn build
```

## Estado Do Projeto

Open Science está em estágio inicial e evolui rapidamente. O foco atual é oferecer um fluxo local e prático para pesquisa e desenvolvimento assistidos por AI, com documentação intencionalmente leve e acessível para uma audiência internacional.

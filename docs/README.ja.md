# Runcell Science

**研究コード、notebook、科学 artifact のための、オープンでモデル中立な AI ワークスペース。**

Runcell Science は、研究者と research engineer のためのオープンソースのワークスペースです。AI coding agent を、より検査しやすく、カスタマイズしやすく、科学的な作業に合わせやすくします。

Agent の実行を使い捨てのチャットとして扱うのではなく、Runcell は prompt、tool activity、プロジェクトファイル、生成された artifact、notebook 実行、追加質問、agent が変更したファイルを、ひとつの研究ループにまとめます。

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | [简体中文](README.zh-CN.md) | 日本語 | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## デモ

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## 何が違うのか

多くの AI coding tool は、テキストやパッチの生成に優れています。しかし研究では、テキストだけでなく、notebook、図、分子スケッチ、レポート、中間ファイル、diff、そして検査や操作が必要な途中段階の実験も生まれます。

Runcell Science はその前提で設計されています。

- **オープンでカスタマイズしやすい** — workspace、server、UI components、scientific connectors、artifact renderers は、検査・拡張・適応しやすいように作られています。
- **静的な添付ではなく interactive artifacts** — 生成物を会話の横で開き、UI 状態を保ち、次の agent turn に戻せます。
- **科学向けの skills と surfaces** — notebooks、chemistry artifacts、scientific connectors、生成ファイル、custom renderers をワークフローの中心に置きます。
- **Model and runtime neutral** — ひとつの hosted assistant UI に縛られず、Codex、Claude Code、それらの runtime が公開する model options を使えます。
- **既存の subscription を活用** — Runcell は、すでに使っている Codex や Claude Code の setup と連携できます。それらの tools が対応する subscription-backed access も利用できます。
- **ただの chat box ではなく workspace** — sessions、prompts、model choice、artifacts、connectors、skills、worktree diffs をひとつの集中した画面で扱えます。

## できること

| Capability | 何ができるか |
| --- | --- |
| **Agent-backed research sessions** | ブラウザ UI から Codex または Claude Code powered session を開始・継続し、streamed events と persistent history を扱えます。 |
| **Interactive artifact panel** | 生成ファイル、draft artifacts、出力を開き、session 更新をまたいで renderer state を保持できます。 |
| **Notebook execution** | Jupyter-backed notebooks を使い、agent workflow が特定の notebook file に集中できるようにします。 |
| **Worktree diffs** | 研究会話から離れずに、プロジェクト内の変更を確認できます。 |
| **Science connectors** | PubMed、ChEMBL、BioMart、Ensembl、UniProt、AlphaFold、OpenAlex、GTEx、ZINC、CellGuide などの bundled MCP-style connectors を有効化できます。 |
| **Skills-aware prompting** | Composer に available skills を表示し、科学ワークフローをより直接呼び出せます。 |
| **Runtime choice** | 単一ベンダーの UI に合わせるのではなく、使いたい runtime と model configuration を選べます。 |

## 対象ユーザー

Runcell Science は、コード、データ、notebook、論文、生成物をまたいで作業する人のためのものです。

- prototype や analysis pipeline を作る research engineers。
- notebooks、plots、reports、validation code を反復する科学者。
- terminal と chat windows に文脈を散らしたくない学生や技術チーム。
- AI-assisted scientific tools、renderers、connectors を作る開発者。

## プロジェクト構成

このリポジトリは TypeScript monorepo です。

- `apps/web` — browser workspace。
- `apps/server` — API server、session persistence、provider runtimes、Jupyter management、MCP integration。
- `apps/desktop` — end-user distribution 向けの Electron desktop shell。
- `packages/ui` — agent sessions と research surfaces の共有 UI components。
- `packages/science-connectors` — bundled scientific connector registry と MCP-compatible tools。
- `packages/nbcli` — agent workflow で使う notebook helper CLI。

現在の runtime integrations:

- **Codex** — JSON-RPC app-server integration。
- **Claude** — Claude Agent SDK。

## はじめ方

リポジトリを clone して開発環境を起動します。

```bash
./scripts/dev.sh
```

次の URL で Web アプリを開きます。

```text
http://127.0.0.1:27183
```

Agent-backed sessions を実行するには、対応する Codex または Claude Code runtime をインストールし、サインインしておく必要があります。

Runcell Science は、インストール可能なアプリを好むエンドユーザー向けに Electron desktop app もサポートしました。日常的な開発とデバッグは引き続き Web app と local server で行い、desktop app は同じ Web/server surfaces を配布用にラップします。

## 手動セットアップ

自分でサービスを起動したい場合:

```bash
yarn install
yarn dev
```

よく使うコマンド:

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

## プロジェクトの状態

Runcell Science は初期段階にあり、素早く進化しています。現在の方向性は、AI-assisted research and development のための実用的で hackable な workspace です。特に scientific skills、interactive artifacts、model-neutral agent sessions に注力しています。

短期的な目標は、完全な lab platform を置き換えることではありません。質問し、実行し、検査し、修正し、結果ファイルと文脈を一緒に保つという日々の研究ループを、より密にすることです。

## Vision And Roadmap

Runcell Science は、チームが自分たちの models、tools、datasets、scientific domains に合わせて形作れる open research workbench を目指しています。

特に関心のある領域:

- **More model choices** — custom providers、local/self-hosted models、OpenAI-compatible endpoints、より豊かな per-session model routing。
- **More scientific skills** — literature review、data analysis、chemistry、biology、computational notebooks、report writing、reproducibility checks のための workflow packs。
- **Richer interactive artifacts** — 科学オブジェクト向け renderer、より良い artifact provenance、出力を検査・編集して agent に戻す tight loop。
- **Desktop app distribution** — Electron app は現在サポートされています。次のステップは release hardening、署名、notarization、update/distribution flow です。
- **Connector ecosystem** — scientific databases、compute platforms、notebooks、lab tools 向けの first-party/community connectors。
- **Better customization surface** — skills、artifact renderers、connector definitions、model presets、project-specific workflows を追加しやすくすること。

長期的な方向はシンプルです。Agent experience を open、inspectable、adaptable に保ちながら、科学的な出力を後付けの添付ではなく native な体験にします。

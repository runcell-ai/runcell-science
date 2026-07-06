# Open Science

Open Science は、研究者が AI coding agent を使いながら、プロジェクトの文脈、ファイル、作業の主導権を手元に保つための local-first ワークスペースです。

Agent との会話、プロジェクトの状態、生成された成果物、次の作業をひとつの集中したインターフェースにまとめます。ターミナル、チャット画面、散らばったメモを行き来する代わりに、研究ワークフローを一か所で扱えます。

[English](../README.md) | [简体中文](README.zh-CN.md) | 日本語 | [Español](README.es.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## 解決したいこと

研究の作業は、コード、データ、論文、notebook、実験をまたいで進みます。Open Science は、その反復的な流れを管理しやすくするために設計されています。

- ブラウザ UI から AI 支援の coding session を開始し、継続できます。
- Agent の返答、ツールの動き、生成された作業を同じ session に保管できます。
- hosted-only なチャットに閉じず、ローカルのプロジェクトファイルを中心に作業できます。
- 解析コード、プロトタイプ、notebook、ドキュメント、再現可能な研究タスクに agent の支援を使えます。

## 対象ユーザー

Open Science は、研究者、research engineer、学生、技術チームのためのものです。使い捨てのチャットスレッドではなく、プロジェクトワークスペースに近い AI 支援開発環境を求める人に向いています。

データセットの探索、プロトタイプ作成、pipeline のデバッグ、解析コードの作成、アイデアを再現可能な成果物にする作業など、反復が多い場面で特に役立ちます。

## はじめ方

リポジトリを clone して、ローカル開発環境を起動します。

```bash
./scripts/dev.sh
```

次の URL で Web アプリを開きます。

```text
http://127.0.0.1:27183
```

Agent-backed session を実行するには、`codex` や `claude` などのローカル CLI をインストールし、サインインしておく必要があります。

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
yarn typecheck
yarn lint
yarn build
```

## プロジェクトの状態

Open Science は初期段階にあり、素早く進化しています。現在は、AI 支援の研究と開発のための実用的なローカルワークフローに注力しています。ドキュメントは、国際的な読者に向けて軽量で読みやすい形に保ちます。

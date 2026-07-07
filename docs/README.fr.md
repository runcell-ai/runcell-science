# Runcell Science

**Un workspace AI ouvert et neutre vis-à-vis des modèles pour le code de recherche, les notebooks et les artefacts scientifiques.**

Runcell Science est un workspace open source pour les chercheurs et research engineers qui veulent des AI coding agents plus faciles à inspecter, personnaliser et adapter au travail scientifique.

Au lieu de traiter une exécution d'agent comme un chat jetable, Runcell garde la boucle de recherche au même endroit : le prompt, l'activité des outils, les fichiers du projet, les artefacts générés, l'exécution des notebooks, les questions de suivi et les fichiers modifiés par l'agent.

<img width="2988" height="1998" alt="runcell-science-demo" src="https://github.com/user-attachments/assets/2cb3146b-e71c-431f-9c96-8f03b2dcbe7a" />

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | Français | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## Démo

https://github.com/user-attachments/assets/5a4393ac-4720-45fa-ae0f-175733782347

## Ce Qui Le Rend Différent

Beaucoup d'outils d'AI coding excellent pour produire du texte et des patchs, mais la recherche produit plus que du texte. Elle produit des notebooks, des figures, des croquis moléculaires, des rapports, des fichiers intermédiaires, des diffs et des expériences en cours qui doivent rester inspectables et interactives.

Runcell Science est conçu autour de cette réalité :

- **Ouvert et personnalisable** — le workspace, le server, les composants UI, les connecteurs scientifiques et les renderers d'artefacts sont conçus pour être inspectés, étendus et adaptés.
- **Des artefacts interactifs, pas des pièces jointes statiques** — le travail généré peut s'ouvrir à côté de la conversation, conserver son état UI et participer au tour suivant.
- **Skills et surfaces scientifiques** — notebooks, artefacts de chimie, connecteurs scientifiques, fichiers générés et renderers custom font partie du workflow.
- **Neutre vis-à-vis des modèles et runtimes** — utilisez Codex, Claude Code et les options de modèles exposées par ces runtimes, sans être enfermé dans une seule UI d'assistant hébergé.
- **Réutilisez votre abonnement existant** — Runcell peut fonctionner avec votre setup Codex ou Claude Code existant, y compris les accès basés sur abonnement lorsque ces outils les prennent en charge.
- **Un workspace, pas seulement une chat box** — sessions, prompts, choix du modèle, artefacts, connecteurs, skills et worktree diffs vivent dans une même surface ciblée.

## Ce Qu'il Peut Faire

| Capacité | Ce que cela apporte |
| --- | --- |
| **Agent-backed research sessions** | Démarrer et poursuivre des sessions alimentées par Codex ou Claude Code depuis une UI web, avec événements streamés et historique persistant. |
| **Panneau d'artefacts interactifs** | Ouvrir les fichiers générés, rédiger des artefacts, inspecter les sorties et conserver l'état du renderer entre les mises à jour de session. |
| **Exécution de notebooks** | Travailler avec des notebooks appuyés par Jupyter et permettre aux workflows d'agent de cibler des fichiers notebook précis. |
| **Worktree diffs** | Examiner ce qui a changé dans le projet sans quitter la conversation de recherche. |
| **Science connectors** | Activer des connecteurs MCP-style intégrés pour PubMed, ChEMBL, BioMart, Ensembl, UniProt, AlphaFold, OpenAlex, GTEx, ZINC, CellGuide, et plus encore. |
| **Skills-aware prompting** | Afficher les skills disponibles dans le composer pour invoquer plus directement les workflows scientifiques. |
| **Runtime choice** | Choisir le runtime et la configuration modèle souhaités, au lieu d'organiser le workflow autour d'une seule UI fournisseur. |

## Pour Qui

Runcell Science s'adresse aux personnes dont le travail traverse code, données, notebooks, articles et résultats générés :

- research engineers qui construisent des prototypes et des pipelines d'analyse ;
- scientifiques qui itèrent sur des notebooks, figures, rapports et codes de validation ;
- étudiants et équipes techniques qui ne veulent pas disperser le contexte entre terminaux et fenêtres de chat ;
- développeurs qui construisent des AI-assisted scientific tools, renderers ou connectors.

## Structure Du Projet

Ce dépôt est un monorepo TypeScript :

- `apps/web` — le browser workspace.
- `apps/server` — l'API server, la persistance des sessions, les provider runtimes, la gestion Jupyter et l'intégration MCP.
- `apps/desktop` — la shell desktop Electron pour une distribution packagée aux utilisateurs finaux.
- `packages/ui` — composants UI partagés pour les agent sessions et surfaces de recherche.
- `packages/science-connectors` — registre de connecteurs scientifiques intégrés et outils compatibles MCP.
- `packages/nbcli` — notebook helper CLI utilisé par les workflows d'agent.

Les intégrations runtime actuelles sont :

- **Codex** via une intégration JSON-RPC app-server.
- **Claude** via le Claude Agent SDK.

## Démarrage

Clonez le dépôt et lancez l'environnement de développement :

```bash
./scripts/dev.sh
```

Ouvrez ensuite l'application web :

```text
http://127.0.0.1:27183
```

Les sessions appuyées par des agents attendent que le runtime Codex ou Claude Code correspondant soit installé et connecté.

Runcell Science prend maintenant aussi en charge une application desktop Electron pour les utilisateurs finaux qui préfèrent une application installable. Le développement quotidien continue de passer par la web app et le serveur local ; l'application desktop empaquette ces mêmes surfaces web et serveur pour la distribution.

## Configuration Manuelle

Si vous préférez démarrer les services vous-même :

```bash
yarn install
yarn dev
```

Commandes utiles :

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

## État Du Projet

Runcell Science est encore jeune et évolue rapidement. La direction principale est un workspace pratique et hackable pour la recherche et le développement assistés par AI, avec un accent sur les scientific skills, les interactive artifacts et les agent sessions neutres vis-à-vis des modèles.

L'objectif à court terme n'est pas de remplacer une plateforme de laboratoire complète. Il est de resserrer la boucle quotidienne de recherche : demander, exécuter, inspecter, réviser, et garder ensemble les fichiers produits et le contexte.

## Vision Et Roadmap

Runcell Science vise à devenir un open research workbench que les équipes peuvent façonner autour de leurs propres modèles, outils, datasets et domaines scientifiques.

Axes qui nous intéressent particulièrement :

- **Plus de choix de modèles** — support plus large des custom providers, modèles locaux ou self-hosted, OpenAI-compatible endpoints et model routing plus riche par session.
- **Plus de scientific skills** — workflow packs plus profonds pour revue bibliographique, analyse de données, chimie, biologie, notebooks computationnels, rédaction de rapports et vérifications de reproductibilité.
- **Des interactive artifacts plus riches** — davantage de renderers pour objets scientifiques, meilleure artifact provenance et boucles plus serrées où les sorties peuvent être inspectées, éditées et renvoyées à l'agent.
- **Distribution desktop** — l'application Electron est maintenant prise en charge ; les prochaines étapes sont le durcissement de release, la signature, la notarisation et le flux de mise à jour/distribution.
- **Écosystème de connecteurs** — plus de connecteurs first-party et communautaires pour bases scientifiques, plateformes de calcul, notebooks et outils de laboratoire.
- **Meilleure surface de personnalisation** — ajouter plus facilement skills, artifact renderers, connector definitions, model presets et workflows propres au projet.

La direction long terme est simple : garder l'expérience agent ouverte, inspectable et adaptable, tout en faisant des sorties scientifiques une expérience native plutôt qu'un ajout greffé après coup.

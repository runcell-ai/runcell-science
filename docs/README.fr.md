# Open Science

Open Science est un espace de travail local-first pour les chercheurs qui veulent utiliser des AI coding agents sans perdre le contexte, les fichiers ni le contrôle de leur projet.

Il rassemble les conversations avec les agents, l'état du projet, les artefacts générés et le travail de suivi dans une interface claire. Au lieu de passer sans cesse du terminal aux fenêtres de chat et aux notes dispersées, vous pouvez garder le flux de recherche au même endroit.

[English](../README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md) | [Español](README.es.md) | Français | [Deutsch](README.de.md) | [Português](README.pt-BR.md)

## Ce Que Cela Résout

Le travail de recherche traverse souvent le code, les données, les articles, les notebooks et les expériences. Open Science est conçu pour rendre cette boucle plus facile à gérer :

- Démarrer et poursuivre des sessions de programmation assistée par AI depuis une interface web.
- Garder les réponses de l'agent, l'activité des outils et les résultats générés dans la même session.
- Travailler avec les fichiers locaux du projet plutôt que dans un flux de chat uniquement hébergé.
- Utiliser l'aide des agents pour le code d'analyse, les prototypes, les notebooks, la documentation et les tâches de recherche reproductible.

## Pour Qui

Open Science s'adresse aux chercheurs, research engineers, étudiants et équipes techniques qui veulent un environnement de développement assisté par AI plus proche d'un workspace de projet que d'un simple fil de discussion jetable.

Il est particulièrement utile pour les travaux itératifs : explorer un jeu de données, construire un prototype, déboguer un pipeline, écrire du code d'analyse ou transformer une idée en artefact reproductible.

## Démarrage

Clonez le dépôt et lancez l'environnement local :

```bash
./scripts/dev.sh
```

Ouvrez ensuite l'application web :

```text
http://127.0.0.1:27183
```

Pour lancer des sessions appuyées par des agents, des CLIs locales comme `codex` ou `claude` doivent être installées et connectées.

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
yarn typecheck
yarn lint
yarn build
```

## État Du Projet

Open Science est encore jeune et évolue rapidement. L'objectif actuel est de proposer un flux local, pratique et centré sur la recherche assistée par AI, avec une documentation volontairement légère et accessible à une audience internationale.

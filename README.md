# desktop-hud

Bandeau pour l'onglet **Code** de Claude Desktop, dans l'esprit de la statusline [claude-hud](https://github.com/jarrodwatts/claude-hud) du terminal. Il s'affiche au-dessus de la zone de saisie :

```
PROJET       LIMITE 5 H     LIMITE 7 J     EXTRA                 SESSION
projet       ━─── 25 %      ━━━━ 88 %      ━━── 25 %             1,3 M tokens
⎇ main ●     ↻ 1 h 30       ↻ 3 j          12,34 € / 50,00 €     45 min
```

| Tuile | Contenu |
| --- | --- |
| **PROJET** | Dossier de la session, branche git (tronquée au-delà de 12 caractères), `●` s'il y a des modifications non commitées |
| **LIMITE 5 H / 7 J** | Consommation des limites de l'abonnement, et temps restant avant leur réinitialisation |
| **EXTRA** | Hors forfait (crédits d'usage) : montant consommé / plafond mensuel, ou « désactivé » |
| **SESSION** | Tokens cumulés (entrée, sortie et cache, sous-agents compris) et durée de la session |

Les jauges passent du vert à l'orange à 70 %, puis au rouge à 85 %. Le modèle et le contexte n'y figurent pas : Desktop les affiche déjà. Dans le terminal (CLI), le bandeau n'affiche rien.

## Prérequis

- Claude Desktop, avec l'onglet Code.
- Le CLI Claude Code (`claude`) installé, en version **2.1.295 ou plus** : les mods sont une fonctionnalité récente.
- Un abonnement Claude, pour les limites et l'extra.

Testé sous Linux.

## Installation

Dans un terminal, pas dans Desktop :

```bash
claude plugin install desktop-hud --marketplace https://github.com/jriboux-advisa/claude-desktop-hud.git
```

Puis, dans Desktop, ouvre une nouvelle session, ou tape `/reload-plugins` dans une session ouverte. Les limites et les tokens apparaissent après le premier échange de la session.

## Mise à jour

```bash
claude plugin marketplace update desktop-hud
```

```bash
claude plugin update desktop-hud@desktop-hud
```

Puis `/reload-plugins` dans Desktop, ou une nouvelle session.

## Désinstallation

```bash
claude plugin uninstall desktop-hud@desktop-hud
```

```bash
claude plugin marketplace remove desktop-hud
```

## Publier une nouvelle version

Augmente `version` dans `.claude-plugin/plugin.json` à chaque publication, pour que `claude plugin update` repère la nouvelle version. Vérifie, puis pousse :

```bash
claude plugin validate . && claude plugin test .
```

## Bon à savoir

- **Tokens** : ils sont comptés à partir du chargement du mod. Une session déjà ouverte avant l'installation ne compte pas ses échanges précédents.
- **Extra** : le mod interroge `https://api.anthropic.com/api/oauth/usage`, comme la commande `/usage` de Claude Code, au plus une fois par minute. Il ne voit jamais ton jeton : c'est Claude Code qui l'ajoute à la requête, et seulement vers les serveurs d'Anthropic.
- **Apparence** : les tuiles sont dessinées en SVG pour réduire la taille du texte. Leurs couleurs sont donc fixes, choisies pour rester lisibles en thème clair comme sombre.
- **Code** : `hooks/register.tsx`. Les tests se lancent avec `claude plugin test <dossier>`.

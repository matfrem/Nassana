# Nassana

Board 2D infini (pan / zoom façon Miro) qui affiche les lignes d'un Google Sheets comme des post-it.
La position et la couleur de chaque post-it sont stockées dans la colonne `board` du Sheet.

## Développement

```bash
npm install
npm run dev
```

## Déploiement

GitHub Pages via `.github/workflows/deploy.yml` (push sur `main`).
Dans le repo : Settings → Pages → Source : **GitHub Actions**.

## État

- [x] Canvas infini : pan, zoom centré curseur, pinch tactile
- [x] Mode lecture seule / Edit, drag des post-it (données factices)
- [ ] Connexion Google + lecture du Sheet
- [ ] Sauvegarde des positions, couleur, renommage
- [ ] Dessin sur le board
- [ ] Création / suppression de tâches

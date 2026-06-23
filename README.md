# Walmart Ounce Tracker - Site pSEO Automatisé

Site de tracking des prix au ounce Walmart pour le marché américain.

## Infrastructure

- **Stockage & Automation**: GitHub + GitHub Actions (CRON hebdomadaire)
- **Hébergement**: Cloudflare Pages (déploiement automatique)
- **Domaine**: .com (à acheter pour SEO US)

## Setup Instructions

### 1. Créer le Repository GitHub

```bash
# Créer un nouveau repo sur GitHub: wallydiet-tracker ou similaire
git remote add origin https://github.com/TON_PSEUDO/wallydiet-tracker.git
git branch -M main
git push -u origin main
```

### 2. Configurer les Secrets GitHub

Dans GitHub → Settings → Secrets and variables → Actions:

- `SCRAPERAPI_KEY`: Ta clé ScraperAPI (https://api.scraperapi.com/)

### 3. Connecter Cloudflare Pages

1. Aller sur [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Pages → Create a project → Connect to Git
3. Sélectionner ton repo GitHub
4. Build settings:
   - **Build command**: (vide)
   - **Build output directory**: (root)
   - **Root directory**: `/`

Cloudflare détectera automatiquement les changements de `index.html` et redéploiera.

### 4. Domaine .com (SEO OBLIGATOIRE)

**Pour le SEO US**: Acheter un domaine `.com` (~10€/an)

Suggestions:
- `wallydiet.com`
- `ounceprices.com`
- `walmartounce.com`
- `budgetowl.com`

Une fois acheté, dans Cloudflare Pages → Custom domains → Add domain.

## Workflow Automatisé

```
GitHub Actions (CRON hebdomadaire)
    ↓
update-data.js scrape API Oxylabs
    ↓
index.html + products-db.json modifiés
    ↓
Git commit automatique
    ↓
Cloudflare Pages détecte le commit
    ↓
Déploiement mondial en 10 secondes
```

## Manually Trigger Update

GitHub → Actions → Update Walmart Prices → Run workflow

## Monitor Updates

- **GitHub Actions**: Voir les logs d'exécution
- **Cloudflare Pages**: Voir les déploiements automatiques

---

**Prochaine étape**: Acheter le `.com` et tout connecter!

# 🎮 E-Sport Backend API

API backend pour une plateforme de gestion de tournois e-sport (EA FC, compétitions locales).

**Stack :** Node.js · Express 5 · PostgreSQL (Supabase) · JWT · bcryptjs

---

## 📁 Structure du projet

```
esport-backend/
├── index.js                # Point d'entrée — serveur Express, middleware globaux
├── db.js                   # Pool de connexion PostgreSQL (Supabase)
├── authMiddleware.js       # Middleware de vérification JWT
├── routes/
│   ├── auth.js             # Inscription, connexion, profil (/auth/*)
│   ├── teams.js            # Équipes et membres (/teams/*)
│   └── tournaments.js      # Tournois, inscriptions, matchs, scores, classement (/tournaments/*)
├── package.json
├── .env                    # Variables d'environnement (NON versionné)
└── .gitignore
```

---

## ⚙️ Variables d'environnement

Créer un fichier `.env` à la racine :

```env
PORT=3000
DATABASE_URL=postgresql://user:password@host:port/database
JWT_SECRET=une_clé_secrète_longue_et_aléatoire
```

> ⚠️ **Ne jamais versionner `.env`** ni partager ces valeurs en clair.

---

## 🚀 Démarrage

### Installation
```bash
git clone https://github.com/DAYATO10/esport-backend.git
cd esport-backend
npm install
```

### Lancement en local
```bash
npm start
```

Le serveur démarre sur `http://localhost:3000` (ou le port défini dans `.env`).

### Vérifier que tout fonctionne
```bash
curl http://localhost:3000/health
```

Réponse attendue :
```json
{ "status": "OK", "database": "Connectée à Supabase", "time": "..." }
```

---

## 🔒 Sécurité

| Couche | Détail |
|---|---|
| **Helmet** | En-têtes HTTP de sécurité (CSP, X-Frame-Options, HSTS, etc.) |
| **CORS restreint** | Seules les origines autorisées peuvent appeler l'API (apps mobiles natives autorisées par défaut) |
| **Rate limiting** | 100 req/15min globalement, **10 req/15min** sur `/auth/login` et `/auth/register` |
| **Taille du body** | Limitée à 10 Ko |
| **Mots de passe** | Hachés avec bcrypt (salt 10 rounds), jamais stockés en clair |
| **JWT** | Token signé avec `JWT_SECRET`, expire après 7 jours |
| **Validation serveur** | Toutes les autorisations (capitaine, organisateur) vérifiées côté serveur via le token JWT |

---

## 📡 Routes API

Base URL en production : `https://esport-backend-umn1.onrender.com`

### Santé

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | ❌ | État du serveur et de la connexion DB |

### Authentification (`/auth`)

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | ❌ | Créer un compte joueur |
| `POST` | `/auth/login` | ❌ | Se connecter et recevoir un JWT |
| `GET` | `/auth/me` | ✅ | Récupérer le profil du joueur connecté |

#### POST `/auth/register`
```json
{
  "username": "dayat",
  "phone_or_email": "dayat@email.com",
  "password": "monmotdepasse",
  "game_uid": "EA123456"
}
```
- `username` : 3-30 caractères, lettres/chiffres/`_`/`-`
- `password` : 6-128 caractères
- `phone_or_email` : email valide ou numéro de téléphone
- `game_uid` : optionnel

#### POST `/auth/login`
```json
{
  "phone_or_email": "dayat@email.com",
  "password": "monmotdepasse"
}
```
Réponse : `{ "token": "eyJ...", "user": { ... } }`

#### GET `/auth/me`
Header : `Authorization: Bearer <token>`

---

### Équipes (`/teams`)

| Méthode | Route | Auth | Rôle requis | Description |
|---|---|---|---|---|
| `POST` | `/teams` | ✅ | — | Créer une équipe (le créateur devient capitaine) |
| `GET` | `/teams` | ❌ | — | Lister toutes les équipes |
| `POST` | `/teams/:id/members` | ✅ | Capitaine | Ajouter un joueur à l'équipe |

#### POST `/teams`
```json
{
  "name": "Team Alpha",
  "tag": "ALP"
}
```
- `name` : 2-50 caractères
- `tag` : 2-5 caractères (converti en majuscules)

#### POST `/teams/:id/members`
```json
{ "username": "joueur123" }
```

---

### Tournois (`/tournaments`)

| Méthode | Route | Auth | Rôle requis | Description |
|---|---|---|---|---|
| `POST` | `/tournaments` | ✅ | — | Créer un tournoi |
| `GET` | `/tournaments` | ❌ | — | Lister tous les tournois |
| `GET` | `/tournaments/:id` | ❌ | — | Fiche détaillée + matchs du tournoi |
| `GET` | `/tournaments/:id/standings` | ❌ | — | Classement en direct |
| `POST` | `/tournaments/:id/register` | ✅ | Capitaine | Inscrire une équipe au tournoi |
| `POST` | `/tournaments/:id/matches` | ✅ | Organisateur | Créer un match entre deux équipes inscrites |
| `PATCH` | `/tournaments/matches/:matchId/score` | ✅ | Organisateur | Enregistrer le score d'un match |

#### POST `/tournaments`
```json
{
  "name": "Tournoi EA FC 26",
  "game": "EA FC 26",
  "max_teams": 8
}
```

#### POST `/tournaments/:id/register`
```json
{ "team_id": 1 }
```

#### POST `/tournaments/:id/matches`
```json
{ "team_a_id": 1, "team_b_id": 2 }
```

#### PATCH `/tournaments/matches/:matchId/score`
```json
{ "score_a": 3, "score_b": 1 }
```
Le vainqueur est calculé automatiquement côté serveur.

#### GET `/tournaments/:id/standings`
Barème : Victoire = 3 pts · Nul = 1 pt · Défaite = 0 pt  
Tri : points → différence de buts → buts marqués

---

## 🗄️ Schéma de la base de données

| Table | Description |
|---|---|
| `users` | Joueurs (id, username, phone_or_email, password_hash, role, game_uid) |
| `teams` | Équipes (id, name, tag, captain_id → users) |
| `team_members` | Membres d'une équipe (team_id, user_id, member_role) |
| `tournaments` | Tournois (id, name, game, max_teams, status, created_by → users) |
| `tournament_teams` | Inscriptions d'équipes aux tournois |
| `matches` | Matchs (tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status) |

---

## 🌐 Déploiement (Render)

1. Push sur `main` : `git push origin main`
2. Render redéploie automatiquement via le webhook GitHub
3. Variables d'environnement à configurer sur Render Dashboard :
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `PORT` n'est PAS nécessaire (Render le fournit automatiquement)

---

## 👤 Auteur

**DAYAT** — [@DAYATO10](https://github.com/DAYATO10)

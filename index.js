const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const pool = require('./db');

// Import des routes
const authRoutes = require('./routes/auth');
const teamRoutes = require('./routes/teams');
const tournamentRoutes = require('./routes/tournaments');
const notificationRoutes = require('./routes/notifications');

const app = express();

// --- Sécurité : en-têtes HTTP ---
// helmet ajoute automatiquement des en-têtes de protection :
// X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.
app.use(helmet());

// --- Sécurité : CORS restreint ---
// Seules les origines listées peuvent appeler l'API.
// En développement, on accepte localhost. En production, ajouter le domaine de l'app mobile.
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
  // Ajouter ici l'URL de l'app mobile en production si nécessaire
];

app.use(cors({
  origin: function (origin, callback) {
    // Autoriser les requêtes sans origin (apps mobiles natives, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origine non autorisée par CORS.'));
  },
}));

// --- Parsing JSON ---
// Limite la taille du body à 10 Ko pour éviter les payloads abusifs
app.use(express.json({ limit: '10kb' }));

// --- Sécurité : rate-limiting global ---
// Limite globale : 100 requêtes par IP toutes les 15 minutes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
});

app.use(globalLimiter);

// --- Routes ---
app.use('/auth', authRoutes);
app.use('/teams', teamRoutes);
app.use('/tournaments', tournamentRoutes);
app.use('/notifications', notificationRoutes);

// Route de test pour vérifier la liaison avec Supabase
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS server_time');
    res.json({
      status: 'OK',
      database: 'Connectée à Supabase',
      time: result.rows[0].server_time,
    });
  } catch (err) {
    console.error('Erreur connexion DB :', err.message);
    res.status(500).json({ status: 'ERROR', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur e-sport démarré sur http://localhost:${PORT}`);
});

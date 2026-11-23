const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// --- Rate-limiter spécifique à l'authentification ---
// 10 tentatives par IP toutes les 15 minutes (anti-bruteforce)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

// --- Helpers de validation ---

function isValidUsername(username) {
  // Entre 3 et 30 caractères, lettres, chiffres, underscores et tirets uniquement
  return typeof username === 'string' && /^[a-zA-Z0-9_-]{3,30}$/.test(username);
}

function isValidPassword(password) {
  // Minimum 6 caractères, maximum 128
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

function isValidPhoneOrEmail(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 100) return false;
  // Accepte un format email basique OU un numéro de téléphone (chiffres, +, espaces, tirets)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[+]?[\d\s-]{6,20}$/;
  return emailRegex.test(value) || phoneRegex.test(value);
}

// 1. INSCRIPTION D'UN JOUEUR (POST /auth/register)
router.post('/register', authLimiter, async (req, res) => {
  const { username, phone_or_email, password, game_uid } = req.body;

  // Vérification des champs obligatoires
  if (!username || !phone_or_email || !password) {
    return res.status(400).json({
      error: 'Les champs username, phone_or_email et password sont obligatoires.',
    });
  }

  // Validation stricte du format
  if (!isValidUsername(username)) {
    return res.status(400).json({
      error: 'Le pseudo doit contenir entre 3 et 30 caractères (lettres, chiffres, _ ou -).',
    });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      error: 'Le mot de passe doit contenir entre 6 et 128 caractères.',
    });
  }

  if (!isValidPhoneOrEmail(phone_or_email)) {
    return res.status(400).json({
      error: 'Veuillez fournir un email ou un numéro de téléphone valide.',
    });
  }

  try {
    // Vérifier si l'utilisateur (email/téléphone ou pseudo) existe déjà
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE phone_or_email = $1 OR username = $2',
      [phone_or_email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Ce pseudo ou ce numéro/email est déjà utilisé.',
      });
    }

    // Hacher le mot de passe avant enregistrement
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insérer le joueur dans Supabase (role par défaut : 'player')
    const newUser = await pool.query(
      `INSERT INTO users (username, phone_or_email, password_hash, role, game_uid)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, phone_or_email, role, game_uid, created_at`,
      [username, phone_or_email, password_hash, 'player', game_uid || null]
    );

    res.status(201).json({
      message: 'Compte joueur créé avec succès.',
      user: newUser.rows[0],
    });
  } catch (err) {
    console.error('Erreur /auth/register :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
  }
});

// 2. CONNEXION D'UN JOUEUR (POST /auth/login)
router.post('/login', authLimiter, async (req, res) => {
  const { phone_or_email, password } = req.body;

  if (!phone_or_email || !password) {
    return res.status(400).json({
      error: 'Veuillez renseigner phone_or_email et password.',
    });
  }

  try {
    // Chercher le joueur dans la base
    const result = await pool.query(
      'SELECT * FROM users WHERE phone_or_email = $1',
      [phone_or_email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const user = result.rows[0];

    // Comparer le mot de passe saisi avec password_hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    // Générer le jeton JWT valable 7 jours
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Connexion réussie.',
      token,
      user: {
        id: user.id,
        username: user.username,
        phone_or_email: user.phone_or_email,
        role: user.role,
        game_uid: user.game_uid,
      },
    });
  } catch (err) {
    console.error('Erreur /auth/login :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

// 3. PROFIL DU JOUEUR CONNECTÉ (GET /auth/me) — Protégée par JWT
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, phone_or_email, role, game_uid, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Joueur introuvable.' });
    }

    res.json({
      message: 'Accès autorisé au profil.',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur /auth/me :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

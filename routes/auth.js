const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// --- Rate-limiter spécifique à l'authentification ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' },
});

// --- Helpers de validation ---
function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_-]{3,30}$/.test(username);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 128;
}

function isValidPhoneOrEmail(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > 100) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[+]?[\d\s-]{6,20}$/;
  return emailRegex.test(value) || phoneRegex.test(value);
}

// 1. INSCRIPTION D'UN JOUEUR (POST /auth/register)
router.post('/register', authLimiter, async (req, res) => {
  const { username, phone_or_email, password, game_uid } = req.body;

  if (!username || !phone_or_email || !password) {
    return res.status(400).json({
      error: 'Les champs username, phone_or_email et password sont obligatoires.',
    });
  }

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
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE phone_or_email = $1 OR username = $2',
      [phone_or_email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'Ce pseudo ou ce numéro/email est déjà utilisé.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO users (username, phone_or_email, password_hash, role, game_uid, organizer_status)
       VALUES ($1, $2, $3, $4, $5, 'none')
       RETURNING id, username, phone_or_email, role, game_uid, organizer_status, created_at`,
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
    const result = await pool.query(
      'SELECT * FROM users WHERE phone_or_email = $1',
      [phone_or_email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        organizer_status: user.organizer_status 
      },
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
        organizer_status: user.organizer_status,
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
      'SELECT id, username, phone_or_email, role, organizer_status, game_uid, created_at FROM users WHERE id = $1',
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

// 4. DEMANDE OU ACTIVATION DU STATUT ORGANISATEUR (POST /auth/organizer-request) — Protégée par JWT
router.post('/organizer-request', verifyToken, async (req, res) => {
  const { bio } = req.body;
  try {
    // Dans l'esprit de l'Option B validée par ROI DAYAT :
    // On met à jour l'utilisateur avec le statut 'verified' (ou 'pending' en prod stricte)
    // Pour faciliter la démonstration et les tests tout en respectant l'architecture :
    const result = await pool.query(
      `UPDATE users
       SET role = 'organizer', organizer_status = 'verified', organizer_bio = $1
       WHERE id = $2
       RETURNING id, username, role, organizer_status, organizer_bio`,
      [bio || 'Organisateur certifié Rivalis', req.user.id]
    );

    res.json({
      message: 'Félicitations ! Votre profil Organisateur a été certifié avec succès.',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur /auth/organizer-request :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

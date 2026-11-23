const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./db');
const verifyToken = require('./authMiddleware');
const teamRoutes = require('./routes/teams');
const app = express();
app.use(express.json());
app.use('/teams', teamRoutes);

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

// 1. INSCRIPTION D'UN JOUEUR (POST /register)
app.post('/register', async (req, res) => {
  const { username, phone_or_email, password, game_uid } = req.body;

  // Vérification des champs obligatoires
  if (!username || !phone_or_email || !password) {
    return res.status(400).json({
      error: 'Les champs username, phone_or_email et password sont obligatoires.',
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
    console.error('Erreur /register :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de l’inscription.' });
  }
});

// 2. CONNEXION D'UN JOUEUR (POST /login)
app.post('/login', async (req, res) => {
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
    console.error('Erreur /login :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});
// 3. PROFIL DU JOUEUR CONNECTÉ (Route protégée par JWT)
app.get('/me', verifyToken, async (req, res) => {
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
    console.error('Erreur /me :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur e-sport démarré sur http://localhost:${PORT}`);
});
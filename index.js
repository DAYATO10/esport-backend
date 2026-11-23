const express = require('express');
require('dotenv').config();
const pool = require('./db');

const app = express();
app.use(express.json());

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
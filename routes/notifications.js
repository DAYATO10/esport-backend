const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// 1. OBTENIR MES NOTIFICATIONS (GET /notifications)
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT id, title, message, type, link_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
    );

    const unreadCount = result.rows.filter((n) => !n.is_read).length;

    res.json({
      count: result.rows.length,
      unread_count: unreadCount,
      notifications: result.rows,
    });
  } catch (err) {
    console.error('Erreur GET /notifications :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 2. MARQUER TOUT COMME LU (PATCH /notifications/read-all)
router.patch('/read-all', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [userId]);
    res.json({ message: 'Toutes les notifications marquées comme lues.' });
  } catch (err) {
    console.error('Erreur PATCH /notifications/read-all :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

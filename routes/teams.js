const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// 1. CRÉER UNE ÉQUIPE (POST /teams) — Protégée par JWT
router.post('/', verifyToken, async (req, res) => {
  const { name, tag } = req.body;
  const captainId = req.user.id; // Issu du token JWT, jamais du body

  if (!name || !tag) {
    return res.status(400).json({
      error: 'Les champs name et tag sont obligatoires.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insérer l'équipe
    const teamResult = await client.query(
      `INSERT INTO teams (name, tag, captain_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, tag, captain_id, created_at`,
      [name.trim(), tag.trim().toUpperCase(), captainId]
    );

    const newTeam = teamResult.rows[0];

    // Ajouter automatiquement le créateur dans team_members comme 'captain'
    await client.query(
      `INSERT INTO team_members (team_id, user_id, member_role)
       VALUES ($1, $2, $3)`,
      [newTeam.id, captainId, 'captain']
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Équipe créée avec succès.',
      team: newTeam,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /teams :', err.message);

    // Code PostgreSQL 23505 = violation de contrainte UNIQUE (nom ou tag déjà pris)
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'Ce nom ou ce tag d’équipe est déjà utilisé.',
      });
    }

    res.status(500).json({ error: 'Erreur serveur lors de la création de l’équipe.' });
  } finally {
    client.release();
  }
});

// 2. LISTER LES ÉQUIPES (GET /teams) — Publique
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.id,
        t.name,
        t.tag,
        t.captain_id,
        u.username AS captain_username,
        COUNT(tm.id)::int AS members_count,
        t.created_at
      FROM teams t
      JOIN users u ON t.captain_id = u.id
      LEFT JOIN team_members tm ON t.id = tm.team_id
      GROUP BY t.id, u.username
      ORDER BY t.created_at DESC
    `);

    res.json({
      count: result.rows.length,
      teams: result.rows,
    });
  } catch (err) {
    console.error('Erreur GET /teams :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des équipes.' });
  }
});

// 3. AJOUTER UN JOUEUR À UNE ÉQUIPE (POST /teams/:id/members) — Capitaine uniquement
router.post('/:id/members', verifyToken, async (req, res) => {
  const teamId = req.params.id;
  const { username } = req.body;
  const requesterId = req.user.id;

  if (!username) {
    return res.status(400).json({
      error: 'Veuillez indiquer le pseudo (username) du joueur à ajouter.',
    });
  }

  try {
    // Vérifier que l'équipe existe et que l'appelant est bien le capitaine
    const teamResult = await pool.query(
      'SELECT id, captain_id FROM teams WHERE id = $1',
      [teamId]
    );

    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Équipe introuvable.' });
    }

    if (teamResult.rows[0].captain_id !== requesterId) {
      return res.status(403).json({
        error: 'Action refusée : seul le capitaine peut ajouter des membres.',
      });
    }

    // Chercher le joueur à ajouter via son username
    const userResult = await pool.query(
      'SELECT id, username FROM users WHERE username = $1',
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Joueur introuvable.' });
    }

    const playerToAdd = userResult.rows[0];

    // Vérifier qu'il n'est pas déjà membre de cette équipe
    const existingMember = await pool.query(
      'SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, playerToAdd.id]
    );

    if (existingMember.rows.length > 0) {
      return res.status(409).json({ error: 'Ce joueur fait déjà partie de l’équipe.' });
    }

    // Insérer le joueur dans team_members
    const memberResult = await pool.query(
      `INSERT INTO team_members (team_id, user_id, member_role)
       VALUES ($1, $2, $3)
       RETURNING id, team_id, user_id, member_role, joined_at`,
      [teamId, playerToAdd.id, 'member']
    );

    res.status(201).json({
      message: `${playerToAdd.username} a rejoint l’équipe.`,
      member: memberResult.rows[0],
    });
  } catch (err) {
    console.error('Erreur POST /teams/:id/members :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de l’ajout du membre.' });
  }
});

module.exports = router;
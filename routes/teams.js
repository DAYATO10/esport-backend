const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// 1. OBTENIR MON ESCOUADE (GET /teams/my-squad) — Connecté
router.get('/my-squad', verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    // Chercher si l'utilisateur est membre ou capitaine d'une équipe
    const memberCheck = await pool.query(
      `SELECT t.id, t.name, t.tag, t.captain_id, t.created_at, tm.member_role
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
       WHERE tm.user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (memberCheck.rows.length === 0) {
      return res.json({ squad: null, members: [] });
    }

    const squad = memberCheck.rows[0];

    // Récupérer les membres avec leurs UIDs CODM
    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.game_uid, tm.member_role, tm.joined_at
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY tm.joined_at ASC`,
      [squad.id]
    );

    res.json({
      squad: {
        ...squad,
        is_captain: squad.captain_id === userId,
      },
      members: membersResult.rows,
    });
  } catch (err) {
    console.error('Erreur GET /teams/my-squad :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 2. CRÉER UNE ÉQUIPE (POST /teams) — Connecté
router.post('/', verifyToken, async (req, res) => {
  const { name, tag } = req.body;
  const captainId = req.user.id;

  if (!name || !tag) {
    return res.status(400).json({ error: 'Nom et tag requis.' });
  }

  const trimmedName = name.trim();
  const trimmedTag = tag.trim().toUpperCase();

  if (trimmedName.length < 2 || trimmedName.length > 50) {
    return res.status(400).json({ error: 'Nom entre 2 et 50 caractères.' });
  }

  if (trimmedTag.length < 2 || trimmedTag.length > 5) {
    return res.status(400).json({ error: 'Tag entre 2 et 5 caractères.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Vérifier si l'utilisateur n'est pas déjà dans une équipe
    const existing = await client.query('SELECT id FROM team_members WHERE user_id = $1', [captainId]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Vous appartenez déjà à une escouade.' });
    }

    const teamResult = await client.query(
      `INSERT INTO teams (name, tag, captain_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, tag, captain_id, created_at`,
      [trimmedName, trimmedTag, captainId]
    );

    const newTeam = teamResult.rows[0];

    await client.query(
      `INSERT INTO team_members (team_id, user_id, member_role)
       VALUES ($1, $2, 'captain')`,
      [newTeam.id, captainId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Escouade créée avec succès.',
      team: newTeam,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ce nom ou tag est déjà utilisé.' });
    }
    console.error('Erreur POST /teams :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// 3. AJOUTER UN COÉQUIPIER PAR PSEUDO OU UID CODM (POST /teams/:id/members)
router.post('/:id/members', verifyToken, async (req, res) => {
  const teamId = req.params.id;
  const { username, game_uid } = req.body;
  const requesterId = req.user.id;

  if (!username && !game_uid) {
    return res.status(400).json({ error: 'Veuillez indiquer le pseudo ou l’UID CODM du coéquipier.' });
  }

  try {
    const teamResult = await pool.query('SELECT id, captain_id FROM teams WHERE id = $1', [teamId]);
    if (teamResult.rows.length === 0) return res.status(404).json({ error: 'Escouade introuvable.' });
    if (teamResult.rows[0].captain_id !== requesterId) {
      return res.status(403).json({ error: 'Seul le capitaine peut ajouter des coéquipiers.' });
    }

    // Vérifier limite escouade (max 4 pour CODM Squad)
    const count = await pool.query('SELECT COUNT(*)::int AS total FROM team_members WHERE team_id = $1', [teamId]);
    if (count.rows[0].total >= 4) {
      return res.status(400).json({ error: 'Votre escouade est déjà complète (max 4 joueurs).' });
    }

    // Trouver le joueur
    let userResult;
    if (username) {
      userResult = await pool.query('SELECT id, username, game_uid FROM users WHERE username = $1', [username.trim()]);
    } else {
      userResult = await pool.query('SELECT id, username, game_uid FROM users WHERE game_uid = $1', [game_uid.trim()]);
    }

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Joueur introuvable avec ces identifiants.' });
    }

    const player = userResult.rows[0];

    // Vérifier s'il n'est pas déjà dans l'équipe
    const inTeam = await pool.query('SELECT id FROM team_members WHERE user_id = $1', [player.id]);
    if (inTeam.rows.length > 0) {
      return res.status(409).json({ error: 'Ce joueur fait déjà partie d’une escouade.' });
    }

    const memberResult = await pool.query(
      `INSERT INTO team_members (team_id, user_id, member_role)
       VALUES ($1, $2, 'member')
       RETURNING id, team_id, user_id, member_role, joined_at`,
      [teamId, player.id]
    );

    res.status(201).json({
      message: `${player.username} a rejoint l’escouade.`,
      member: {
        ...memberResult.rows[0],
        username: player.username,
        game_uid: player.game_uid,
      },
    });
  } catch (err) {
    console.error('Erreur POST /teams/:id/members :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// 1. CRÉER UN TOURNOI (POST /tournaments) — Organisateur uniquement
router.post('/', verifyToken, async (req, res) => {
  const {
    name,
    game = 'CODM',
    game_mode = 'br_squad',
    competition_format = 'points',
    maps = ['Isolated'],
    rounds_count = 3,
    prize_pool = 0,
    entry_fee = 0,
    prize_distribution,
    rules_text,
    scoring_rules,
    max_teams = 16,
    max_players = 100,
    description = '',
  } = req.body;

  const createdBy = req.user.id;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Le nom du tournoi est obligatoire.' });
  }

  // Vérifier le statut organisateur du créateur
  const userCheck = await pool.query(
    'SELECT role, organizer_status FROM users WHERE id = $1',
    [createdBy]
  );
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  const user = userCheck.rows[0];
  if (user.role !== 'organizer' && user.organizer_status !== 'verified') {
    return res.status(403).json({
      error: 'Seuls les organisateurs certifiés peuvent créer un tournoi. Activez votre profil organisateur.',
    });
  }

  const defaultPrizeDist = prize_distribution || { '1st': 60, '2nd': 30, '3rd': 10 };
  const defaultScoringRules = scoring_rules || {
    kill: 1,
    placement: { '1': 15, '2': 12, '3': 10, '4': 8, '5': 6, '6': 4, '7': 2, '8': 1 },
  };
  const defaultRulesText = rules_text || 'Règles officielles CODM. Téléphones et tablettes uniquement. Pas d’émulateurs.';

  try {
    const result = await pool.query(
      `INSERT INTO tournaments (
        name, game, game_mode, competition_format, maps, rounds_count,
        prize_pool, entry_fee, prize_distribution, rules_text, scoring_rules,
        max_teams, max_players, description, created_by, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'open')
      RETURNING *`,
      [
        name.trim(),
        game.trim(),
        game_mode,
        competition_format,
        Array.isArray(maps) ? maps : [maps],
        Number(rounds_count) || 3,
        Number(prize_pool) || 0,
        Number(entry_fee) || 0,
        defaultPrizeDist,
        defaultRulesText,
        defaultScoringRules,
        Number(max_teams) || 16,
        Number(max_players) || 100,
        description.trim(),
        createdBy,
      ]
    );

    res.status(201).json({
      message: 'Tournoi CODM créé avec succès.',
      tournament: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur POST /tournaments :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la création du tournoi.' });
  }
});

// 2. LISTER LES TOURNOIS (GET /tournaments) — Publique
router.get('/', async (req, res) => {
  const { mode, status } = req.query;

  try {
    let query = `
      SELECT
        t.id,
        t.name,
        t.game,
        t.game_mode,
        t.competition_format,
        t.maps,
        t.rounds_count,
        t.prize_pool,
        t.entry_fee,
        t.prize_distribution,
        t.rules_text,
        t.scoring_rules,
        t.max_teams,
        t.max_players,
        t.description,
        t.status,
        t.created_at,
        u.username AS organizer_username,
        u.id AS organizer_id,
        COUNT(DISTINCT tt.id)::int AS registered_teams,
        COUNT(DISTINCT tp.id)::int AS registered_players
      FROM tournaments t
      JOIN users u ON t.created_by = u.id
      LEFT JOIN tournament_teams tt ON t.id = tt.tournament_id
      LEFT JOIN tournament_players tp ON t.id = tp.tournament_id
    `;

    const whereClauses = [];
    const params = [];

    if (mode) {
      params.push(mode);
      whereClauses.push(`t.game_mode = $${params.length}`);
    }
    if (status) {
      params.push(status);
      whereClauses.push(`t.status = $${params.length}`);
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ` + whereClauses.join(' AND ');
    }

    query += `
      GROUP BY t.id, u.username, u.id
      ORDER BY t.created_at DESC
    `;

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      tournaments: result.rows,
    });
  } catch (err) {
    console.error('Erreur GET /tournaments :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des tournois.' });
  }
});

// 3. DÉTAILS D'UN TOURNOI (GET /tournaments/:id) — Publique
router.get('/:id', async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const tournamentResult = await pool.query(
      `SELECT 
        t.*,
        u.username AS organizer_username,
        COUNT(DISTINCT tt.id)::int AS registered_teams,
        COUNT(DISTINCT tp.id)::int AS registered_players
       FROM tournaments t
       JOIN users u ON t.created_by = u.id
       LEFT JOIN tournament_teams tt ON t.id = tt.tournament_id
       LEFT JOIN tournament_players tp ON t.id = tp.tournament_id
       WHERE t.id = $1
       GROUP BY t.id, u.username`,
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournoi introuvable.' });
    }

    // Récupérer les équipes inscrites
    const teamsResult = await pool.query(
      `SELECT t.id, t.name, t.tag, u.username AS captain_name, tt.registered_at
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       JOIN users u ON t.captain_id = u.id
       WHERE tt.tournament_id = $1
       ORDER BY tt.registered_at ASC`,
      [tournamentId]
    );

    // Récupérer les joueurs solos inscrits
    const playersResult = await pool.query(
      `SELECT u.id, u.username, u.game_uid, tp.registered_at
       FROM tournament_players tp
       JOIN users u ON tp.user_id = u.id
       WHERE tp.tournament_id = $1
       ORDER BY tp.registered_at ASC`,
      [tournamentId]
    );

    // Récupérer les matchs (pour modes MP)
    const matchesResult = await pool.query(
      `SELECT
         m.id,
         m.status,
         m.score_a,
         m.score_b,
         m.winner_id,
         m.played_at,
         ta.id AS team_a_id,
         ta.name AS team_a_name,
         ta.tag AS team_a_tag,
         tb.id AS team_b_id,
         tb.name AS team_b_name,
         tb.tag AS team_b_tag
       FROM matches m
       JOIN teams ta ON m.team_a_id = ta.id
       JOIN teams tb ON m.team_b_id = tb.id
       WHERE m.tournament_id = $1
       ORDER BY m.created_at ASC`,
      [tournamentId]
    );

    res.json({
      tournament: tournamentResult.rows[0],
      teams: teamsResult.rows,
      players: playersResult.rows,
      matches: matchesResult.rows,
    });
  } catch (err) {
    console.error('Erreur GET /tournaments/:id :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 4. INSCRIRE UN JOUEUR SOLO (POST /tournaments/:id/register-solo)
router.post('/:id/register-solo', verifyToken, async (req, res) => {
  const tournamentId = req.params.id;
  const userId = req.user.id;

  try {
    const tourney = await pool.query('SELECT id, status, max_players FROM tournaments WHERE id = $1', [tournamentId]);
    if (tourney.rows.length === 0) return res.status(404).json({ error: 'Tournoi introuvable.' });
    if (tourney.rows[0].status !== 'open') return res.status(400).json({ error: 'Les inscriptions sont fermées.' });

    const count = await pool.query('SELECT COUNT(*)::int AS total FROM tournament_players WHERE tournament_id = $1', [tournamentId]);
    if (count.rows[0].total >= tourney.rows[0].max_players) {
      return res.status(400).json({ error: 'Le tournoi est complet.' });
    }

    const registration = await pool.query(
      `INSERT INTO tournament_players (tournament_id, user_id)
       VALUES ($1, $2)
       RETURNING id, tournament_id, user_id, registered_at`,
      [tournamentId, userId]
    );

    res.status(201).json({
      message: 'Inscription solo confirmée avec succès.',
      registration: registration.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Vous êtes déjà inscrit à ce tournoi.' });
    }
    console.error('Erreur register-solo :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// 5. INSCRIRE UNE ÉQUIPE (POST /tournaments/:id/register) — Capitaine
router.post('/:id/register', verifyToken, async (req, res) => {
  const tournamentId = req.params.id;
  const { team_id } = req.body;
  const requesterId = req.user.id;

  if (!team_id) {
    return res.status(400).json({ error: 'Le champ team_id est obligatoire.' });
  }

  try {
    const tournamentResult = await pool.query(
      'SELECT id, max_teams, status FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournoi introuvable.' });
    }

    const tournament = tournamentResult.rows[0];
    if (tournament.status !== 'open') {
      return res.status(400).json({ error: 'Les inscriptions pour ce tournoi sont fermées.' });
    }

    const teamResult = await pool.query(
      'SELECT id, name, captain_id FROM teams WHERE id = $1',
      [team_id]
    );
    if (teamResult.rows.length === 0) {
      return res.status(404).json({ error: 'Équipe introuvable.' });
    }
    if (teamResult.rows[0].captain_id !== requesterId) {
      return res.status(403).json({
        error: 'Action refusée : seul le capitaine peut inscrire son équipe.',
      });
    }

    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM tournament_teams WHERE tournament_id = $1',
      [tournamentId]
    );
    if (countResult.rows[0].total >= tournament.max_teams) {
      return res.status(400).json({ error: 'Le tournoi est complet.' });
    }

    const registration = await pool.query(
      `INSERT INTO tournament_teams (tournament_id, team_id)
       VALUES ($1, $2)
       RETURNING id, tournament_id, team_id, registered_at`,
      [tournamentId, team_id]
    );

    res.status(201).json({
      message: `L'équipe ${teamResult.rows[0].name} est inscrite au tournoi.`,
      registration: registration.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette équipe est déjà inscrite à ce tournoi.' });
    }
    console.error('Erreur POST /tournaments/:id/register :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;

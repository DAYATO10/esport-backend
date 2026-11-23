const express = require('express');
const router = express.Router();
const pool = require('../db');
const verifyToken = require('../authMiddleware');

// 1. CRÉER UN TOURNOI (POST /tournaments) — Connecté uniquement
router.post('/', verifyToken, async (req, res) => {
  const { name, game, max_teams } = req.body;
  const createdBy = req.user.id;

  if (!name || !game) {
    return res.status(400).json({
      error: 'Les champs name et game sont obligatoires.',
    });
  }

  const maxTeamsValue = max_teams ? Number(max_teams) : 8;
  if (!Number.isInteger(maxTeamsValue) || maxTeamsValue < 2) {
    return res.status(400).json({
      error: 'max_teams doit être un entier supérieur ou égal à 2.',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tournaments (name, game, max_teams, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, game, max_teams, status, created_by, created_at`,
      [name.trim(), game.trim(), maxTeamsValue, createdBy]
    );

    res.status(201).json({
      message: 'Tournoi créé avec succès.',
      tournament: result.rows[0],
    });
  } catch (err) {
    console.error('Erreur POST /tournaments :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la création du tournoi.' });
  }
});

// 2. LISTER LES TOURNOIS (GET /tournaments) — Publique
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id,
        t.name,
        t.game,
        t.max_teams,
        t.status,
        u.username AS organizer_username,
        COUNT(tt.id)::int AS registered_teams,
        t.created_at
      FROM tournaments t
      JOIN users u ON t.created_by = u.id
      LEFT JOIN tournament_teams tt ON t.id = tt.tournament_id
      GROUP BY t.id, u.username
      ORDER BY t.created_at DESC
    `);

    res.json({
      count: result.rows.length,
      tournaments: result.rows,
    });
  } catch (err) {
    console.error('Erreur GET /tournaments :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des tournois.' });
  }
});

// 3. INSCRIRE UNE ÉQUIPE À UN TOURNOI (POST /tournaments/:id/register) — Capitaine uniquement
router.post('/:id/register', verifyToken, async (req, res) => {
  const tournamentId = req.params.id;
  const { team_id } = req.body;
  const requesterId = req.user.id;

  if (!team_id) {
    return res.status(400).json({ error: 'Le champ team_id est obligatoire.' });
  }

  try {
    // Vérifier le tournoi et son statut
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

    // Vérifier que l'équipe existe et que l'appelant est bien le capitaine
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

    // Vérifier qu'il reste de la place dans le tournoi
    const countResult = await pool.query(
      'SELECT COUNT(*)::int AS total FROM tournament_teams WHERE tournament_id = $1',
      [tournamentId]
    );
    if (countResult.rows[0].total >= tournament.max_teams) {
      return res.status(400).json({ error: 'Le tournoi est complet.' });
    }

    // Inscrire l'équipe
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
    console.error('Erreur POST /tournaments/:id/register :', err.message);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cette équipe est déjà inscrite à ce tournoi.' });
    }
    res.status(500).json({ error: 'Erreur serveur lors de l’inscription au tournoi.' });
  }
});

// 4. CRÉER UN MATCH (POST /tournaments/:id/matches) — Organisateur du tournoi uniquement
router.post('/:id/matches', verifyToken, async (req, res) => {
  const tournamentId = req.params.id;
  const { team_a_id, team_b_id } = req.body;
  const requesterId = req.user.id;

  if (!team_a_id || !team_b_id) {
    return res.status(400).json({ error: 'team_a_id et team_b_id sont obligatoires.' });
  }
  if (team_a_id === team_b_id) {
    return res.status(400).json({ error: 'Une équipe ne peut pas jouer contre elle-même.' });
  }

  try {
    const tournamentResult = await pool.query(
      'SELECT id, created_by FROM tournaments WHERE id = $1',
      [tournamentId]
    );
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournoi introuvable.' });
    }
    if (tournamentResult.rows[0].created_by !== requesterId) {
      return res.status(403).json({
        error: 'Action refusée : seul l’organisateur du tournoi peut créer des matchs.',
      });
    }

    // Vérifier que les deux équipes sont inscrites au tournoi
    const registered = await pool.query(
      'SELECT team_id FROM tournament_teams WHERE tournament_id = $1 AND team_id IN ($2, $3)',
      [tournamentId, team_a_id, team_b_id]
    );
    if (registered.rows.length < 2) {
      return res.status(400).json({
        error: 'Les deux équipes doivent être inscrites au tournoi avant de créer un match.',
      });
    }

    const matchResult = await pool.query(
      `INSERT INTO matches (tournament_id, team_a_id, team_b_id)
       VALUES ($1, $2, $3)
       RETURNING id, tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, created_at`,
      [tournamentId, team_a_id, team_b_id]
    );

    res.status(201).json({
      message: 'Match créé avec succès.',
      match: matchResult.rows[0],
    });
  } catch (err) {
    console.error('Erreur POST /tournaments/:id/matches :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la création du match.' });
  }
});

// 5. ENREGISTRER UN SCORE (PATCH /tournaments/matches/:matchId/score) — Organisateur uniquement
router.patch('/matches/:matchId/score', verifyToken, async (req, res) => {
  const { matchId } = req.params;
  const { score_a, score_b } = req.body;
  const requesterId = req.user.id;

  if (score_a === undefined || score_b === undefined || score_a < 0 || score_b < 0) {
    return res.status(400).json({
      error: 'score_a et score_b doivent être des nombres positifs ou nuls.',
    });
  }

  try {
    // Récupérer le match et le créateur du tournoi associé
    const matchCheck = await pool.query(
      `SELECT m.id, m.team_a_id, m.team_b_id, t.created_by
       FROM matches m
       JOIN tournaments t ON m.tournament_id = t.id
       WHERE m.id = $1`,
      [matchId]
    );
    if (matchCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Match introuvable.' });
    }

    const match = matchCheck.rows[0];
    if (match.created_by !== requesterId) {
      return res.status(403).json({
        error: 'Action refusée : seul l’organisateur du tournoi peut enregistrer le score.',
      });
    }

    // Calcul automatique du vainqueur côté serveur
    let winnerId = null;
    if (score_a > score_b) winnerId = match.team_a_id;
    else if (score_b > score_a) winnerId = match.team_b_id;

    const updated = await pool.query(
      `UPDATE matches
       SET score_a = $1, score_b = $2, winner_id = $3, status = 'finished', played_at = NOW()
       WHERE id = $4
       RETURNING id, tournament_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, played_at`,
      [score_a, score_b, winnerId, matchId]
    );

    res.json({
      message: 'Score enregistré avec succès.',
      match: updated.rows[0],
    });
  } catch (err) {
    console.error('Erreur PATCH /tournaments/matches/:matchId/score :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de l’enregistrement du score.' });
  }
});
// 6. DÉTAILS D'UN TOURNOI + LISTE DES MATCHS (GET /tournaments/:id) — Publique
router.get('/:id', async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const tournamentResult = await pool.query(
      `SELECT t.id, t.name, t.game, t.max_teams, t.status, u.username AS organizer_username, t.created_at
       FROM tournaments t
       JOIN users u ON t.created_by = u.id
       WHERE t.id = $1`,
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournoi introuvable.' });
    }

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
      matches: matchesResult.rows,
    });
  } catch (err) {
    console.error('Erreur GET /tournaments/:id :', err.message);
    if (err.code === '22P02') {
      return res.status(400).json({ error: 'Format d’identifiant de tournoi invalide.' });
    }
    res.status(500).json({ error: 'Erreur serveur lors de la récupération du tournoi.' });
  }
});

// 7. CLASSEMENT D'UN TOURNOI (GET /tournaments/:id/standings) — Publique
// Barème EA FC : Victoire = 3 pts, Nul = 1 pt, Défaite = 0 pt
router.get('/:id/standings', async (req, res) => {
  const tournamentId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT
         t.id AS team_id,
         t.name AS team_name,
         t.tag AS team_tag,
         COUNT(m.id)::int AS played,
         COALESCE(SUM(CASE WHEN m.winner_id = t.id THEN 1 ELSE 0 END), 0)::int AS wins,
         COALESCE(SUM(CASE WHEN m.id IS NOT NULL AND m.winner_id IS NULL THEN 1 ELSE 0 END), 0)::int AS draws,
         COALESCE(SUM(CASE WHEN m.winner_id IS NOT NULL AND m.winner_id <> t.id THEN 1 ELSE 0 END), 0)::int AS losses,
         COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_a ELSE m.score_b END), 0)::int AS goals_for,
         COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_b ELSE m.score_a END), 0)::int AS goals_against,
         (COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_a ELSE m.score_b END), 0)
          - COALESCE(SUM(CASE WHEN m.team_a_id = t.id THEN m.score_b ELSE m.score_a END), 0))::int AS goal_diff,
         COALESCE(SUM(
           CASE
             WHEN m.winner_id = t.id THEN 3
             WHEN m.id IS NOT NULL AND m.winner_id IS NULL THEN 1
             ELSE 0
           END
         ), 0)::int AS points
       FROM tournament_teams tt
       JOIN teams t ON tt.team_id = t.id
       LEFT JOIN matches m
         ON m.tournament_id = tt.tournament_id
         AND m.status = 'finished'
         AND (m.team_a_id = t.id OR m.team_b_id = t.id)
       WHERE tt.tournament_id = $1
       GROUP BY t.id, t.name, t.tag
       ORDER BY points DESC, goal_diff DESC, goals_for DESC`,
      [tournamentId]
    );

    res.json({
      tournament_id: tournamentId,
      standings: result.rows,
    });
  } catch (err) {
    console.error('Erreur GET /tournaments/:id/standings :', err.message);
    if (err.code === '22P02') {
      return res.status(400).json({ error: 'Format d’identifiant de tournoi invalide.' });
    }
    res.status(500).json({ error: 'Erreur serveur lors du calcul du classement.' });
  }
});

module.exports = router;
const pool = require('../db');

async function migrate() {
  console.log('--- Début de la migration Supabase CODM V1 ---');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Colonnes supplémentaires pour tournaments
    console.log('1. Mise à jour de la table tournaments...');
    await client.query(`
      ALTER TABLE tournaments 
      ADD COLUMN IF NOT EXISTS game_mode VARCHAR(30) DEFAULT 'br_squad',
      ADD COLUMN IF NOT EXISTS competition_format VARCHAR(20) DEFAULT 'points',
      ADD COLUMN IF NOT EXISTS maps TEXT[] DEFAULT ARRAY['Isolated'],
      ADD COLUMN IF NOT EXISTS rounds_count INTEGER DEFAULT 3,
      ADD COLUMN IF NOT EXISTS prize_pool INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS entry_fee INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS prize_distribution JSONB DEFAULT '{"1st": 60, "2nd": 30, "3rd": 10}',
      ADD COLUMN IF NOT EXISTS rules_text TEXT DEFAULT 'Règles officielles CODM. Pas d’émulateur, uniquement mobile. Armes mythiques autorisées selon accord des capitaines.',
      ADD COLUMN IF NOT EXISTS scoring_rules JSONB DEFAULT '{"kill": 1, "placement": {"1": 15, "2": 12, "3": 10, "4": 8, "5": 6, "6": 4, "7": 2, "8": 1}}',
      ADD COLUMN IF NOT EXISTS max_players INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) DEFAULT 'public',
      ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20),
      ADD COLUMN IF NOT EXISTS description TEXT;
    `);

    // 2. Colonnes pour users (gestion organisateur vérifié - Option B)
    console.log('2. Mise à jour de la table users...');
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS organizer_status VARCHAR(20) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS organizer_bio TEXT,
      ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false;
    `);

    // 3. Table tournament_players pour les inscriptions individuelles (Solo BR)
    console.log('3. Création de la table tournament_players...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_players (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        registered_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tournament_id, user_id)
      );
    `);

    // 4. Table br_results pour le calcul et l'enregistrement des points BR par game
    console.log('4. Création de la table br_results...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS br_results (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
        game_number INTEGER NOT NULL,
        player_id UUID REFERENCES users(id) ON DELETE SET NULL,
        team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
        placement INTEGER NOT NULL,
        kills INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
        recorded_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('✅ Migration CODM V1 réussie avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de la migration :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

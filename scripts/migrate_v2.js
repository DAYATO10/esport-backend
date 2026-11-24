const pool = require('../db');

async function migrateStep2() {
  console.log('--- Début de la migration Phase 2 : Salon CODM, Check-in & Notifications ---');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Colonnes Salon Privé CODM et statut Check-in dans tournaments
    console.log('1. Ajout des colonnes de salon CODM dans tournaments...');
    await client.query(`
      ALTER TABLE tournaments 
      ADD COLUMN IF NOT EXISTS room_id VARCHAR(50),
      ADD COLUMN IF NOT EXISTS room_password VARCHAR(50),
      ADD COLUMN IF NOT EXISTS checkin_open BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS room_revealed BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS current_game_round INTEGER DEFAULT 1;
    `);

    // 2. Colonne check-in dans les inscriptions (teams et solo)
    console.log('2. Ajout du check-in dans tournament_teams et tournament_players...');
    await client.query(`
      ALTER TABLE tournament_teams
      ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;

      ALTER TABLE tournament_players
      ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
    `);

    // 3. Table des notifications in-app
    console.log('3. Création de la table notifications...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(120) NOT NULL,
        message TEXT NOT NULL,
        type VARCHAR(30) DEFAULT 'tournament_alert',
        link_id UUID,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Mettre une date de début réaliste (dans 2h) sur le tournoi BR existant pour tester le compte à rebours
    await client.query(`
      UPDATE tournaments 
      SET 
        start_date = NOW() + INTERVAL '2 hours',
        checkin_open = true,
        room_id = '9834 1120',
        room_password = 'CODM-RIVALIS',
        room_revealed = true
      WHERE game_mode = 'br_squad';
    `);

    await client.query('COMMIT');
    console.log('✅ Migration Phase 2 réussie !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur lors de la migration Phase 2 :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateStep2();

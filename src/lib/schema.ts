export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  phone text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date NOT NULL,
  role text NOT NULL DEFAULT 'player',
  kyc_status text NOT NULL DEFAULT 'pending',
  self_excluded_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id text PRIMARY KEY REFERENCES users(id),
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0)
);
CREATE TABLE IF NOT EXISTS ledger (
  id serial PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  type text NOT NULL,
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger(user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_type_ref_uq ON ledger(type, ref) WHERE ref IS NOT NULL;
CREATE TABLE IF NOT EXISTS fixtures (
  id text PRIMARY KEY,
  sport text NOT NULL,
  league text NOT NULL,
  home text NOT NULL,
  away text NOT NULL,
  kickoff timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  home_score integer,
  away_score integer,
  settled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixtures_status_idx ON fixtures(status, kickoff);
CREATE TABLE IF NOT EXISTS odds (
  fixture_id text NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
  selection text NOT NULL,
  source_milli integer NOT NULL,
  price_milli integer NOT NULL,
  suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fixture_id, selection)
);
CREATE TABLE IF NOT EXISTS bets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  stake_cents integer NOT NULL,
  total_odds_milli integer NOT NULL,
  potential_return_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  return_cents integer,
  placed_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bets_user_idx ON bets(user_id, placed_at DESC);
CREATE TABLE IF NOT EXISTS bet_legs (
  id serial PRIMARY KEY,
  bet_id text NOT NULL REFERENCES bets(id),
  fixture_id text NOT NULL REFERENCES fixtures(id),
  selection text NOT NULL,
  price_milli integer NOT NULL,
  status text NOT NULL DEFAULT 'open'
);
CREATE INDEX IF NOT EXISTS bet_legs_fixture_idx ON bet_legs(fixture_id, status);
CREATE INDEX IF NOT EXISTS bet_legs_bet_idx ON bet_legs(bet_id);
`;

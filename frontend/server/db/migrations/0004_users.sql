-- Dashboard accounts. Passwords are stored only as salted scrypt hashes.
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  username varchar(80) NOT NULL,
  password_hash varchar(255) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_username UNIQUE (username)
);

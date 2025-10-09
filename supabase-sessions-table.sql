-- Create sessions table for express-session storage in Supabase
-- Run this SQL in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster expiration queries
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Index for faster cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function before update
DROP TRIGGER IF EXISTS trigger_update_sessions_updated_at ON sessions;
CREATE TRIGGER trigger_update_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_sessions_updated_at();

-- Optional: Function to manually cleanup expired sessions
-- You can call this periodically or let the app handle it
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM sessions
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a cron job to cleanup expired sessions daily
-- Uncomment if you have pg_cron extension enabled
-- SELECT cron.schedule(
--   'cleanup-expired-sessions',
--   '0 2 * * *', -- Run at 2 AM daily
--   'SELECT cleanup_expired_sessions();'
-- );

COMMENT ON TABLE sessions IS 'Express session storage for production use';
COMMENT ON COLUMN sessions.sid IS 'Session ID (primary key)';
COMMENT ON COLUMN sessions.data IS 'Session data stored as JSONB';
COMMENT ON COLUMN sessions.expires_at IS 'Session expiration timestamp';
COMMENT ON COLUMN sessions.created_at IS 'Session creation timestamp';
COMMENT ON COLUMN sessions.updated_at IS 'Last session update timestamp';


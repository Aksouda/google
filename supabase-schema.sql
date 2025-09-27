-- Supabase Database Schema for Google Reviews App
-- This file contains the SQL commands to set up the database tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create app_users table for user accounts and subscriptions
CREATE TABLE IF NOT EXISTS app_users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Subscription fields
    subscription_status VARCHAR(20) DEFAULT 'active' CHECK (subscription_status IN ('active', 'cancelling', 'cancelled')),
    subscription_expires_at TIMESTAMP WITH TIME ZONE,
    subscription_created_at TIMESTAMP WITH TIME ZONE,
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    
    -- Google Business connection status
    google_business_connected BOOLEAN DEFAULT FALSE,
    google_business_email VARCHAR(255),
    
    -- User preferences
    email_notifications BOOLEAN DEFAULT TRUE,
    timezone VARCHAR(50) DEFAULT 'UTC'
);

-- Create subscription_history table to track subscription changes
CREATE TABLE IF NOT EXISTS subscription_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    changed_by VARCHAR(50) DEFAULT 'system', -- 'user', 'admin', 'system', 'stripe'
    notes TEXT
);

-- Create user_sessions table for tracking active sessions (optional)
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

-- Create usage_tracking table for monitoring feature usage
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    feature VARCHAR(100) NOT NULL,
    usage_count INTEGER DEFAULT 1,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(user_id, feature)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
CREATE INDEX IF NOT EXISTS idx_app_users_subscription_status ON app_users(subscription_status);
CREATE INDEX IF NOT EXISTS idx_app_users_subscription_expires_at ON app_users(subscription_expires_at);
CREATE INDEX IF NOT EXISTS idx_subscription_history_user_id ON subscription_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_id ON usage_tracking(user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_app_users_updated_at 
    BEFORE UPDATE ON app_users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to log subscription changes
CREATE OR REPLACE FUNCTION log_subscription_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.subscription_status IS DISTINCT FROM NEW.subscription_status THEN
        INSERT INTO subscription_history (user_id, old_status, new_status, notes)
        VALUES (NEW.id, OLD.subscription_status, NEW.subscription_status, 'Automatic log from trigger');
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to log subscription changes
CREATE TRIGGER log_subscription_changes
    AFTER UPDATE ON app_users
    FOR EACH ROW
    EXECUTE FUNCTION log_subscription_change();

-- Create function to clean up expired sessions
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ language 'plpgsql';

-- Row Level Security (RLS) policies
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is service role
CREATE OR REPLACE FUNCTION is_service_role() RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_setting('role', true) = 'service_role';
EXCEPTION
    WHEN OTHERS THEN
        RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- APP_USERS TABLE POLICIES
-- Allow service role full access to all operations
CREATE POLICY "Service role full access" ON app_users
    FOR ALL USING (is_service_role());

-- Allow users to view their own profile (when using Supabase auth)
CREATE POLICY "Users can view own profile" ON app_users
    FOR SELECT USING (auth.uid()::text = id::text);

-- Allow users to update their own profile (when using Supabase auth)
CREATE POLICY "Users can update own profile" ON app_users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- SUBSCRIPTION_HISTORY TABLE POLICIES
-- Allow service role full access
CREATE POLICY "Service role full access history" ON subscription_history
    FOR ALL USING (is_service_role());

-- Allow users to view their own subscription history
CREATE POLICY "Users can view own subscription history" ON subscription_history
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM app_users WHERE id = subscription_history.user_id AND auth.uid()::text = id::text
    ));

-- USER_SESSIONS TABLE POLICIES
-- Allow service role full access
CREATE POLICY "Service role full access sessions" ON user_sessions
    FOR ALL USING (is_service_role());

-- Allow users to view their own sessions
CREATE POLICY "Users can view own sessions" ON user_sessions
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM app_users WHERE id = user_sessions.user_id AND auth.uid()::text = id::text
    ));

-- Allow users to delete their own sessions
CREATE POLICY "Users can delete own sessions" ON user_sessions
    FOR DELETE USING (EXISTS (
        SELECT 1 FROM app_users WHERE id = user_sessions.user_id AND auth.uid()::text = id::text
    ));

-- USAGE_TRACKING TABLE POLICIES
-- Allow service role full access
CREATE POLICY "Service role full access usage" ON usage_tracking
    FOR ALL USING (is_service_role());

-- Allow users to view their own usage tracking
CREATE POLICY "Users can view own usage tracking" ON usage_tracking
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM app_users WHERE id = usage_tracking.user_id AND auth.uid()::text = id::text
    ));

-- Insert some sample subscription plans (for reference)
COMMENT ON COLUMN app_users.subscription_status IS 'Subscription plan: free (limited features), premium (full features), enterprise (advanced features + priority support)';

-- Sample data for testing (optional - remove in production)
-- INSERT INTO app_users (email, password_hash, subscription_status) VALUES
-- ('test@example.com', '$2b$12$example_hash', 'free'),
-- ('premium@example.com', '$2b$12$example_hash', 'premium');

-- Grant necessary permissions to authenticated users
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE ON app_users TO authenticated;
GRANT SELECT ON subscription_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON usage_tracking TO authenticated;

-- Grant necessary permissions to service role (for backend operations)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Grant permissions to anon role (for public access)
GRANT USAGE ON SCHEMA public TO anon;

-- Ensure service role can execute functions
GRANT EXECUTE ON FUNCTION is_service_role() TO service_role;
GRANT EXECUTE ON FUNCTION update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION log_subscription_change() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO service_role;
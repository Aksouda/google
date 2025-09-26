-- Additional fields needed for subscription-first flow
-- Run these ALTER statements on your Supabase database

-- Add fields to track signup completion and subscription plan
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS signup_completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(20); -- 'monthly' or 'yearly'

-- Make password_hash nullable for subscription-first flow
ALTER TABLE app_users ALTER COLUMN password_hash DROP NOT NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_app_users_stripe_customer_id ON app_users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_app_users_stripe_subscription_id ON app_users(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_app_users_email_verified ON app_users(email_verified);

-- Add subscription validation function
CREATE OR REPLACE FUNCTION is_subscription_active(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM app_users 
    WHERE id = user_id 
    AND subscription_status IN ('premium', 'enterprise')
    AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())
    AND email_verified = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_subscription_active(UUID) TO service_role;
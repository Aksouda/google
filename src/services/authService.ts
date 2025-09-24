import * as bcrypt from 'bcryptjs';
import { sign, verify, SignOptions } from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase';

export interface AppUser {
  id: string;
  email: string;
  created_at: string;
  subscription_status: 'free' | 'premium' | 'enterprise';
  subscription_expires_at?: string;
  google_business_connected: boolean;
}

export interface SignupData {
  email: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: AppUser;
  token?: string;
  message?: string;
  error?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify password against hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate JWT token for user
 */
export function generateToken(userId: string): string {
  const options: SignOptions = { expiresIn: '7d' };
  return sign({ userId }, JWT_SECRET, options);
}

/**
 * Verify JWT token and return user ID
 */
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Sign up a new user
 */
export async function signupUser(data: SignupData): Promise<AuthResponse> {
  try {
    const { email, password } = data;

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return {
        success: false,
        error: 'USER_EXISTS',
        message: 'An account with this email already exists'
      };
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user in Supabase
    const { data: newUser, error } = await supabaseAdmin
      .from('app_users')
      .insert({
        email,
        password_hash: hashedPassword,
        subscription_status: 'free',
        google_business_connected: false
      })
      .select()
      .single();

    if (error) {
      console.error('Signup error:', error);
      return {
        success: false,
        error: 'SIGNUP_FAILED',
        message: 'Failed to create account'
      };
    }

    // Generate token
    const token = generateToken(newUser.id);

    return {
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        created_at: newUser.created_at,
        subscription_status: newUser.subscription_status,
        subscription_expires_at: newUser.subscription_expires_at,
        google_business_connected: newUser.google_business_connected
      },
      token
    };
  } catch (error) {
    console.error('Signup error:', error);
    return {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    };
  }
}

/**
 * Login user
 */
export async function loginUser(data: LoginData): Promise<AuthResponse> {
  try {
    const { email, password } = data;

    // Get user from database
    const { data: user, error } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return {
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      };
    }

    // Verify password
    const isValidPassword = await verifyPassword(password, user.password_hash);
    if (!isValidPassword) {
      return {
        success: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      };
    }

    // Generate token
    const token = generateToken(user.id);

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        subscription_status: user.subscription_status,
        subscription_expires_at: user.subscription_expires_at,
        google_business_connected: user.google_business_connected
      },
      token
    };
  } catch (error) {
    console.error('Login error:', error);
    return {
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    };
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<AppUser | null> {
  try {
    const { data: user, error } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      subscription_status: user.subscription_status,
      subscription_expires_at: user.subscription_expires_at,
      google_business_connected: user.google_business_connected
    };
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}

/**
 * Update user's Google Business connection status
 */
export async function updateGoogleBusinessConnection(userId: string, connected: boolean): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('app_users')
      .update({ google_business_connected: connected })
      .eq('id', userId);

    return !error;
  } catch (error) {
    console.error('Update Google Business connection error:', error);
    return false;
  }
}

/**
 * Update user's subscription status
 */
export async function updateSubscriptionStatus(
  userId: string, 
  status: 'free' | 'premium' | 'enterprise',
  expiresAt?: string
): Promise<boolean> {
  try {
    const updateData: any = { subscription_status: status };
    if (expiresAt) {
      updateData.subscription_expires_at = expiresAt;
    }

    const { error } = await supabaseAdmin
      .from('app_users')
      .update(updateData)
      .eq('id', userId);

    return !error;
  } catch (error) {
    console.error('Update subscription status error:', error);
    return false;
  }
}

/**
 * Check if user has active subscription
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const user = await getUserById(userId);
    if (!user) return false;

    if (user.subscription_status === 'free') return false;

    // Check if subscription has expired
    if (user.subscription_expires_at) {
      const expiresAt = new Date(user.subscription_expires_at);
      const now = new Date();
      return expiresAt > now;
    }

    // If no expiration date, assume active
    return true;
  } catch (error) {
    console.error('Check subscription error:', error);
    return false;
  }
}
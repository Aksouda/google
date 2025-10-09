import session from 'express-session';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client for session storage
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Custom Supabase session store for express-session
 * Stores sessions in Supabase database instead of memory
 */
export class SupabaseSessionStore extends session.Store {
  /**
   * Get session data by session ID
   */
  async get(sid: string, callback: (err: any, session?: any) => void) {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('data, expires_at')
        .eq('sid', sid)
        .single();
      
      if (error) {
        // Session not found or error - return null (not an error)
        return callback(null, null);
      }

      // Check if session has expired
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        // Session expired - delete it and return null
        await this.destroy(sid);
        return callback(null, null);
      }
      
      callback(null, data?.data);
    } catch (err) {
      console.error('Session get error:', err);
      callback(err);
    }
  }

  /**
   * Set/update session data
   */
  async set(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const expiresAt = session.cookie?.expires 
        ? new Date(session.cookie.expires)
        : new Date(Date.now() + (session.cookie?.maxAge || 86400000)); // Default 24 hours

      const { error } = await supabase
        .from('sessions')
        .upsert({
          sid,
          data: session,
          expires_at: expiresAt.toISOString()
        }, {
          onConflict: 'sid'
        });
      
      if (error) {
        console.error('Session set error:', error);
        return callback?.(error);
      }

      callback?.();
    } catch (err) {
      console.error('Session set error:', err);
      callback?.(err);
    }
  }

  /**
   * Destroy/delete session
   */
  async destroy(sid: string, callback?: (err?: any) => void) {
    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('sid', sid);
      
      if (error) {
        console.error('Session destroy error:', error);
        return callback?.(error);
      }

      callback?.();
    } catch (err) {
      console.error('Session destroy error:', err);
      callback?.(err);
    }
  }

  /**
   * Touch session to update expiration time
   */
  async touch(sid: string, session: any, callback?: (err?: any) => void) {
    try {
      const expiresAt = session.cookie?.expires 
        ? new Date(session.cookie.expires)
        : new Date(Date.now() + (session.cookie?.maxAge || 86400000));

      const { error } = await supabase
        .from('sessions')
        .update({
          expires_at: expiresAt.toISOString()
        })
        .eq('sid', sid);
      
      if (error) {
        console.error('Session touch error:', error);
        return callback?.(error);
      }

      callback?.();
    } catch (err) {
      console.error('Session touch error:', err);
      callback?.(err);
    }
  }

  /**
   * Get all sessions (optional - for admin purposes)
   */
  async all(callback: (err: any, sessions?: any[]) => void) {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .gt('expires_at', new Date().toISOString());
      
      if (error) {
        return callback(error);
      }

      callback(null, data || []);
    } catch (err) {
      console.error('Session all error:', err);
      callback(err);
    }
  }

  /**
   * Get session count (optional - for monitoring)
   */
  async length(callback: (err: any, length?: number) => void) {
    try {
      const { count, error } = await supabase
        .from('sessions')
        .select('*', { count: 'exact', head: true })
        .gt('expires_at', new Date().toISOString());
      
      if (error) {
        return callback(error);
      }

      callback(null, count || 0);
    } catch (err) {
      console.error('Session length error:', err);
      callback(err);
    }
  }

  /**
   * Clear all sessions (optional - for maintenance)
   */
  async clear(callback?: (err?: any) => void) {
    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .neq('sid', ''); // Delete all
      
      if (error) {
        console.error('Session clear error:', error);
        return callback?.(error);
      }

      callback?.();
    } catch (err) {
      console.error('Session clear error:', err);
      callback?.(err);
    }
  }
}

/**
 * Cleanup expired sessions periodically
 * Run this every hour to keep the sessions table clean
 */
export async function cleanupExpiredSessions() {
  try {
    const { error } = await supabase
      .from('sessions')
      .delete()
      .lt('expires_at', new Date().toISOString());
    
    if (error) {
      console.error('Session cleanup error:', error);
    } else {
      console.log('✅ Expired sessions cleaned up');
    }
  } catch (err) {
    console.error('Session cleanup error:', err);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);


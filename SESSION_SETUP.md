# Supabase Session Store Setup

This guide explains how to set up production-ready session storage using Supabase instead of the default MemoryStore.

## Why This Change?

The default `MemoryStore` has these issues:
- ❌ Sessions stored in memory are lost on server restart
- ❌ Memory leaks in production
- ❌ Doesn't scale across multiple server instances
- ❌ Not suitable for production use

Our Supabase session store:
- ✅ Persistent sessions across server restarts
- ✅ No memory leaks
- ✅ Scales horizontally
- ✅ Production-ready
- ✅ Automatic cleanup of expired sessions

## Setup Steps

### 1. Create Sessions Table in Supabase

1. Go to your Supabase project: https://supabase.com/dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy and paste the contents of `supabase-sessions-table.sql`
5. Click **Run** to execute the SQL

This creates:
- `sessions` table with proper indexes
- Automatic `updated_at` trigger
- Optional cleanup function

### 2. Verify Table Creation

In Supabase:
1. Go to **Table Editor**
2. You should see a new `sessions` table
3. Verify it has columns: `sid`, `data`, `expires_at`, `created_at`, `updated_at`

### 3. Deploy Your App

The code changes are already in place:
- `src/config/sessionStore.ts` - Custom Supabase session store
- `src/server.ts` - Updated to use Supabase store

Just commit and push:

```bash
git add .
git commit -m "Add Supabase session store for production"
git push origin main
```

Coolify will automatically deploy with the new session store.

### 4. Add Environment Variable (Optional)

If you want a dedicated session secret, add to Coolify:

```
SESSION_SECRET=your-random-secret-here
```

Generate a secure secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## How It Works

### Session Lifecycle

1. **User logs in** → Session created in Supabase `sessions` table
2. **User makes requests** → Session retrieved from Supabase
3. **Session expires** → Automatically cleaned up every hour
4. **User logs out** → Session deleted from Supabase

### Automatic Cleanup

The session store includes automatic cleanup:
- Runs every hour
- Deletes expired sessions
- Keeps database clean
- No manual intervention needed

### Session Duration

- Default: **24 hours**
- Configurable in `src/server.ts`:
  ```typescript
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000 // Change this value
  }
  ```

## Monitoring

### Check Active Sessions

Run this SQL in Supabase:

```sql
-- Count active sessions
SELECT COUNT(*) as active_sessions
FROM sessions
WHERE expires_at > NOW();

-- View recent sessions
SELECT sid, expires_at, created_at
FROM sessions
WHERE expires_at > NOW()
ORDER BY created_at DESC
LIMIT 10;
```

### Manual Cleanup (if needed)

```sql
-- Delete expired sessions manually
SELECT cleanup_expired_sessions();
```

## Troubleshooting

### Sessions Not Persisting

Check:
1. Supabase credentials in environment variables
2. `sessions` table exists in Supabase
3. No errors in server logs

### High Session Count

If you have too many sessions:
1. Reduce `maxAge` in cookie settings
2. Run manual cleanup: `SELECT cleanup_expired_sessions();`
3. Check for session leaks in your code

### Performance Issues

If session operations are slow:
1. Verify indexes exist: `idx_sessions_expires_at`
2. Check Supabase dashboard for slow queries
3. Consider upgrading Supabase plan if needed

## Security Features

✅ **HttpOnly cookies** - Prevents XSS attacks
✅ **Secure flag** - HTTPS only in production
✅ **SameSite protection** - CSRF protection
✅ **Automatic expiration** - Sessions auto-expire
✅ **Encrypted storage** - Supabase handles encryption

## Migration from MemoryStore

No migration needed! The new session store:
- Works immediately on deployment
- Old in-memory sessions are automatically replaced
- Users may need to log in again (one-time)

## Additional Notes

- Sessions are stored as JSONB for flexibility
- Indexes ensure fast queries
- Automatic cleanup prevents database bloat
- Compatible with Passport.js
- Works with multiple server instances

## Support

If you encounter issues:
1. Check server logs in Coolify
2. Verify Supabase table structure
3. Test with a fresh session (clear cookies)
4. Check environment variables are set correctly


# Dual Authentication System Setup

This document explains how to set up the dual authentication system that combines Supabase app authentication with Google OAuth for business profile access.

## Overview

The system now has two separate authentication layers:

1. **App Authentication (Supabase)**: User accounts, subscriptions, and app access
2. **Google OAuth**: Access to Google Business Profile data

Users need both authentications to fully use the application.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

New dependencies added:
- `@supabase/supabase-js`: Supabase client
- `bcryptjs`: Password hashing
- `jsonwebtoken`: JWT token generation
- `@types/bcryptjs` and `@types/jsonwebtoken`: TypeScript types

### 2. Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)

2. Run the SQL schema in your Supabase SQL editor:
   ```bash
   # Copy the contents of supabase-schema.sql and run in Supabase SQL editor
   ```

3. Get your Supabase credentials from the project settings:
   - Project URL
   - Anon key
   - Service role key

### 3. Environment Variables

Add these new environment variables to your `.env` file:

```env
# Existing Google OAuth variables
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret_key

# New Supabase variables
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# JWT Configuration (optional)
JWT_EXPIRES_IN=7d
```

### 4. Database Schema

The system creates these main tables in Supabase:

- `app_users`: User accounts and subscription information
- `subscription_history`: Track subscription changes
- `user_sessions`: Optional session tracking
- `usage_tracking`: Feature usage monitoring

### 5. Start the Application

```bash
npm run dev
```

## Authentication Flow

### New User Registration

1. User visits `/login.html`
2. Creates app account with email/password
3. Receives JWT token for app authentication
4. Connects Google Business account via OAuth
5. Can now access full dashboard functionality

### Existing User Login

1. User logs into app account (gets JWT token)
2. Connects/re-authenticates Google Business account
3. Access granted based on subscription level

## API Endpoints

### App Authentication Routes (`/app-auth/`)

- `POST /app-auth/signup` - Create new user account
- `POST /app-auth/login` - Login to app account
- `POST /app-auth/logout` - Logout from app account
- `GET /app-auth/profile` - Get user profile
- `POST /app-auth/verify` - Verify JWT token
- `POST /app-auth/update-subscription` - Update subscription status
- `GET /app-auth/premium-test` - Test subscription-protected route

### Google OAuth Routes (`/auth/`) - Unchanged

- `GET /auth/google` - Start Google OAuth flow
- `GET /auth/google/callback` - OAuth callback
- `GET /auth/logout` - Logout from Google account
- `GET /auth/profile` - Get Google user profile

## Middleware

### App Authentication Middleware

- `requireAppAuth`: Requires valid JWT token
- `requireSubscription`: Requires specific subscription level
- `optionalAppAuth`: Optional app authentication
- `requireBothAuth`: Requires both app and Google authentication

### Usage Examples

```typescript
// Require app authentication only
app.get('/api/profile', requireAppAuth, handler);

// Require premium subscription
app.get('/api/premium-feature', requireAppAuth, requireSubscription(['premium', 'enterprise']), handler);

// Require both authentications (for Google Business API calls)
app.get('/api/gmb/locations', requireBothAuth, handler);
```

## Frontend Integration

### Authentication Manager

The `auth-utils.js` file provides a global `authManager` object with methods:

- `checkAppAuth()`: Check app authentication status
- `checkGoogleAuth()`: Check Google authentication status
- `checkBothAuth()`: Check both authentication types
- `logoutBoth()`: Logout from both systems
- `hasSubscription()`: Check subscription level
- `apiRequest()`: Make authenticated API requests

### Usage in Frontend

```javascript
// Check authentication status
const authStatus = await authManager.checkBothAuth();

// Make authenticated API request
const response = await authManager.apiRequest('/api/premium-feature');

// Check subscription
if (authManager.hasSubscription(['premium'])) {
    // Show premium features
}
```

## Subscription Management

### Subscription Levels

- **Free**: Basic features, limited usage
- **Premium**: Full features, higher limits
- **Enterprise**: Advanced features, unlimited usage

### Subscription UI

- `/subscription.html`: Subscription management page
- Integrated with dashboard for subscription status
- Modal prompts for subscription upgrades

## Security Features

### Password Security

- Bcrypt hashing with salt rounds of 12
- Minimum password length of 8 characters
- Password confirmation on signup

### JWT Security

- Configurable expiration time (default 7 days)
- Secure secret key requirement
- Token verification on protected routes

### Database Security

- Row Level Security (RLS) enabled
- Users can only access their own data
- Service role key for server-side operations only

## Migration from Single Auth

If you have existing users with only Google OAuth:

1. They'll be redirected to create app accounts
2. Can link their Google Business accounts after app signup
3. Existing Google OAuth sessions remain valid
4. No data loss - just additional authentication layer

## Development vs Production

### Development

- Uses local environment variables
- Demo subscription updates (no payment processing)
- Relaxed CORS settings

### Production Considerations

1. **Environment Variables**: Use secure environment variable management
2. **HTTPS**: Required for secure cookies and OAuth
3. **Payment Integration**: Integrate with Stripe or similar for real subscriptions
4. **Session Security**: Configure secure session settings
5. **Rate Limiting**: Add rate limiting for auth endpoints
6. **Monitoring**: Add logging and monitoring for auth events

## Troubleshooting

### Common Issues

1. **Supabase Connection Errors**
   - Check environment variables
   - Verify Supabase project is active
   - Check network connectivity

2. **JWT Token Issues**
   - Verify JWT_SECRET is set
   - Check token expiration settings
   - Clear localStorage if tokens are corrupted

3. **Google OAuth Issues**
   - Existing Google OAuth setup should work unchanged
   - Check Google Cloud Console settings
   - Verify callback URLs

### Debug Mode

Enable debug logging by setting:
```env
NODE_ENV=development
```

This will show detailed authentication logs in the console.

## Next Steps

1. **Payment Integration**: Add Stripe for real subscription processing
2. **Email Verification**: Add email verification for new accounts
3. **Password Reset**: Implement password reset functionality
4. **2FA**: Add two-factor authentication option
5. **Admin Panel**: Create admin interface for user management
6. **Analytics**: Add usage analytics and subscription metrics

## Support

For issues or questions about the dual authentication system:

1. Check the console logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test each authentication system separately
4. Check Supabase dashboard for database issues
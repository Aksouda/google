import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const router = express.Router();

// Check if Google credentials exist
const clientID = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

// Debug logging for credentials
console.log('🔍 Checking Google OAuth credentials...');
console.log('CLIENT_ID found:', clientID ? `${clientID.substring(0, 10)}...` : 'MISSING');
console.log('CLIENT_SECRET found:', clientSecret ? `${clientSecret.substring(0, 10)}...` : 'MISSING');

if (clientID && clientSecret) {
  // Configure Google OAuth strategy with simplified business management scopes
  // Scopes explained:
  // - profile: User's basic profile information  
  // - email: User's email address
  // - business.manage: Full access to Google Business Profile accounts, locations, reviews, and posts
  passport.use(new GoogleStrategy({
    clientID: clientID!,
    clientSecret: clientSecret!,
    callbackURL: '/auth/google/callback'
  }, (accessToken: string, refreshToken: string, profile: any, done: any) => {
    // Store access token for API calls
    profile.accessToken = accessToken;
    profile.refreshToken = refreshToken;
    return done(null, profile);
  }));

  // Session serialization
  passport.serializeUser((user: any, done: any) => done(null, user));
  passport.deserializeUser((user: any, done: any) => done(null, user));

  // OAuth routes with simplified business management scopes
  router.get('/google', passport.authenticate('google', { 
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/business.manage'
    ],
    accessType: 'offline',     // Request refresh token for offline access
    prompt: 'consent',         // Force consent screen to show all permissions
    includeGrantedScopes: true // Include previously granted scopes
  }));
  
  // OAuth callback with proper error handling
  router.get('/google/callback', 
    passport.authenticate('google', { 
      failureRedirect: '/?error=google_auth_failed',
      failureMessage: true 
    }),
    (req, res) => {
      // Successful authentication, redirect to dashboard
      const user = req.user as any;
      console.log('✅ User authenticated successfully');
      console.log('📊 User profile:', user?.displayName || 'Unknown user');
      console.log('🔑 Access token available:', user?.accessToken ? 'Yes' : 'No');
      console.log('🔄 Refresh token available:', user?.refreshToken ? 'Yes' : 'No');
      res.redirect('/auth-success.html');
    }
  );

  // User profile endpoint
  router.get('/profile', (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    res.json({ user: req.user });
  });

  // Logout route with session clearing
  router.get('/logout', (req, res) => {
    req.logout((err: any) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ error: 'Logout failed' });
      }
      // Clear the session completely
      req.session.destroy((sessionErr: any) => {
        if (sessionErr) {
          console.error('Session destroy error:', sessionErr);
        }
        res.clearCookie('connect.sid'); // Clear session cookie
        res.redirect('/');
      });
    });
  });

  console.log('✅ Google OAuth configured with simplified business management scopes');
  console.log('📋 Scopes: profile, email, business.manage');
  console.log('⚠️  Note: Ensure Google My Business API is enabled in Google Cloud Console');
} else {
  // Fallback routes when credentials are missing
  console.warn('⚠️ Google OAuth credentials missing - auth routes disabled');
  
  router.get('/google', (req, res) => {
    res.status(503).json({ error: 'OAuth not configured', message: 'Missing credentials' });
  });
  
  router.get('/google/callback', (req, res) => {
    res.status(503).json({ error: 'OAuth not configured', message: 'Missing credentials' });
  });

  router.get('/profile', (req, res) => {
    res.status(503).json({ error: 'OAuth not configured', message: 'Missing credentials' });
  });
  
  router.get('/logout', (req, res) => {
    res.status(503).json({ error: 'OAuth not configured', message: 'Missing credentials' });
  });
}

export default router;
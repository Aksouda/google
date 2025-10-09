// Load environment variables first, before any other imports
require('dotenv').config();

// Polyfill for Node.js < 18 compatibility with Supabase
if (typeof globalThis.Headers === 'undefined') {
  const { Headers } = require('node-fetch');
  globalThis.Headers = Headers;
}

if (typeof globalThis.fetch === 'undefined') {
  const fetch = require('node-fetch');
  globalThis.fetch = fetch;
  globalThis.Request = fetch.Request;
  globalThis.Response = fetch.Response;
}

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import authRoutes from './routes/auth';
import appAuthRoutes from './routes/appAuth';
import gmbRoutes from './routes/gmb';
import reviewsRoutes from './routes/reviews';
import openaiRoutes from './routes/openai';
import deepseekRoutes from './routes/deepseek';
import stripeRoutes from './routes/stripe';
import { SupabaseSessionStore } from './config/sessionStore';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.stripe.com"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'self'", "https://js.stripe.com"],
    },
  },
}));
app.use(cors());

// Stripe webhook route must come BEFORE express.json() middleware
app.use('/api/stripe', stripeRoutes);

app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Session middleware with Supabase store (production-ready)
app.use(session({
  store: new SupabaseSessionStore(),
  secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' // CSRF protection
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Dashboard route - serve dashboard.html with error handling
app.get('/dashboard', (req, res) => {
  const path = require('path');
  const dashboardPath = path.join(__dirname, '../public/dashboard.html');
  
  // Serve the dashboard file with error handling
  res.sendFile(dashboardPath, (err: any) => {
    if (err) {
      console.error('Error serving dashboard:', err.message);
      if (err.code === 'ENOENT') {
        res.status(404).json({ 
          error: 'Dashboard not found', 
          message: 'dashboard.html file is missing' 
        });
      } else {
        res.status(500).json({ 
          error: 'Internal server error', 
          message: 'Failed to serve dashboard' 
        });
      }
    }
  });
});

// Login route - redirect to main page (index.html)
app.get('/login', (req, res) => {
  res.redirect('/');
});

// Subscription route - serve subscription.html
app.get('/subscription', (req, res) => {
  const path = require('path');
  const subscriptionPath = path.join(__dirname, '../public/subscription.html');
  res.sendFile(subscriptionPath);
});

// Auth success route - serve auth-success.html
app.get('/auth-success', (req, res) => {
  const path = require('path');
  const authSuccessPath = path.join(__dirname, '../public/auth-success.html');
  res.sendFile(authSuccessPath);
});

// Set password route - serve set-password.html
app.get('/set-password', (req, res) => {
  const path = require('path');
  const setPasswordPath = path.join(__dirname, '../public/set-password.html');
  res.sendFile(setPasswordPath);
});

// Pricing route - serve pricing.html
app.get('/pricing', (req, res) => {
  const path = require('path');
  const pricingPath = path.join(__dirname, '../public/pricing.html');
  res.sendFile(pricingPath);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// User authentication status endpoint
app.get('/api/user', (req, res) => {
  if (req.user) {
    res.json({ user: req.user });
  } else {
    res.json({ user: null });
  }
});

// Root endpoint serves the HTML page (handled by static middleware)
// app.get('/', (req, res) => {
//   res.json({ message: 'Google Reviews API' });
// });

// Google OAuth routes (existing)
app.use('/auth', authRoutes);

// App authentication routes (new - Supabase-based)
app.use('/app-auth', appAuthRoutes);

// Google My Business API routes
app.use('/api/gmb', gmbRoutes);

// Reviews API routes
app.use('/api/reviews', reviewsRoutes);

// OpenAI API routes
app.use('/api/openai', openaiRoutes);

// DeepSeek API routes
app.use('/api/deepseek', deepseekRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
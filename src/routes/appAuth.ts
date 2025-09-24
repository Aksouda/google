import express from 'express';
import { signupUser, loginUser, getUserById, verifyToken } from '../services/authService';
import { requireAppAuth, requireSubscription } from '../middleware/appAuth';

const router = express.Router();

/**
 * Sign up new user
 * POST /app-auth/signup
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Email and password are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMAIL',
        message: 'Please provide a valid email address'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'WEAK_PASSWORD',
        message: 'Password must be at least 8 characters long'
      });
    }

    const result = await signupUser({ email, password });
    
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Signup route error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Login user
 * POST /app-auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Email and password are required'
      });
    }

    const result = await loginUser({ email, password });
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(401).json(result);
    }
  } catch (error) {
    console.error('Login route error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Get current user profile
 * GET /app-auth/profile
 */
router.get('/profile', requireAppAuth, async (req, res) => {
  try {
    const userId = (req as any).appUserId;
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Profile route error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Verify token
 * POST /app-auth/verify
 */
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_TOKEN',
        message: 'Token is required'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      });
    }

    const user = await getUserById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'USER_NOT_FOUND',
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('Verify route error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Logout user (client-side token removal)
 * POST /app-auth/logout
 */
router.post('/logout', (req, res) => {
  // Since we're using JWT tokens, logout is handled client-side
  // by removing the token from storage
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

/**
 * Update Google Business connection status
 * POST /app-auth/update-google-connection
 */
router.post('/update-google-connection', requireAppAuth, async (req, res) => {
  try {
    const { connected, google_email } = req.body;
    const userId = (req as any).appUserId;

    const { updateGoogleBusinessConnection } = await import('../services/authService');
    const success = await updateGoogleBusinessConnection(userId, connected);

    if (success) {
      res.json({
        success: true,
        message: 'Google Business connection status updated'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'UPDATE_FAILED',
        message: 'Failed to update Google Business connection'
      });
    }
  } catch (error) {
    console.error('Update Google connection error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Update subscription status (admin/demo function)
 * POST /app-auth/update-subscription
 */
router.post('/update-subscription', requireAppAuth, async (req, res) => {
  try {
    const { subscription_status } = req.body;
    const userId = (req as any).appUserId;

    if (!subscription_status || !['free', 'premium', 'enterprise'].includes(subscription_status)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_SUBSCRIPTION_STATUS',
        message: 'Valid subscription status required (free, premium, enterprise)'
      });
    }

    // In a real app, you'd validate payment/Stripe webhook here
    const { updateSubscriptionStatus } = await import('../services/authService');
    const success = await updateSubscriptionStatus(userId, subscription_status);

    if (success) {
      res.json({
        success: true,
        message: 'Subscription updated successfully'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'UPDATE_FAILED',
        message: 'Failed to update subscription'
      });
    }
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error'
    });
  }
});

/**
 * Test subscription-protected route
 * GET /app-auth/premium-test
 */
router.get('/premium-test', requireAppAuth, requireSubscription(['premium', 'enterprise']), (req, res) => {
  res.json({
    success: true,
    message: 'You have access to premium features!',
    user: (req as any).appUser
  });
});

export default router;
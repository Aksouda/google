import { Request, Response, NextFunction } from 'express';
import { verifyToken, getUserById, hasActiveSubscription, AppUser } from '../services/authService';

// Extend Express Request interface for app authentication
export interface AppAuthenticatedRequest extends Request {
  appUser?: AppUser;
  appUserId?: string;
  appUserToken?: string;
}

/**
 * Middleware to require app authentication (Supabase-based)
 * This is separate from Google OAuth authentication
 */
export function requireAppAuth(req: AppAuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'MISSING_TOKEN',
      message: 'Authentication token required. Please log in to your app account.'
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Verify JWT token
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid or expired authentication token. Please log in again.'
    });
  }

  // Get user from database
  getUserById(decoded.userId)
    .then(user => {
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'USER_NOT_FOUND',
          message: 'User account not found. Please log in again.'
        });
      }

      // Attach user info to request
      req.appUser = user;
      req.appUserId = user.id;
      req.appUserToken = token;

      console.log(`✅ App user authenticated: ${user.email} (${user.subscription_status})`);
      next();
    })
    .catch(error => {
      console.error('App auth middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Authentication error'
      });
    });
}

/**
 * Middleware to require active subscription
 */
export function requireSubscription(allowedPlans: ('active' | 'cancelling' | 'cancelled')[] = ['active', 'cancelling']) {
  return async (req: AppAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.appUser) {
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'App authentication required'
      });
    }

    const user = req.appUser;

    // Check if user's plan is in allowed plans
    if (!allowedPlans.includes(user.subscription_status)) {
      return res.status(403).json({
        success: false,
        error: 'SUBSCRIPTION_REQUIRED',
        message: `This feature requires a ${allowedPlans.join(' or ')} subscription.`,
        currentPlan: user.subscription_status,
        requiredPlans: allowedPlans
      });
    }

    // For active and cancelling plans, check if subscription is still active
    if (user.subscription_status === 'active' || user.subscription_status === 'cancelling') {
      const hasActive = await hasActiveSubscription(user.id);
      if (!hasActive) {
        return res.status(403).json({
          success: false,
          error: 'SUBSCRIPTION_EXPIRED',
          message: 'Your subscription has expired. Please renew to continue using premium features.',
          currentPlan: user.subscription_status
        });
      }
    }

    console.log(`✅ Subscription check passed: ${user.email} (${user.subscription_status})`);
    next();
  };
}

/**
 * Middleware to optionally check app authentication
 * Attaches user info if authenticated, but doesn't require it
 */
export function optionalAppAuth(req: AppAuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('ℹ️ No app authentication (optional access)');
    return next();
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    console.log('ℹ️ Invalid app token (optional access)');
    return next();
  }

  getUserById(decoded.userId)
    .then(user => {
      if (user) {
        req.appUser = user;
        req.appUserId = user.id;
        req.appUserToken = token;
        console.log(`✅ App user authenticated (optional): ${user.email}`);
      }
      next();
    })
    .catch(error => {
      console.error('Optional app auth error:', error);
      next(); // Continue without authentication
    });
}

/**
 * Combined middleware that requires both app authentication and Google OAuth
 * Use this for routes that need both app subscription AND Google Business access
 */
export function requireBothAuth(req: AppAuthenticatedRequest, res: Response, next: NextFunction) {
  // First check app authentication
  requireAppAuth(req, res, (appAuthError) => {
    if (appAuthError) return;

    // Then check Google OAuth (from existing middleware)
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
      return res.status(401).json({
        success: false,
        error: 'GOOGLE_AUTH_REQUIRED',
        message: 'Google Business authentication required. Please connect your Google Business account.',
        googleLoginUrl: '/auth/google'
      });
    }

    if (!req.user.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'GOOGLE_ACCESS_TOKEN_REQUIRED',
        message: 'Google access token required. Please re-authenticate with Google.',
        googleLoginUrl: '/auth/google'
      });
    }

    console.log(`✅ Both authentications successful: App(${req.appUser?.email}) + Google(${req.user.displayName})`);
    next();
  });
}

/**
 * Utility function to get app user info from request
 */
export function getAppUserInfo(req: AppAuthenticatedRequest): AppUser | null {
  return req.appUser || null;
}

/**
 * Utility function to check if user is app authenticated
 */
export function isAppAuthenticated(req: AppAuthenticatedRequest): boolean {
  return !!(req.appUser && req.appUserId);
}

export default {
  requireAppAuth,
  requireSubscription,
  optionalAppAuth,
  requireBothAuth,
  getAppUserInfo,
  isAppAuthenticated
};
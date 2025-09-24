import { Request, Response, NextFunction } from 'express';

// Extend Express User interface to include our required properties
declare global {
  namespace Express {
    interface User {
      id?: string;
      displayName?: string;
      emails?: Array<{
        value: string;
        verified?: boolean;
      }>;
      photos?: Array<{
        value: string;
      }>;
      accessToken?: string;
      refreshToken?: string;
      provider?: string;
      _json?: any;
      _raw?: string;
    }
  }
}

// Use Express Request with proper typing
export interface AuthenticatedRequest extends Request {
  user?: Express.User;
}

export interface AuthMiddlewareOptions {
  redirectUrl?: string;
  returnJson?: boolean;
  requireAccessToken?: boolean;
}

/**
 * Authentication middleware factory
 * Creates middleware to protect routes and check user authentication
 */
export function requireAuth(options: AuthMiddlewareOptions = {}) {
  const {
    redirectUrl = '/login',
    returnJson = true,
    requireAccessToken = false
  } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Check if user is authenticated via Passport.js
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      console.log('❌ Authentication failed: No valid session');
      
      if (returnJson) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required. Please log in to access this resource.',
          loginUrl: '/auth/google'
        });
      } else {
        return res.redirect(redirectUrl);
      }
    }

    // Check if user object exists
    if (!req.user) {
      console.log('❌ Authentication failed: No user object in session');
      
      if (returnJson) {
        return res.status(401).json({
          success: false,
          error: 'USER_NOT_FOUND',
          message: 'User information not found in session. Please log in again.',
          loginUrl: '/auth/google'
        });
      } else {
        return res.redirect(redirectUrl);
      }
    }

    // Optional: Check if access token is required and present
    if (requireAccessToken && !req.user.accessToken) {
      console.log('❌ Authentication failed: Access token required but not found');
      
      if (returnJson) {
        return res.status(401).json({
          success: false,
          error: 'ACCESS_TOKEN_REQUIRED',
          message: 'Access token required for this operation. Please re-authenticate.',
          loginUrl: '/auth/google'
        });
      } else {
        return res.redirect(redirectUrl);
      }
    }

    // Log successful authentication
    console.log(`✅ User authenticated: ${req.user.displayName} (${req.user.emails?.[0]?.value})`);

    // Attach additional user info to request for convenience
    (req as any).userId = req.user.id;
    (req as any).userEmail = req.user.emails?.[0]?.value;
    (req as any).userName = req.user.displayName;

    // Continue to next middleware
    next();
  };
}

/**
 * Middleware to check authentication but not require it
 * Attaches user info if available, but allows unauthenticated access
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    console.log(`✅ User authenticated (optional): ${req.user.displayName}`);
    
    // Attach user info to request
    (req as any).userId = req.user.id;
    (req as any).userEmail = req.user.emails?.[0]?.value;
    (req as any).userName = req.user.displayName;
  } else {
    console.log('ℹ️ No authentication (optional access)');
  }

  next();
}

/**
 * Middleware specifically for API routes that require Google access tokens
 * Used for Google My Business API calls
 */
export function requireGoogleAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  // First check basic authentication
  if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) {
    console.log('❌ Google Auth failed: Not authenticated');
    
    return res.status(401).json({
      success: false,
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Google authentication required to access this resource.',
      loginUrl: '/auth/google'
    });
  }

  // Check for Google access token
  if (!req.user.accessToken) {
    console.log('❌ Google Auth failed: No access token');
    
    return res.status(401).json({
      success: false,
      error: 'GOOGLE_ACCESS_TOKEN_REQUIRED',
      message: 'Google access token required. Please re-authenticate with Google.',
      loginUrl: '/auth/google'
    });
  }

  // Validate token format (basic check)
  if (typeof req.user.accessToken !== 'string' || req.user.accessToken.length < 10) {
    console.log('❌ Google Auth failed: Invalid access token format');
    
    return res.status(401).json({
      success: false,
      error: 'INVALID_ACCESS_TOKEN',
      message: 'Invalid Google access token. Please re-authenticate.',
      loginUrl: '/auth/google'
    });
  }

  console.log(`✅ Google Auth successful: ${req.user.displayName} with valid access token`);

  // Attach Google-specific info to request
  (req as any).googleAccessToken = req.user.accessToken;
  (req as any).googleRefreshToken = req.user.refreshToken;
  (req as any).userId = req.user.id;
  (req as any).userEmail = req.user.emails?.[0]?.value;
  (req as any).userName = req.user.displayName;

  next();
}

/**
 * Middleware to check if user has admin privileges
 * Can be combined with other auth middleware
 */
export function requireAdmin(adminEmails: string[] = []) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required.'
      });
    }

    const userEmail = req.user.emails?.[0]?.value;
    if (!userEmail || !adminEmails.includes(userEmail)) {
      console.log(`❌ Admin access denied for: ${userEmail}`);
      
      return res.status(403).json({
        success: false,
        error: 'ADMIN_REQUIRED',
        message: 'Administrator privileges required to access this resource.'
      });
    }

    console.log(`✅ Admin access granted: ${userEmail}`);
    (req as any).isAdmin = true;
    
    next();
  };
}

/**
 * Error handler for authentication failures
 */
export function authErrorHandler(error: any, req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (error.name === 'AuthenticationError') {
    return res.status(401).json({
      success: false,
      error: 'AUTHENTICATION_ERROR',
      message: 'Authentication failed. Please try logging in again.',
      loginUrl: '/auth/google'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'TOKEN_EXPIRED',
      message: 'Your session has expired. Please log in again.',
      loginUrl: '/auth/google'
    });
  }

  // Pass other errors to the default error handler
  next(error);
}

/**
 * Utility function to extract user info from request
 */
export function getUserInfo(req: AuthenticatedRequest): Express.User | null {
  return req.user || null;
}

/**
 * Utility function to check if user is authenticated
 */
export function isAuthenticated(req: AuthenticatedRequest): boolean {
  return !!(req.isAuthenticated && req.isAuthenticated() && req.user);
}

/**
 * Utility function to get user's access token
 */
export function getAccessToken(req: AuthenticatedRequest): string | null {
  return req.user?.accessToken || null;
}

export default {
  requireAuth,
  optionalAuth,
  requireGoogleAuth,
  requireAdmin,
  authErrorHandler,
  getUserInfo,
  isAuthenticated,
  getAccessToken
};
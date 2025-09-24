import express from 'express';
import { 
  createGMBService, 
  getAccessTokenFromUser, 
  GoogleMyBusinessService, 
  ServiceError 
} from '../services/googleMyBusinessService';
import { requireGoogleAuth, AuthenticatedRequest } from '../middleware/auth';
import { requireBothAuth } from '../middleware/appAuth';

const router = express.Router();

/**
 * GMB-specific middleware to attach GMB service to request
 */
function attachGMBService(req: express.Request, res: express.Response, next: express.NextFunction) {
  const accessToken = getAccessTokenFromUser(req.user);
  if (!accessToken) {
    return res.status(401).json({
      success: false,
      error: 'ACCESS_TOKEN_NOT_FOUND',
      message: 'Google access token not found. Please re-authenticate.',
      loginUrl: '/auth/google'
    });
  }

  try {
    (req as any).gmbService = createGMBService(accessToken);
    next();
  } catch (error: any) {
    console.error('❌ Error creating GMB service:', error.message);
    return res.status(500).json({
      success: false,
      error: 'SERVICE_INITIALIZATION_FAILED',
      message: 'Failed to initialize Google My Business service'
    });
  }
}

/**
 * GET /api/gmb/locations - Get user's business locations
 */
router.get('/locations', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { pageSize, pageToken } = req.query;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log('📍 GMB API: Fetching business locations');

    const locations = await gmbService.fetchBusinessLocations(
      pageSize ? parseInt(pageSize as string) : undefined,
      pageToken as string || undefined
    );

    res.json({
      success: true,
      data: locations,
      message: `Found ${locations.locations.length} business locations`
    });

  } catch (error: any) {
    console.error('❌ GMB API Error fetching locations:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_LOCATIONS_ERROR',
      message: serviceError.message || 'Failed to fetch business locations'
    });
  }
});

/**
 * GET /api/gmb/locations/:locationId/reviews - Get reviews for a specific location
 */
/**
 * GET /api/gmb/locations/:locationId - Get detailed information for a specific location including address
 */
router.get('/locations/:locationId', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locationId } = req.params;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log(`📍 GMB API: Fetching location details for: ${locationId}`);

    // Construct full location name
    const locationName = locationId.startsWith('locations/') 
      ? locationId 
      : `locations/${locationId}`;

    const locationDetails = await gmbService.fetchLocationDetails(locationName);

    res.json({
      success: true,
      data: locationDetails,
      message: `Retrieved location details for ${locationDetails.displayName || locationName}`
    });

  } catch (error: any) {
    console.error('❌ GMB API Error fetching location details:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_LOCATION_ERROR',
      message: serviceError.message || 'Failed to fetch location details'
    });
  }
});

/**
 * GET /api/gmb/locations/:locationId/reviews - Get reviews for a specific location
 */
router.get('/locations/:locationId/reviews', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locationId } = req.params;
    const { pageSize, pageToken, unansweredOnly } = req.query;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log(`📝 GMB API: Fetching reviews for location: ${locationId}`);

    // Construct full location name
    const locationName = locationId.startsWith('accounts/') 
      ? locationId 
      : `accounts/-/locations/${locationId}`;

    if (unansweredOnly === 'true') {
      // Get only unanswered reviews
      const unansweredReviews = await gmbService.fetchUnansweredReviews(
        locationName,
        pageSize ? parseInt(pageSize as string) : undefined,
        pageToken as string || undefined
      );

      res.json({
        success: true,
        data: {
          reviews: unansweredReviews,
          totalReviews: unansweredReviews.length,
          unansweredCount: unansweredReviews.length
        },
        message: `Found ${unansweredReviews.length} unanswered reviews`
      });
    } else {
      // Get all reviews
      const reviewsResponse = await gmbService.fetchLocationReviews(
        locationName,
        pageSize ? parseInt(pageSize as string) : undefined,
        pageToken as string || undefined
      );

      res.json({
        success: true,
        data: reviewsResponse,
        message: `Found ${reviewsResponse.reviews.length} reviews, ${reviewsResponse.unansweredReviews.length} unanswered`
      });
    }

  } catch (error: any) {
    console.error('❌ GMB API Error fetching reviews:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_REVIEWS_ERROR',
      message: serviceError.message || 'Failed to fetch reviews'
    });
  }
});

/**
 * POST /api/gmb/reviews/:reviewId/reply - Reply to a specific review
 */
router.post('/reviews/:reviewId/reply', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { reviewId } = req.params;
    const { replyText } = req.body;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    if (!replyText || replyText.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'Reply text is required'
      });
    }

    // Decode the review name if it was URL encoded
    const decodedReviewId = decodeURIComponent(reviewId);
    console.log(`💬 GMB API: Replying to review: ${decodedReviewId}`);

    // Use the decoded review name directly (it should already be the full path)
    const reviewName = decodedReviewId;

    const result = await gmbService.replyToReview(reviewName, replyText.trim());

    // Log successful reply for tracking
    console.log(`✅ REPLY POSTED TO GOOGLE:`, {
      reviewId: reviewName.split('/').pop(),
      reviewName: reviewName,
      replyText: replyText.trim(),
      timestamp: new Date().toISOString(),
      googleResponse: result
    });

    res.json({
      success: true,
      data: result,
      message: 'Review reply posted successfully'
    });

  } catch (error: any) {
    console.error('❌ GMB API Error replying to review:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'REPLY_ERROR',
      message: serviceError.message || 'Failed to post review reply'
    });
  }
});

/**
 * GET /api/gmb/verify - Verify Google My Business API access
 */
router.get('/verify', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log('🔍 GMB API: Verifying Google My Business access');

    const isValid = await gmbService.verifyAccess();

    if (isValid) {
      res.json({
        success: true,
        data: { verified: true },
        message: 'Google My Business access verified'
      });
    } else {
      res.status(401).json({
        success: false,
        error: 'VERIFICATION_FAILED',
        message: 'Google My Business access verification failed'
      });
    }

  } catch (error: any) {
    console.error('❌ GMB API Error verifying access:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'VERIFICATION_ERROR',
      message: serviceError.message || 'Failed to verify Google My Business access'
    });
  }
});

/**
 * GET /api/gmb/status - Get API status and user permissions
 */
router.get('/status', requireGoogleAuth, async (req: express.Request, res: express.Response) => {
  try {
    const accessToken = getAccessTokenFromUser(req.user);
    const hasToken = !!accessToken;

    res.json({
      success: true,
      data: {
        authenticated: !!req.user,
        hasAccessToken: hasToken,
        userEmail: req.user?.emails?.[0]?.value || 'Unknown',
        userName: req.user?.displayName || 'Unknown User',
        scopes: (req.user as any)?.scope || []
      },
      message: 'GMB API status retrieved'
    });

  } catch (error: any) {
    console.error('❌ GMB API Error getting status:', error);
    
    res.status(500).json({
      success: false,
      error: 'STATUS_ERROR',
      message: 'Failed to get API status'
    });
  }
});

/**
 * GET /api/gmb/cache/stats - Get cache statistics
 */
router.get('/cache/stats', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;
    const stats = gmbService.getCacheStats();
    
    console.log('📊 GMB API: Retrieved cache stats:', stats);
    
    res.json({
      success: true,
      data: stats,
      message: `Cache contains ${stats.size} entries`
    });

  } catch (error: any) {
    console.error('❌ GMB API Error getting cache stats:', error);
    
    res.status(500).json({
      success: false,
      error: 'CACHE_STATS_ERROR',
      message: 'Failed to get cache statistics'
    });
  }
});

/**
 * POST /api/gmb/cache/clear - Clear the cache
 */
router.post('/cache/clear', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;
    gmbService.clearCache();
    
    console.log('🗑️ GMB API: Cache cleared by user request');
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });

  } catch (error: any) {
    console.error('❌ GMB API Error clearing cache:', error);
    
    res.status(500).json({
      success: false,
      error: 'CACHE_CLEAR_ERROR',
      message: 'Failed to clear cache'
    });
  }
});

export default router;
import express from 'express';
import { 
  createGMBService, 
  getAccessTokenFromUser, 
  GoogleMyBusinessService, 
  ServiceError 
} from '../services/googleMyBusinessService';
import { requireGoogleAuth, AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/reviews/locations - Get business locations (alias for convenience)
 */
router.get('/locations', requireGoogleAuth, async (req: express.Request, res: express.Response) => {
  try {
    const accessToken = getAccessTokenFromUser(req.user);
    if (!accessToken) {
      return res.status(401).json({
        success: false,
        error: 'ACCESS_TOKEN_NOT_FOUND',
        message: 'Google access token not found. Please re-authenticate.',
        loginUrl: '/auth/google'
      });
    }

    const gmbService = createGMBService(accessToken);
    const { pageSize, pageToken } = req.query;

    console.log('📍 Reviews API: Fetching business locations');

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
    console.error('❌ Reviews API Error fetching locations:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_LOCATIONS_ERROR',
      message: serviceError.message || 'Failed to fetch business locations'
    });
  }
});

/**
 * Reviews-specific middleware to attach GMB service to request
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
 * GET /api/reviews/location/:locationId - Get reviews for a specific location
 */
router.get('/location/:locationId', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locationId } = req.params;
    const { pageSize, pageToken, unansweredOnly } = req.query;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log(`📝 Reviews API: Fetching reviews for location: ${locationId}`);

    // Construct full location name
    const locationName = locationId.startsWith('accounts/') 
      ? locationId 
      : `accounts/-/locations/${locationId}`;

    if (unansweredOnly === 'true') {
      // For unanswered reviews, we need a more sophisticated approach
      // since filtering might reduce the actual count returned
      const actualPageSize = parseInt(pageSize as string) || 50;
      
      // Create a cache key for this location's pagination state
      const paginationCacheKey = `unanswered_${locationName}`;
      
      // Initialize or retrieve pagination state
      if (!(global as any).paginationCache) {
        (global as any).paginationCache = new Map();
      }
      
      let paginationState = (global as any).paginationCache.get(paginationCacheKey);
      
      if (!paginationState) {
        // First time loading this location - initialize state
        paginationState = {
          accumulatedReviews: [],
          lastPageToken: undefined,
          hasMorePages: true,
          totalReviewsFetched: 0,
          currentIndex: 0
        };
        (global as any).paginationCache.set(paginationCacheKey, paginationState);
      }
      
      // If we have a pageToken, we're resuming pagination
      if (pageToken && pageToken !== 'continue') {
        console.log(`🔄 Resuming pagination from stored state for location: ${locationName}`);
        // For now, we'll reset and start fresh
        // TODO: Implement proper resume with stored state
        paginationState = {
          accumulatedReviews: [],
          lastPageToken: undefined,
          hasMorePages: true,
          totalReviewsFetched: 0,
          currentIndex: 0
        };
        (global as any).paginationCache.set(paginationCacheKey, paginationState);
      }
      
      // Keep fetching pages until we have enough unanswered reviews or no more pages
      while (paginationState.accumulatedReviews.length < (paginationState.currentIndex + actualPageSize) && paginationState.hasMorePages) {
        const reviewsResponse = await gmbService.fetchLocationReviews(
          locationName,
          Math.min(actualPageSize * 2, 100), // Fetch more per page to increase chances of finding unanswered
          paginationState.lastPageToken
        );
        
        // Add unanswered reviews from this page
        const pageUnansweredReviews = reviewsResponse.unansweredReviews || [];
        
        // Debug: Check if we're accidentally adding replied reviews
        console.log(`🔍 Page fetched ${reviewsResponse.reviews?.length || 0} total, ${pageUnansweredReviews.length} unanswered`);
        pageUnansweredReviews.forEach((review, index) => {
          if (review.reviewReply && review.reviewReply.comment) {
            console.warn(`⚠️ REPLIED REVIEW IN UNANSWERED LIST:`, {
              reviewId: review.reviewId,
              hasReply: !!review.reviewReply,
              replyComment: review.reviewReply.comment.substring(0, 50)
            });
          }
        });
        
        paginationState.accumulatedReviews.push(...pageUnansweredReviews);
        
        // Update pagination info
        paginationState.lastPageToken = reviewsResponse.nextPageToken;
        paginationState.hasMorePages = !!reviewsResponse.nextPageToken;
        paginationState.totalReviewsFetched += (reviewsResponse.reviews || []).length;
        
        console.log(`📄 Fetched page: ${pageUnansweredReviews.length} unanswered reviews, total accumulated: ${paginationState.accumulatedReviews.length}, next token: ${paginationState.lastPageToken}`);
        
        // Safety check to prevent infinite loops
        if (paginationState.totalReviewsFetched > 1000) {
          console.warn('⚠️ Safety limit reached while fetching unanswered reviews');
          break;
        }
      }
      
      // Get the reviews for the current page
      const startIndex = paginationState.currentIndex;
      const endIndex = startIndex + actualPageSize;
      const reviewsToReturn = paginationState.accumulatedReviews.slice(startIndex, endIndex);
      
      // Determine if there are more reviews available
      const hasMoreReviews = endIndex < paginationState.accumulatedReviews.length || paginationState.hasMorePages;
      const effectiveNextPageToken = hasMoreReviews ? 'continue' : undefined;
      
      // Update the current index for next page
      if (hasMoreReviews) {
        paginationState.currentIndex = endIndex;
      }
      
      // Store updated state
      (global as any).paginationCache.set(paginationCacheKey, paginationState);
      
      console.log(`📊 Pagination summary:`, {
        requested: actualPageSize,
        accumulated: paginationState.accumulatedReviews.length,
        returned: reviewsToReturn.length,
        startIndex,
        endIndex,
        hasMorePages: paginationState.hasMorePages,
        hasMoreReviews,
        effectiveNextPageToken,
        totalReviewsFetched: paginationState.totalReviewsFetched
      });

      res.json({
        success: true,
        data: {
          reviews: reviewsToReturn,
          totalReviews: paginationState.totalReviewsFetched,
          unansweredCount: reviewsToReturn.length,
          hasNextPage: !!effectiveNextPageToken,
          nextPageToken: effectiveNextPageToken,
          averageRating: undefined, // We'll need to calculate this from the fetched reviews if needed
          filter: 'unanswered'
        },
        message: `Found ${reviewsToReturn.length} unanswered reviews`
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
        data: {
          ...reviewsResponse,
          totalReviews: reviewsResponse.totalReviewCount || reviewsResponse.reviews.length,
          hasNextPage: !!reviewsResponse.nextPageToken,
          filter: 'all'
        },
        message: `Found ${reviewsResponse.reviews.length} reviews, ${reviewsResponse.unansweredReviews.length} unanswered`
      });
    }

  } catch (error: any) {
    console.error('❌ Reviews API Error fetching reviews:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_REVIEWS_ERROR',
      message: serviceError.message || 'Failed to fetch reviews'
    });
  }
});

/**
 * POST /api/reviews/:reviewId/reply - Reply to a specific review
 */
router.post('/:reviewId/reply', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
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
    console.log(`💬 Reviews API: Replying to review: ${decodedReviewId}`);

    // Use the decoded review name directly (it should already be the full path)
    const reviewName = decodedReviewId;

    const result = await gmbService.replyToReview(reviewName, replyText.trim());

    // Clear pagination cache for this location since the review state has changed
    if ((global as any).paginationCache) {
      // Extract location name from review name (e.g., "accounts/-/locations/123/reviews/456" -> "accounts/-/locations/123")
      const locationMatch = reviewName.match(/^(accounts\/-\/locations\/[^\/]+)/);
      if (locationMatch) {
        const locationName = locationMatch[1];
        const paginationCacheKey = `unanswered_${locationName}`;
        (global as any).paginationCache.delete(paginationCacheKey);
        console.log(`🗑️ Cleared pagination cache for location: ${locationName}`);
      }
    }

    res.json({
      success: true,
      data: {
        ...result,
        reviewId,
        replyText: replyText.trim()
      },
      message: 'Review reply posted successfully'
    });

  } catch (error: any) {
    console.error('❌ Reviews API Error replying to review:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'REPLY_ERROR',
      message: serviceError.message || 'Failed to post review reply'
    });
  }
});

/**
 * GET /api/reviews/unanswered - Get all unanswered reviews across all locations
 */
router.get('/unanswered', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { pageSize, pageToken } = req.query;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log('📝 Reviews API: Fetching all unanswered reviews');

    // First get all business locations
    const locationsResponse = await gmbService.fetchBusinessLocations(100);
    const locations = locationsResponse.locations;

    if (locations.length === 0) {
      return res.json({
        success: true,
        data: {
          reviews: [],
          totalReviews: 0,
          locationsChecked: 0
        },
        message: 'No business locations found'
      });
    }

    // Get unanswered reviews from all locations
    const allUnansweredReviews: any[] = [];
    for (const location of locations) {
      try {
        const unansweredReviews = await gmbService.fetchUnansweredReviews(
          location.name,
          pageSize ? parseInt(pageSize as string) : 50
        );
        
        // Add location info to each review
        const reviewsWithLocation = unansweredReviews.map(review => ({
          ...review,
          locationName: location.displayName,
          locationId: location.name
        }));
        
        allUnansweredReviews.push(...reviewsWithLocation);
      } catch (locationError) {
        console.warn(`⚠️ Failed to fetch reviews for location ${location.name}:`, locationError);
        // Continue with other locations
      }
    }

    res.json({
      success: true,
      data: {
        reviews: allUnansweredReviews,
        totalReviews: allUnansweredReviews.length,
        locationsChecked: locations.length
      },
      message: `Found ${allUnansweredReviews.length} unanswered reviews across ${locations.length} locations`
    });

  } catch (error: any) {
    console.error('❌ Reviews API Error fetching all unanswered reviews:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_UNANSWERED_ERROR',
      message: serviceError.message || 'Failed to fetch unanswered reviews'
    });
  }
});

/**
 * GET /api/reviews/stats - Get review statistics
 */
router.get('/stats', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log('📊 Reviews API: Fetching review statistics');

    // Get all business locations
    const locationsResponse = await gmbService.fetchBusinessLocations(100);
    const locations = locationsResponse.locations;

    if (locations.length === 0) {
      return res.json({
        success: true,
        data: {
          totalLocations: 0,
          totalReviews: 0,
          unansweredReviews: 0,
          averageRating: 0,
          locationStats: []
        },
        message: 'No business locations found'
      });
    }

    const locationStats: any[] = [];
    let totalReviews = 0;
    let totalUnanswered = 0;
    let totalRatingSum = 0;
    let locationsWithRatings = 0;

    for (const location of locations) {
      try {
        const reviewsResponse = await gmbService.fetchLocationReviews(location.name, 100);
        
        const locationStat = {
          locationName: location.displayName,
          locationId: location.name,
          totalReviews: reviewsResponse.reviews.length,
          unansweredReviews: reviewsResponse.unansweredReviews.length,
          averageRating: reviewsResponse.averageRating || 0
        };

        locationStats.push(locationStat);
        totalReviews += locationStat.totalReviews;
        totalUnanswered += locationStat.unansweredReviews;
        
        if (locationStat.averageRating > 0) {
          totalRatingSum += locationStat.averageRating;
          locationsWithRatings++;
        }
      } catch (locationError) {
        console.warn(`⚠️ Failed to fetch stats for location ${location.name}:`, locationError);
        // Add location with zero stats
        locationStats.push({
          locationName: location.displayName,
          locationId: location.name,
          totalReviews: 0,
          unansweredReviews: 0,
          averageRating: 0
        });
      }
    }

    const overallAverageRating = locationsWithRatings > 0 
      ? (totalRatingSum / locationsWithRatings) 
      : 0;

    res.json({
      success: true,
      data: {
        totalLocations: locations.length,
        totalReviews,
        unansweredReviews: totalUnanswered,
        averageRating: parseFloat(overallAverageRating.toFixed(2)),
        responseRate: totalReviews > 0 ? parseFloat(((totalReviews - totalUnanswered) / totalReviews * 100).toFixed(1)) : 0,
        locationStats
      },
      message: `Statistics for ${locations.length} business locations`
    });

  } catch (error: any) {
    console.error('❌ Reviews API Error fetching statistics:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'FETCH_STATS_ERROR',
      message: serviceError.message || 'Failed to fetch review statistics'
    });
  }
});

/**
 * POST /api/reviews/cache/clear - Clear pagination cache
 */
router.post('/cache/clear', requireGoogleAuth, async (req: express.Request, res: express.Response) => {
  try {
    const { locationName } = req.body;
    
    if ((global as any).paginationCache) {
      if (locationName) {
        // Clear cache for specific location
        const paginationCacheKey = `unanswered_${locationName}`;
        const deleted = (global as any).paginationCache.delete(paginationCacheKey);
        console.log(`🗑️ Cleared pagination cache for location: ${locationName}, deleted: ${deleted}`);
      } else {
        // Clear all pagination cache
        const cacheSize = (global as any).paginationCache.size;
        (global as any).paginationCache.clear();
        console.log(`🗑️ Cleared all pagination cache, removed ${cacheSize} entries`);
      }
    }

    res.json({
      success: true,
      message: 'Pagination cache cleared successfully'
    });

  } catch (error: any) {
    console.error('❌ Reviews API Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'CACHE_CLEAR_ERROR',
      message: 'Failed to clear pagination cache'
    });
  }
});

/**
 * POST /api/reviews/clear-cache - Clear pagination cache for a location
 */
router.post('/clear-cache', (req: express.Request, res: express.Response) => {
  try {
    const { locationId } = req.body;
    
    if (locationId) {
      // Clear pagination cache for this location
      const locationName = locationId.startsWith('accounts/') 
        ? locationId 
        : `accounts/-/locations/${locationId}`;
      
      const paginationCacheKey = `unanswered_${locationName}`;
      
      if ((global as any).paginationCache) {
        (global as any).paginationCache.delete(paginationCacheKey);
        console.log(`🗑️ Cleared pagination cache for location: ${locationName}`);
      }
    } else {
      // Clear all pagination cache
      if ((global as any).paginationCache) {
        (global as any).paginationCache.clear();
        console.log('🗑️ Cleared all pagination cache');
      }
    }
    
    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
    
  } catch (error: any) {
    console.error('❌ Error clearing cache:', error);
    res.status(500).json({
      success: false,
      error: 'CACHE_CLEAR_ERROR',
      message: 'Failed to clear cache'
    });
  }
});

export default router;
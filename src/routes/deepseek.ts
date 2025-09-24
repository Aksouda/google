import express from 'express';
import { deepseekService } from '../services/deepseekService';

const router = express.Router();

/**
 * POST /api/deepseek/generate-review-response - Generate AI-powered review response using DeepSeek
 */
router.post('/generate-review-response', async (req: express.Request, res: express.Response) => {
  try {
    const { reviewerName, starRating, reviewComment, businessType = 'business' } = req.body;

    // Validation
    if (!starRating) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Star rating is required'
      });
    }

    // Get client identifier for rate limiting (could be IP, user ID, etc.)
    const clientId = req.ip || req.headers['x-forwarded-for'] as string || 'anonymous';

    console.log('🤖 Generating DeepSeek review response...');
    console.log('📝 Review details:', { 
      reviewerName: reviewerName || 'Anonymous', 
      starRating, 
      hasComment: !!reviewComment,
      businessType,
      clientId
    });

    // Generate response using DeepSeek service
    const result = await deepseekService.generateReviewResponse(
      reviewerName,
      starRating,
      reviewComment,
      businessType,
      clientId
    );

    if (!result.success) {
      const statusCode = result.error?.includes('rate limit') ? 429 : 500;
      return res.status(statusCode).json({
        success: false,
        error: result.error?.includes('rate limit') ? 'RATE_LIMIT_EXCEEDED' : 'GENERATION_FAILED',
        message: result.error
      });
    }

    console.log(`✅ DeepSeek response generated successfully (${result.cached ? 'cached' : 'fresh'})`);

    res.json({
      success: true,
      response: result.response,
      category: result.category,
      sentiment: result.sentiment,
      cached: result.cached,
      usage: result.usage,
      model: 'deepseek-chat'
    });

  } catch (error: any) {
    console.error('❌ Error in DeepSeek generate endpoint:', error);
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Internal server error while generating response'
    });
  }
});

/**
 * POST /api/deepseek/test - Test DeepSeek API connection
 */
router.post('/test', async (req: express.Request, res: express.Response) => {
  try {
    console.log('🧪 DeepSeek API test endpoint called');

    const result = await deepseekService.testConnection();

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'API_TEST_FAILED',
        message: result.message
      });
    }

    console.log('✅ DeepSeek API test successful');

    res.json({
      success: true,
      message: result.message,
      model: result.model
    });

  } catch (error: any) {
    console.error('❌ DeepSeek API test failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'TEST_FAILED',
      message: `DeepSeek API test failed: ${error.message}`
    });
  }
});

/**
 * GET /api/deepseek/status - Check DeepSeek service status and cache stats
 */
router.get('/status', (req: express.Request, res: express.Response) => {
  try {
    const hasApiKey = !!process.env.DEEPSEEK_API_KEY;
    const cacheStats = deepseekService.getCacheStats();

    res.json({
      success: true,
      configured: hasApiKey,
      hasApiKey,
      cache: cacheStats,
      service: 'deepseek',
      model: 'deepseek-chat'
    });

  } catch (error: any) {
    console.error('❌ Error getting DeepSeek status:', error);
    
    res.status(500).json({
      success: false,
      error: 'STATUS_ERROR',
      message: 'Failed to get service status'
    });
  }
});

/**
 * POST /api/deepseek/cache/clear - Clear response cache
 */
router.post('/cache/clear', (req: express.Request, res: express.Response) => {
  try {
    console.log('🗑️ Clearing DeepSeek response cache...');
    
    deepseekService.clearCache();
    
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

/**
 * GET /api/deepseek/cache/stats - Get detailed cache statistics
 */
router.get('/cache/stats', (req: express.Request, res: express.Response) => {
  try {
    const stats = deepseekService.getCacheStats();
    
    res.json({
      success: true,
      stats,
      message: `Cache contains ${stats.totalEntries} entries with ${(stats.cacheHitRate * 100).toFixed(1)}% hit rate`
    });

  } catch (error: any) {
    console.error('❌ Error getting cache stats:', error);
    
    res.status(500).json({
      success: false,
      error: 'STATS_ERROR',
      message: 'Failed to get cache statistics'
    });
  }
});

/**
 * POST /api/deepseek/batch-generate - Generate responses for multiple reviews (with caching benefits)
 */
router.post('/batch-generate', async (req: express.Request, res: express.Response) => {
  try {
    const { reviews, businessType = 'business' } = req.body;

    if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'Reviews array is required'
      });
    }

    if (reviews.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'BATCH_TOO_LARGE',
        message: 'Maximum 10 reviews per batch request'
      });
    }

    const clientId = req.ip || req.headers['x-forwarded-for'] as string || 'anonymous';
    console.log(`🔄 Processing batch of ${reviews.length} reviews for client: ${clientId}`);

    const results = [];
    let cacheHits = 0;
    let errors = 0;

    for (let i = 0; i < reviews.length; i++) {
      const review = reviews[i];
      
      try {
        const result = await deepseekService.generateReviewResponse(
          review.reviewerName,
          review.starRating,
          review.reviewComment,
          businessType,
          `${clientId}-batch-${i}`
        );

        if (result.success) {
          if (result.cached) cacheHits++;
          results.push({
            index: i,
            success: true,
            response: result.response,
            category: result.category,
            sentiment: result.sentiment,
            cached: result.cached
          });
        } else {
          errors++;
          results.push({
            index: i,
            success: false,
            error: result.error
          });
        }
      } catch (error: any) {
        errors++;
        results.push({
          index: i,
          success: false,
          error: error.message
        });
      }

      // Add small delay between requests to be respectful to the API
      if (i < reviews.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`✅ Batch processing complete: ${results.length - errors}/${results.length} successful, ${cacheHits} cache hits`);

    res.json({
      success: true,
      results,
      summary: {
        total: reviews.length,
        successful: results.length - errors,
        errors,
        cacheHits,
        cacheHitRate: reviews.length > 0 ? cacheHits / reviews.length : 0
      }
    });

  } catch (error: any) {
    console.error('❌ Error in batch generate:', error);
    
    res.status(500).json({
      success: false,
      error: 'BATCH_ERROR',
      message: 'Failed to process batch request'
    });
  }
});

export default router;
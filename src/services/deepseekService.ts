import crypto from 'crypto';

// Review categorization types
export type ReviewCategory = 'positive' | 'negative' | 'neutral';
export type ReviewSentiment = 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';

// Response cache interface
interface CachedResponse {
  response: string;
  category: ReviewCategory;
  sentiment: ReviewSentiment;
  timestamp: number;
  usageCount: number;
}

// Review analysis interface
interface ReviewAnalysis {
  category: ReviewCategory;
  sentiment: ReviewSentiment;
  rating: number;
  keyThemes: string[];
  cacheKey: string;
}

// Rate limiting interface
interface RateLimitInfo {
  requests: number;
  resetTime: number;
}

export class DeepSeekService {
  private apiKey: string;
  private baseUrl: string = 'https://api.deepseek.com/v1';
  private responseCache: Map<string, CachedResponse> = new Map();
  private rateLimits: Map<string, RateLimitInfo> = new Map();
  
  // Cache configuration
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day (reduced from 7 days)
  private readonly MAX_CACHE_SIZE = 500; // Reduced cache size for more specific caching
  private readonly RATE_LIMIT_REQUESTS = 50; // requests per minute
  private readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  private readonly ENABLE_AGGRESSIVE_CACHING = false; // Disable aggressive caching by default

  // Consistent prompt templates for caching optimization
  private readonly PROMPT_TEMPLATES = {
    system: `You are a professional business review response assistant. You write compassionate, personalized responses that follow these strict guidelines:

RESPONSE RULES:
- Keep responses under 150 words
- Be warm but professional
- Thank the reviewer for their feedback
- Never make promises about future improvements
- Never mention specific staff names (use "team" instead)
- Acknowledge specific points mentioned in the review
- Match the tone to the review sentiment

RESPONSE STRUCTURE:
1. Thank the reviewer (use their name if provided and real)
2. Acknowledge their specific feedback
3. Express appropriate sentiment (appreciation/concern/understanding)
4. Invite future engagement if appropriate

Always write responses that feel genuine and human.`,

    positive: `Write a response to this POSITIVE review:
- Reviewer: {reviewerName}
- Rating: {rating}/5 stars
- Comment: {comment}
- Business Type: {businessType}

Focus on gratitude and encourage future visits.`,

    negative: `Write a response to this NEGATIVE review:
- Reviewer: {reviewerName}
- Rating: {rating}/5 stars  
- Comment: {comment}
- Business Type: {businessType}

Focus on understanding, taking responsibility, and showing commitment to improvement without making specific promises.`,

    neutral: `Write a response to this NEUTRAL review:
- Reviewer: {reviewerName}
- Rating: {rating}/5 stars
- Comment: {comment}
- Business Type: {businessType}

Focus on appreciation for feedback and gentle encouragement for future engagement.`
  };

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY environment variable is required');
    }
    
    // Clean up cache periodically
    setInterval(() => this.cleanupCache(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Analyze review to determine category, sentiment, and generate cache key
   */
  private analyzeReview(
    starRating: string, 
    reviewComment: string, 
    reviewerName: string,
    businessType: string
  ): ReviewAnalysis {
    const rating = this.convertStarRatingToNumber(starRating);
    
    // Determine category based on rating
    let category: ReviewCategory;
    let sentiment: ReviewSentiment;
    
    if (rating >= 4) {
      category = 'positive';
      sentiment = rating === 5 ? 'very_positive' : 'positive';
    } else if (rating <= 2) {
      category = 'negative';
      sentiment = rating === 1 ? 'very_negative' : 'negative';
    } else {
      category = 'neutral';
      sentiment = 'neutral';
    }

    // Extract key themes for better caching
    const keyThemes = this.extractKeyThemes(reviewComment, category);
    
    // Generate cache key based on category, themes, rating, reviewer, and comment
    const cacheKey = this.generateCacheKey(category, rating, keyThemes, businessType, reviewerName, reviewComment);

    return {
      category,
      sentiment,
      rating,
      keyThemes,
      cacheKey
    };
  }

  /**
   * Extract key themes from review comment for better caching
   */
  private extractKeyThemes(comment: string, category: ReviewCategory): string[] {
    if (!comment) return [];
    
    const themes: string[] = [];
    const lowerComment = comment.toLowerCase();
    
    // Common themes by category
    const themeKeywords = {
      positive: [
        'service', 'staff', 'food', 'quality', 'experience', 'recommend',
        'friendly', 'helpful', 'clean', 'fast', 'delicious', 'amazing',
        'excellent', 'great', 'love', 'perfect'
      ],
      negative: [
        'slow', 'rude', 'dirty', 'expensive', 'bad', 'terrible', 'awful',
        'disappointing', 'problem', 'issue', 'complaint', 'wait', 'cold',
        'wrong', 'mistake', 'poor', 'unprofessional'
      ],
      neutral: [
        'okay', 'average', 'fine', 'decent', 'normal', 'standard'
      ]
    };
    
    // Extract themes based on category
    const relevantKeywords = themeKeywords[category] || [];
    for (const keyword of relevantKeywords) {
      if (lowerComment.includes(keyword)) {
        themes.push(keyword);
      }
    }
    
    // Limit themes for consistent caching
    return themes.slice(0, 3);
  }

  /**
   * Generate consistent cache key for similar reviews
   */
  private generateCacheKey(
    category: ReviewCategory,
    rating: number,
    themes: string[],
    businessType: string,
    reviewerName?: string,
    reviewComment?: string
  ): string {
    // Create a more specific cache key that includes reviewer info and comment hash
    const reviewerKey = reviewerName && 
                       reviewerName.trim() && 
                       reviewerName !== 'Anonymous' && 
                       !reviewerName.includes('Google user') 
                       ? reviewerName.toLowerCase().trim() : 'anonymous';
    
    // Create a hash of the review comment to identify similar content
    const commentHash = reviewComment ? 
      crypto.createHash('md5').update(reviewComment.toLowerCase().trim()).digest('hex').substring(0, 8) : 
      'no-comment';
    
    const keyComponents = [
      category,
      rating.toString(),
      themes.sort().join('-'),
      businessType.toLowerCase(),
      reviewerKey,
      commentHash
    ];
    
    const keyString = keyComponents.join('|');
    return crypto.createHash('md5').update(keyString).digest('hex');
  }

  /**
   * Determine if response should be cached based on personalization level
   */
  private shouldCacheResponse(reviewerName: string, reviewComment: string): boolean {
    // Don't cache if reviewer has a real name (personalized response needed)
    const hasRealName = reviewerName && 
                       reviewerName.trim() && 
                       reviewerName !== 'Anonymous' && 
                       !reviewerName.includes('Google user') &&
                       reviewerName.length > 2;
    
    // Don't cache if review has very specific content (>100 characters with specific details)
    const hasSpecificContent = reviewComment && 
                               reviewComment.trim().length > 100 &&
                               (reviewComment.includes('staff') || 
                                reviewComment.includes('manager') ||
                                reviewComment.includes('specific') ||
                                reviewComment.includes('particular'));
    
    // Only cache generic reviews without real names or very specific content
    return !hasRealName && !hasSpecificContent;
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(identifier: string = 'default'): boolean {
    const now = Date.now();
    const rateLimit = this.rateLimits.get(identifier);
    
    if (!rateLimit || now > rateLimit.resetTime) {
      // Reset rate limit window
      this.rateLimits.set(identifier, {
        requests: 1,
        resetTime: now + this.RATE_LIMIT_WINDOW
      });
      return true;
    }
    
    if (rateLimit.requests >= this.RATE_LIMIT_REQUESTS) {
      return false; // Rate limit exceeded
    }
    
    rateLimit.requests++;
    return true;
  }

  /**
   * Get cached response if available
   */
  private getCachedResponse(cacheKey: string): string | null {
    const cached = this.responseCache.get(cacheKey);
    
    if (!cached) return null;
    
    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_DURATION) {
      this.responseCache.delete(cacheKey);
      return null;
    }
    
    // Update usage count
    cached.usageCount++;
    cached.timestamp = now; // Refresh timestamp on use
    
    // Reduced logging for performance
    return cached.response;
  }

  /**
   * Cache response
   */
  private cacheResponse(
    cacheKey: string, 
    response: string, 
    category: ReviewCategory, 
    sentiment: ReviewSentiment
  ): void {
    // Implement LRU-style cleanup if cache is getting too large
    if (this.responseCache.size >= this.MAX_CACHE_SIZE) {
      this.cleanupCache();
    }
    
    this.responseCache.set(cacheKey, {
      response,
      category,
      sentiment,
      timestamp: Date.now(),
      usageCount: 1
    });
    
    // Response cached
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, cached] of this.responseCache.entries()) {
      if (now - cached.timestamp > this.CACHE_DURATION) {
        this.responseCache.delete(key);
        removedCount++;
      }
    }
    
    // If still too large, remove least used entries
    if (this.responseCache.size > this.MAX_CACHE_SIZE * 0.8) {
      const entries = Array.from(this.responseCache.entries())
        .sort(([,a], [,b]) => a.usageCount - b.usageCount);
      
      const toRemove = Math.floor(this.responseCache.size * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.responseCache.delete(entries[i][0]);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} cache entries`);
    }
  }

  /**
   * Convert star rating to number
   */
  private convertStarRatingToNumber(starRating: string): number {
    const ratingMap: { [key: string]: number } = {
      'ONE': 1,
      'TWO': 2,
      'THREE': 3,
      'FOUR': 4,
      'FIVE': 5
    };
    return ratingMap[starRating] || 3;
  }

  /**
   * Generate review response using DeepSeek API
   */
  async generateReviewResponse(
    reviewerName: string,
    starRating: string,
    reviewComment: string,
    businessType: string = 'business',
    clientId?: string
  ): Promise<{
    success: boolean;
    response?: string;
    category?: ReviewCategory;
    sentiment?: ReviewSentiment;
    cached?: boolean;
    error?: string;
    usage?: any;
  }> {
    try {
      // Check rate limiting
      const rateLimitId = clientId || 'default';
      if (!this.checkRateLimit(rateLimitId)) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please try again later.'
        };
      }

      // Analyze the review
      const analysis = this.analyzeReview(starRating, reviewComment, reviewerName, businessType);
      
      // Check cache first (only if aggressive caching is enabled or for generic reviews)
      const shouldUseCache = this.ENABLE_AGGRESSIVE_CACHING || this.shouldCacheResponse(reviewerName, reviewComment);
      
      if (shouldUseCache) {
        const cachedResponse = this.getCachedResponse(analysis.cacheKey);
        if (cachedResponse) {
          console.log(`🎯 Using cached response for similar ${analysis.category} review`);
          return {
            success: true,
            response: cachedResponse,
            category: analysis.category,
            sentiment: analysis.sentiment,
            cached: true
          };
        }
      } else {
        console.log(`🚫 Skipping cache for personalized review from ${reviewerName || 'Anonymous'}`);
      }

      console.log(`🤖 Generating ${analysis.category} review response for rating ${analysis.rating}`);

      // Prepare consistent prompt for DeepSeek caching
      const hasReviewerName = reviewerName && 
                             reviewerName.trim() && 
                             reviewerName !== 'Anonymous' && 
                             !reviewerName.includes('Google user');

      const userPrompt = this.PROMPT_TEMPLATES[analysis.category]
        .replace('{reviewerName}', hasReviewerName ? reviewerName : 'Customer (anonymous)')
        .replace('{rating}', analysis.rating.toString())
        .replace('{comment}', reviewComment || 'No written comment provided')
        .replace('{businessType}', businessType);

      // Call DeepSeek API using OpenAI-compatible format
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: this.PROMPT_TEMPLATES.system
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: 200,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0.1,
          presence_penalty: 0.1,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`DeepSeek API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      const generatedResponse = data.choices?.[0]?.message?.content?.trim();

      if (!generatedResponse) {
        throw new Error('No response generated from DeepSeek');
      }

      // Cache the response only if appropriate
      if (shouldUseCache) {
        this.cacheResponse(analysis.cacheKey, generatedResponse, analysis.category, analysis.sentiment);
        console.log(`💾 Cached response for generic ${analysis.category} review`);
      } else {
        console.log(`🚫 Not caching personalized response for ${reviewerName || 'Anonymous'}`);
      }

      console.log(`✅ Generated ${analysis.category} response (${generatedResponse.length} chars)`);

      return {
        success: true,
        response: generatedResponse,
        category: analysis.category,
        sentiment: analysis.sentiment,
        cached: false,
        usage: data.usage
      };

    } catch (error: any) {
      console.error('❌ DeepSeek API error:', error);
      
      let errorMessage = 'Failed to generate response';
      if (error.message.includes('rate limit')) {
        errorMessage = 'API rate limit exceeded. Please try again later.';
      } else if (error.message.includes('API key')) {
        errorMessage = 'Invalid API key. Please check your DeepSeek configuration.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    cacheHitRate: number;
    categoryCounts: Record<ReviewCategory, number>;
    oldestEntry: number;
    newestEntry: number;
  } {
    const now = Date.now();
    const categoryCounts: Record<ReviewCategory, number> = {
      positive: 0,
      negative: 0,
      neutral: 0
    };
    
    let oldestEntry = now;
    let newestEntry = 0;
    let totalUsage = 0;
    
    for (const cached of this.responseCache.values()) {
      categoryCounts[cached.category]++;
      totalUsage += cached.usageCount;
      oldestEntry = Math.min(oldestEntry, cached.timestamp);
      newestEntry = Math.max(newestEntry, cached.timestamp);
    }
    
    const totalEntries = this.responseCache.size;
    const cacheHitRate = totalEntries > 0 ? (totalUsage - totalEntries) / totalUsage : 0;
    
    return {
      totalEntries,
      cacheHitRate: Math.max(0, cacheHitRate),
      categoryCounts,
      oldestEntry: oldestEntry === now ? 0 : oldestEntry,
      newestEntry
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.responseCache.clear();
    console.log('🗑️ Cache cleared');
  }

  /**
   * Test DeepSeek API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string; model?: string }> {
    try {
      if (!this.checkRateLimit('test')) {
        return {
          success: false,
          message: 'Rate limit exceeded for testing'
        };
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: 'Say "API test successful" if you can read this message.'
            }
          ],
          max_tokens: 10,
          temperature: 0.1
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as any;
        throw new Error(`HTTP ${response.status}: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      const testResponse = data.choices?.[0]?.message?.content?.trim();

      return {
        success: true,
        message: `DeepSeek API connection successful! Response: ${testResponse}`,
        model: data.model
      };

    } catch (error: any) {
      return {
        success: false,
        message: `DeepSeek API test failed: ${error.message}`
      };
    }
  }
}

// Export singleton instance
export const deepseekService = new DeepSeekService();
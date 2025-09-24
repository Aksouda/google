import { google } from 'googleapis';

// Retry and caching configuration interfaces
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableErrorCodes: number[];
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface RateLimitConfig {
  minDelayBetweenCallsMs: number;
  lastCallTimestamp: number;
}

// TypeScript interfaces for Google My Business API responses
export interface BusinessLocation {
  name: string;
  displayName: string;
  storeCode?: string;
  locationKey?: {
    placeId: string;
    requestId?: string;
  };
  address?: {
    regionCode: string;
    locality: string;
    administrativeArea: string;
    postalCode: string;
    addressLines: string[];
  };
  primaryPhone?: string;
  websiteUri?: string;
  categories?: {
    primaryCategory?: {
      categoryId: string;
      displayName: string;
    };
    additionalCategories?: Array<{
      categoryId: string;
      displayName: string;
    }>;
  };
}

export interface Review {
  name: string;
  reviewId: string;
  reviewer: {
    profilePhotoUrl?: string;
    displayName: string;
    isAnonymous?: boolean;
  };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

export interface LocationsResponse {
  locations: BusinessLocation[];
  nextPageToken?: string;
  totalSize?: number;
}

export interface ReviewsResponse {
  reviews: Review[];
  unansweredReviews: Review[];
  nextPageToken?: string;
  averageRating?: number;
  totalReviewCount?: number;
}

export interface ServiceError {
  message: string;
  code: string;
  status: number;
  details?: any;
}

export class GoogleMyBusinessService {
  private oauth2Client: any;
  private businessInfo: any;
  private accountManagement: any;
  
  // Retry configuration
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000, // Start with 1 second
    maxDelayMs: 8000,  // Max 8 seconds
    retryableErrorCodes: [429, 500, 502, 503, 504] // Rate limit and server errors
  };
  
  // Rate limiting
  private rateLimitConfig: RateLimitConfig = {
    minDelayBetweenCallsMs: 500, // 500ms between calls
    lastCallTimestamp: 0
  };
  
  // Simple in-memory cache
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultCacheTtlMs: number = 5 * 60 * 1000; // 5 minutes

  constructor(accessToken: string) {
    console.log('🔧 GoogleMyBusinessService: Initializing service...');
    
    if (!accessToken) {
      console.error('❌ GoogleMyBusinessService: No access token provided');
      throw new Error('Access token is required');
    }

    // Log access token (first 20 characters only for security)
    const tokenPreview = accessToken.substring(0, 20) + '...';
    console.log(`🔑 GoogleMyBusinessService: Access token provided: ${tokenPreview}`);

    try {
      // Create OAuth2 client with access token
      console.log('🔧 GoogleMyBusinessService: Creating OAuth2 client...');
      this.oauth2Client = new google.auth.OAuth2();
      this.oauth2Client.setCredentials({ access_token: accessToken });
      
      // Verify OAuth2 client setup
      const credentials = this.oauth2Client.credentials;
      console.log('✅ GoogleMyBusinessService: OAuth2 client created successfully');
      console.log(`🔍 GoogleMyBusinessService: Credentials set - has access_token: ${!!credentials.access_token}`);

      // Initialize Google My Business API clients
      console.log('🔧 GoogleMyBusinessService: Initializing Google My Business API clients...');
      
      // Use the legacy Business Information API (this is the working one)
      try {
        this.businessInfo = google.mybusinessbusinessinformation({ 
          version: 'v1', 
          auth: this.oauth2Client 
        });
        console.log('✅ GoogleMyBusinessService: Business Information API client initialized');
      } catch (error: any) {
        console.error('❌ GoogleMyBusinessService: Failed to initialize Business Information API:', error.message);
        throw error;
      }
      
      try {
        this.accountManagement = google.mybusinessaccountmanagement({ 
          version: 'v1', 
          auth: this.oauth2Client 
        });
        console.log('✅ GoogleMyBusinessService: Account Management API client initialized');
      } catch (error: any) {
        console.error('❌ GoogleMyBusinessService: Failed to initialize Account Management API:', error.message);
        throw error;
      }
      
      console.log('🎉 GoogleMyBusinessService: Service initialization complete');
      
    } catch (error: any) {
      console.error('❌ GoogleMyBusinessService: Failed to initialize service:', error);
      console.error('❌ GoogleMyBusinessService: Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack?.substring(0, 200) + '...'
      });
      throw new Error(`Failed to initialize Google My Business service: ${error.message}`);
    }
  }

  /**
   * Sleep for a specified amount of time
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Apply rate limiting - wait if necessary before making API call
   */
  private async applyRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.rateLimitConfig.lastCallTimestamp;
    
    if (timeSinceLastCall < this.rateLimitConfig.minDelayBetweenCallsMs) {
      const waitTime = this.rateLimitConfig.minDelayBetweenCallsMs - timeSinceLastCall;
      console.log(`⏳ Rate limiting: Waiting ${waitTime}ms before next API call`);
      await this.sleep(waitTime);
    }
    
    this.rateLimitConfig.lastCallTimestamp = Date.now();
  }

  /**
   * Get data from cache if available and not expired
   */
  private getCachedData<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      console.log(`🔍 Cache MISS for key: ${key}`);
      return null;
    }
    
    if (Date.now() > entry.expiresAt) {
      console.log(`⏰ Cache EXPIRED for key: ${key}`);
      this.cache.delete(key);
      return null;
    }
    
    console.log(`✅ Cache HIT for key: ${key}`);
    return entry.data;
  }

  /**
   * Store data in cache
   */
  private setCachedData<T>(key: string, data: T, ttlMs?: number): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      expiresAt: now + (ttlMs || this.defaultCacheTtlMs)
    };
    
    this.cache.set(key, entry);
    console.log(`💾 Cached data for key: ${key} (expires in ${(ttlMs || this.defaultCacheTtlMs) / 1000}s)`);
  }

  /**
   * Execute API call with retry logic and exponential backoff
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    cacheKey?: string,
    cacheTtlMs?: number
  ): Promise<T> {
    // Check cache first
    if (cacheKey) {
      const cachedResult = this.getCachedData<T>(cacheKey);
      if (cachedResult) {
        return cachedResult;
      }
    }

    let lastError: any;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        // Apply rate limiting before each attempt
        await this.applyRateLimit();
        
        console.log(`🔄 ${operationName}: Attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}`);
        
        const result = await operation();
        
        // Cache successful result
        if (cacheKey) {
          this.setCachedData(cacheKey, result, cacheTtlMs);
        }
        
        console.log(`✅ ${operationName}: Succeeded on attempt ${attempt + 1}`);
        return result;
        
      } catch (error: any) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);
        const isLastAttempt = attempt === this.retryConfig.maxRetries;
        
        console.error(`❌ ${operationName}: Attempt ${attempt + 1} failed`);
        console.error(`🔍 ${operationName}: Error details:`, {
          status: error.response?.status,
          code: error.code,
          isRetryable,
          isLastAttempt
        });
        
        if (!isRetryable || isLastAttempt) {
          console.error(`🚫 ${operationName}: Not retrying (retryable: ${isRetryable}, lastAttempt: ${isLastAttempt})`);
          break;
        }
        
        // Calculate exponential backoff delay
        const baseDelay = this.retryConfig.baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 0.1 * baseDelay; // Add 10% jitter
        const delay = Math.min(baseDelay + jitter, this.retryConfig.maxDelayMs);
        
        console.log(`⏳ ${operationName}: Retrying in ${Math.round(delay)}ms (exponential backoff)`);
        
        // Special handling for rate limit errors
        if (error.response?.status === 429) {
          console.error(`🚫 Rate limit hit for ${operationName}! Quota details:`, {
            service: error.response?.data?.error?.details?.[0]?.metadata?.service,
            quotaMetric: error.response?.data?.error?.details?.[0]?.metadata?.quota_metric,
            quotaLimit: error.response?.data?.error?.details?.[0]?.metadata?.quota_limit,
            quotaLimitValue: error.response?.data?.error?.details?.[0]?.metadata?.quota_limit_value
          });
        }
        
        await this.sleep(delay);
      }
    }
    
    // All retries exhausted
    console.error(`🚫 ${operationName}: All retries exhausted, throwing error`);
    throw lastError;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    const status = error.response?.status || error.status || error.code;
    const isRetryableStatus = this.retryConfig.retryableErrorCodes.includes(status);
    
    // Additional checks for specific error types
    const isNetworkError = !error.response && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT');
    const isGoogleApiError = error.message?.includes('googleapis.com');
    
    return isRetryableStatus || isNetworkError || (isGoogleApiError && status >= 500);
  }

  /**
   * Clear cache (useful for testing or when data needs refresh)
   */
  public clearCache(): void {
    const cacheSize = this.cache.size;
    this.cache.clear();
    console.log(`🗑️ Cleared cache (${cacheSize} entries removed)`);
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Fetch user's business locations using OAuth2 client
   */
  async fetchBusinessLocations(pageSize: number = 100, pageToken?: string): Promise<LocationsResponse> {
    console.log('🔍 fetchBusinessLocations: Starting to fetch business locations...');
    console.log('🔍 fetchBusinessLocations: Parameters:', { pageSize, pageToken });
    
    const cacheKey = `locations:${pageSize}:${pageToken || 'first_page'}`;
    
    return this.executeWithRetry(
      async () => {
        // First, get the account
        console.log('📡 fetchBusinessLocations: Getting GMB accounts');
        
        let accountsResponse;
        try {
          accountsResponse = await this.accountManagement.accounts.list({
            pageSize: 1
          });
          
          console.log('✅ fetchBusinessLocations: Accounts response received');
          console.log('📊 fetchBusinessLocations: Response status:', accountsResponse.status);
        } catch (accountError: any) {
          console.error('❌ fetchBusinessLocations: Error fetching accounts');
          console.error('❌ fetchBusinessLocations: Account error details:', {
            status: accountError.response?.status,
            statusText: accountError.response?.statusText,
            message: accountError.message,
            code: accountError.code,
            data: accountError.response?.data
          });
          throw new Error(`Failed to fetch GMB accounts: ${accountError.message}`);
        }

        const accounts = accountsResponse.data.accounts;
        console.log(`📊 fetchBusinessLocations: Found ${accounts?.length || 0} accounts`);
        
        if (!accounts || accounts.length === 0) {
          console.error('❌ fetchBusinessLocations: No Google My Business accounts found');
          console.error('❌ fetchBusinessLocations: This could mean:');
          console.error('   - User has no GMB accounts');
          console.error('   - Missing GMB account management permissions');
          console.error('   - API not enabled');
          throw new Error('No Google My Business accounts found');
        }

        const accountName = accounts[0].name;
        console.log(`📍 fetchBusinessLocations: Using account: ${accountName}`);
        console.log(`📍 fetchBusinessLocations: Account details:`, {
          name: accounts[0].name,
          type: accounts[0].type,
          role: accounts[0].role,
          verificationState: accounts[0].verificationState
        });
        
        // Ensure account name is in correct format for API calls
        const normalizedAccountName = accountName.startsWith('accounts/') ? accountName : `accounts/${accountName}`;
        console.log(`📍 fetchBusinessLocations: Normalized account name: ${normalizedAccountName}`);

        // Fetch locations for the account
        console.log('📡 fetchBusinessLocations: Getting business locations');
        console.log(`📡 fetchBusinessLocations: API call parameters:`, {
          parent: normalizedAccountName,
          pageSize,
          pageToken: pageToken || undefined
        });
        
        // Use Business Information API for listing locations
        console.log('🔄 fetchBusinessLocations: Using Business Information API for locations list');
        
        // Debug: Check if API clients are properly initialized
        console.log('🔍 fetchBusinessLocations: API client check:', {
          hasBusinessInfo: !!this.businessInfo,
          hasBusinessInfoAccounts: !!this.businessInfo?.accounts,
          hasBusinessInfoAccountsLocations: !!this.businessInfo?.accounts?.locations,
          hasAccountManagement: !!this.accountManagement,
          hasAccountManagementAccounts: !!this.accountManagement?.accounts,
          hasAccountManagementAccountsLocations: !!this.accountManagement?.accounts?.locations
        });
        
        // Debug: Log the actual API structure
        console.log('🔍 fetchBusinessLocations: Account Management API structure:', {
          accountManagement: !!this.accountManagement,
          accounts: !!this.accountManagement?.accounts,
          locations: !!this.accountManagement?.accounts?.locations,
          list: !!this.accountManagement?.accounts?.locations?.list
        });
        
        console.log('🔍 fetchBusinessLocations: Business Info API structure:', {
          businessInfo: !!this.businessInfo,
          accounts: !!this.businessInfo?.accounts,
          locations: !!this.businessInfo?.accounts?.locations,
          list: !!this.businessInfo?.accounts?.locations?.list
        });
        
        let response;
        try {
          // Try Account Management API first (this is the correct API for listing locations)
          console.log('🔄 fetchBusinessLocations: Trying Account Management API first');
          
          // Check if the API structure exists
          if (!this.accountManagement?.accounts?.locations?.list) {
            console.error('❌ fetchBusinessLocations: Account Management API structure not available');
            throw new Error('Account Management API structure not available');
          }
          
          // Build parameters object, only including defined values
          const accountParams: any = {
            parent: normalizedAccountName,
            pageSize
          };
          if (pageToken) {
            accountParams.pageToken = pageToken;
          }
          
          console.log('🔍 fetchBusinessLocations: Account Management API params:', accountParams);
          response = await this.accountManagement.accounts.locations.list(accountParams);
          console.log('✅ fetchBusinessLocations: Account Management API succeeded');
        } catch (accountApiError: any) {
          console.error('❌ fetchBusinessLocations: Error with Account Management API');
          console.error('❌ fetchBusinessLocations: Account API error details:', {
            status: accountApiError.response?.status,
            message: accountApiError.message,
            data: accountApiError.response?.data
          });
          
          // Try Business Information API as fallback (with required readMask)
          console.log('🔄 fetchBusinessLocations: Retrying with Business Information API (with required readMask)');
          
          // Try different readMask combinations to get location names
          const readMaskOptions = [
            'name,displayName,title,storedName,languageCode,storeCode',
            'name,displayName,title,storedName',
            'name,displayName,title', 
            'name,displayName,storeCode',
            'name,displayName',
            'name,title',
            'name,storeCode',
            'name'
          ];
          
          let businessApiError: any = null;
          let readMaskSuccess = false;
          
          for (const readMask of readMaskOptions) {
            try {
              console.log(`🔄 fetchBusinessLocations: Trying readMask: ${readMask}`);
              const businessParams: any = {
                parent: normalizedAccountName,
                pageSize,
                readMask
              };
              if (pageToken) {
                businessParams.pageToken = pageToken;
              }
              
              console.log('🔍 fetchBusinessLocations: Business Information API params:', businessParams);
              response = await this.businessInfo.accounts.locations.list(businessParams);
              console.log(`✅ fetchBusinessLocations: Business Information API succeeded with readMask: ${readMask}`);
              readMaskSuccess = true;
              break;
            } catch (error: any) {
              businessApiError = error;
              console.log(`❌ fetchBusinessLocations: readMask '${readMask}' failed:`, error.message);
            }
          }
          
          if (!readMaskSuccess) {
            console.error('❌ fetchBusinessLocations: All readMask attempts failed');
            console.error('❌ fetchBusinessLocations: Last Business API error details:', {
              status: businessApiError?.response?.status,
              message: businessApiError?.message,
              data: businessApiError?.response?.data
            });
            
            // Log the full error response for debugging
            if (businessApiError?.response?.data?.error) {
              console.error('🔍 fetchBusinessLocations: Full Google API error:', JSON.stringify(businessApiError.response.data.error, null, 2));
            }
            
            throw new Error(`Failed to fetch locations from both APIs: ${accountApiError.message}`);
          }
        }
        
        console.log('✅ fetchBusinessLocations: Locations response received');
        console.log('📊 fetchBusinessLocations: Response status:', response.status);

        const locations: BusinessLocation[] = response.data.locations || [];
        
        console.log(`✅ fetchBusinessLocations: Found ${locations.length} business locations`);
        console.log('📊 fetchBusinessLocations: Location details:', locations.map((loc, index) => ({
          index,
          name: loc.name,
          displayName: loc.displayName,
          title: (loc as any).title,
          storedName: (loc as any).storedName,
          storeCode: (loc as any).storeCode,
          languageCode: (loc as any).languageCode,
          // Show all available properties
          allKeys: Object.keys(loc)
        })));

        // Enhance locations with better display names
        const enhancedLocations = locations.map(loc => {
          const enhanced = {
            ...loc,
            displayName: loc.displayName || 
                        (loc as any).title || 
                        (loc as any).storedName || 
                        (loc as any).storeCode ||
                        `Location ${loc.name?.split('/').pop() || 'Unknown'}`
          };
          
          console.log(`🔍 Enhanced location: ${enhanced.name} -> displayName: "${enhanced.displayName}"`);
          return enhanced;
        });

        const result = {
          locations: enhancedLocations,
          nextPageToken: response.data.nextPageToken,
          totalSize: response.data.totalSize
        };
        
        console.log('🎉 fetchBusinessLocations: Successfully completed with result:', {
          locationCount: result.locations.length,
          hasNextPage: !!result.nextPageToken,
          totalSize: result.totalSize
        });

        return result;
      },
      'fetchBusinessLocations',
      cacheKey,
      3 * 60 * 1000 // Cache for 3 minutes (locations don't change often)
    );
  }

  /**
   * Fetch detailed location information including address using Business Information API
   */
  async fetchLocationDetails(locationName: string): Promise<BusinessLocation> {
    const cacheKey = `location_details_${locationName}`;
    
    // Check cache first
    const cachedResult = this.getCachedData<BusinessLocation>(cacheKey);
    if (cachedResult) {
      console.log(`📋 fetchLocationDetails: Returning cached details for ${locationName}`);
      return cachedResult;
    }

    try {
      console.log(`🔍 fetchLocationDetails: Using Business Information API to fetch address details for: ${locationName}`);

      // Use Business Information API locations.get with comprehensive address readMask
      const readMaskOptions = [
        'name,displayName,address,storefrontAddress,primaryPhone,websiteUri,categories',
        'name,displayName,address,storefrontAddress',
        'name,displayName,address',
        'name,displayName,storefrontAddress', 
        'name,displayName'
      ];
      
      let locationData: BusinessLocation | null = null;
      let lastError: any = null;

      for (const readMask of readMaskOptions) {
        try {
          console.log(`🔄 fetchLocationDetails: Trying readMask: ${readMask}`);
          const response = await this.businessInfo.locations.get({
            name: locationName,
            readMask: readMask
          });
          locationData = response.data as BusinessLocation;
          console.log(`✅ fetchLocationDetails: Business Information API succeeded with readMask: ${readMask}`);
          break; // Exit loop on first success
        } catch (error: any) {
          lastError = error;
          console.log(`❌ fetchLocationDetails: readMask '${readMask}' failed:`, error.message);
        }
      }

      if (!locationData) {
        throw new Error(`All readMask attempts failed for ${locationName}. Last error: ${lastError?.message}`);
      }

      console.log('✅ fetchLocationDetails: Business Information API call successful');
      console.log('📊 fetchLocationDetails: Response status:', lastError?.response?.status || 200);
      console.log('📍 fetchLocationDetails: Location data:', JSON.stringify(locationData, null, 2));
      console.log('📍 fetchLocationDetails: Available fields:', Object.keys(locationData || {}));
      
      // Cache the result for 5 minutes
      this.setCachedData(cacheKey, locationData, 5 * 60 * 1000);

      return locationData;

    } catch (error: any) {
      console.error('❌ fetchLocationDetails: Business Information API failed:', error);
      console.error('❌ fetchLocationDetails: Error details:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        code: error.code,
        data: error.response?.data
      });

      throw new Error(`Failed to fetch location details: ${error.message}`);
    }
  }

  /**
   * Fetch reviews for a specific location and filter unanswered ones
   */
  async fetchLocationReviews(
    locationName: string, 
    pageSize: number = 50, 
    pageToken?: string
  ): Promise<ReviewsResponse> {
    console.log(`🔍 fetchLocationReviews: Starting to fetch reviews for location: ${locationName}`);
    console.log('🔍 fetchLocationReviews: Parameters:', { locationName, pageSize, pageToken });
    
    const cacheKey = `reviews:${locationName}:${pageSize}:${pageToken || 'first_page'}`;
    
    return this.executeWithRetry(
      async () => {
        console.log('📡 fetchLocationReviews: Getting location reviews');
        
        // Debug: Check API structures for reviews
        console.log('🔍 fetchLocationReviews: API structure check:', {
          accountManagement: {
            exists: !!this.accountManagement,
            hasAccounts: !!this.accountManagement?.accounts,
            hasLocations: !!this.accountManagement?.accounts?.locations,
            hasReviews: !!this.accountManagement?.accounts?.locations?.reviews,
            hasList: !!this.accountManagement?.accounts?.locations?.reviews?.list
          },
          businessInfo: {
            exists: !!this.businessInfo,
            hasAccounts: !!this.businessInfo?.accounts,
            hasLocations: !!this.businessInfo?.accounts?.locations,
            hasReviews: !!this.businessInfo?.accounts?.locations?.reviews,
            hasList: !!this.businessInfo?.accounts?.locations?.reviews?.list
          }
        });

        // Use the googleapis client library to access reviews via the v4.9 API
        let response;
        try {
          console.log('🔄 fetchLocationReviews: Using googleapis client library for reviews');
          
          // Construct the full location name if needed
          let fullLocationName = locationName;
          if (!locationName.includes('accounts/')) {
            // Get the account to construct full location path
            const accountsResponse = await this.accountManagement.accounts.list({ pageSize: 1 });
            const accounts = accountsResponse.data.accounts;
            if (accounts && accounts.length > 0) {
              const accountName = accounts[0].name;
              fullLocationName = `${accountName}/locations/${locationName}`;
              console.log('🔍 fetchLocationReviews: Constructed full location name:', fullLocationName);
            }
          }
          
          console.log('🔍 fetchLocationReviews: Fetching reviews for:', fullLocationName);
          
          // Let's properly implement the Google My Business v4.9 API for reviews
          // This is the correct API that still supports reviews access
          console.log('🔄 fetchLocationReviews: Setting up Google My Business v4.9 API client');
          
          const { google } = require('googleapis');
          console.log('🔍 fetchLocationReviews: Available google APIs:', Object.keys(google).filter(key => key.includes('business')));
          
          // Create the proper My Business v4.9 client
          let mybusinessClient: any;
          try {
            // The v4.9 API is available through a different service name
            if (google.mybusiness) {
              mybusinessClient = google.mybusiness({ version: 'v4', auth: this.oauth2Client });
              console.log('✅ fetchLocationReviews: Created mybusiness v4 client');
            } else {
              // If mybusiness is not available, let's try to install it
              console.log('🔍 fetchLocationReviews: mybusiness not found, checking available services...');
              
              // Check if we can access it through a different method
              const availableServices = Object.keys(google).filter(key => 
                key.toLowerCase().includes('business') || 
                key.toLowerCase().includes('mybusiness')
              );
              console.log('🔍 fetchLocationReviews: Available business services:', availableServices);
              
              // Try to use the generic google client with custom discovery
              const discoveryUrl = 'https://mybusiness.googleapis.com/$discovery/rest?version=v4';
              console.log('🔍 fetchLocationReviews: Attempting to use discovery URL:', discoveryUrl);
              
              mybusinessClient = await google.discoverAPI(discoveryUrl);
              console.log('✅ fetchLocationReviews: Created client via discovery API');
            }
          } catch (clientError: any) {
            console.error('❌ fetchLocationReviews: Failed to create mybusiness client:', clientError.message);
            
            // Fall back to direct HTTP with proper authentication
            console.log('🔄 fetchLocationReviews: Falling back to direct HTTP approach');
            mybusinessClient = null;
          }
          
          // Make the API call using the best available method
          console.log('🔄 fetchLocationReviews: Making reviews API call');
          
          let reviewsResponse;
          
          if (mybusinessClient && mybusinessClient.accounts && mybusinessClient.accounts.locations && mybusinessClient.accounts.locations.reviews) {
            console.log('✅ fetchLocationReviews: Using googleapis mybusiness client');
            try {
              reviewsResponse = await mybusinessClient.accounts.locations.reviews.list({
                parent: fullLocationName,
                pageSize: pageSize || 50,
                pageToken: pageToken || undefined,
                orderBy: 'updateTime desc'
              });
              console.log('✅ fetchLocationReviews: googleapis client call successful');
            } catch (clientError: any) {
              console.error('❌ fetchLocationReviews: googleapis client failed:', clientError.message);
              mybusinessClient = null; // Force fallback to HTTP
            }
          }
          
          // If googleapis client failed or wasn't available, use direct HTTP
          if (!mybusinessClient) {
            console.log('🔄 fetchLocationReviews: Using direct HTTP call to Google My Business API v4.9');
            const axios = require('axios');
            const accessToken = this.oauth2Client.credentials.access_token;
            
            if (!accessToken) {
              throw new Error('No access token available. Please ensure you are properly authenticated.');
            }
            
            console.log('🔍 fetchLocationReviews: Access token available:', !!accessToken);
            console.log('🔍 fetchLocationReviews: Token type:', typeof accessToken);
            
            // Construct the proper API URL
            const reviewsUrl = `https://mybusiness.googleapis.com/v4/${fullLocationName}/reviews`;
            console.log('🔍 fetchLocationReviews: Making request to:', reviewsUrl);
            
            const requestConfig = {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              },
              params: {
                pageSize: pageSize || 50,
                ...(pageToken && { pageToken }),
                orderBy: 'updateTime desc'
              }
            };
            
            console.log('🔍 fetchLocationReviews: Request config:', {
              url: reviewsUrl,
              headers: { ...requestConfig.headers, Authorization: '[REDACTED]' },
              params: requestConfig.params
            });
            
            const axiosResponse = await axios.get(reviewsUrl, requestConfig);
            
            reviewsResponse = {
              data: axiosResponse.data,
              status: axiosResponse.status
            };
            console.log('✅ fetchLocationReviews: Direct HTTP call successful');
          }
          
          console.log('✅ fetchLocationReviews: Reviews response received');
          console.log('📊 fetchLocationReviews: Response status:', reviewsResponse.status);
          
          response = { 
            data: reviewsResponse.data, 
            status: reviewsResponse.status 
          };
          
        } catch (apiError: any) {
          console.error('❌ fetchLocationReviews: API call failed');
          console.error('❌ fetchLocationReviews: Error details:', {
            message: apiError.message,
            status: apiError.response?.status,
            statusText: apiError.response?.statusText,
            data: apiError.response?.data,
            url: apiError.config?.url
          });
          
          // Log the full error for debugging
          if (apiError.response?.data?.error) {
            console.error('🔍 fetchLocationReviews: Full API error:', JSON.stringify(apiError.response.data.error, null, 2));
          }
          
          // Handle different error scenarios
          if (apiError.response?.status === 403) {
            console.error('🚫 fetchLocationReviews: 403 Forbidden - API Access Restricted');
            console.error('   Google has significantly restricted programmatic access to reviews');
            console.error('   This is a known limitation with the current Google Business Profile APIs');
            
            // Provide helpful information to the user
            throw new Error('Google has restricted programmatic access to reviews through their APIs. To view and manage reviews, please use the Google Business Profile dashboard at https://business.google.com or the Google Business mobile app.');
          } else if (apiError.response?.status === 404) {
            console.error('🚫 fetchLocationReviews: 404 Not Found - Location or endpoint not found');
            throw new Error('Reviews endpoint not found for this location. The location may not have reviews enabled or the API endpoint has changed.');
          } else if (apiError.response?.status === 400) {
            console.error('🚫 fetchLocationReviews: 400 Bad Request - Invalid request format');
            throw new Error('Invalid request format for reviews API. This may indicate the API structure has changed.');
          }
          
          throw new Error(`Failed to fetch reviews: ${apiError.message}`);
        }

        console.log('✅ fetchLocationReviews: Reviews response received');
        console.log('📊 fetchLocationReviews: Response status:', response.status);
        
        // Debug: Log the response structure
        console.log('🔍 fetchLocationReviews: Response data structure:', {
          hasData: !!response.data,
          hasReviews: !!response.data?.reviews,
          dataKeys: response.data ? Object.keys(response.data) : null,
          reviewsType: typeof response.data?.reviews,
          reviewsLength: response.data?.reviews?.length
        });

        const allReviews: Review[] = response.data.reviews || [];
        console.log(`📊 fetchLocationReviews: Found ${allReviews.length} total reviews`);
        
        // Filter unanswered reviews (reviews without reviewReply field or empty reply)
        console.log('🔍 fetchLocationReviews: Filtering unanswered reviews...');
        const unansweredReviews = allReviews.filter(review => {
          const hasReply = review.reviewReply && review.reviewReply.comment;
          console.log(`📊 fetchLocationReviews: Review ${review.reviewId}: hasReply=${!!hasReply}`);
          return !hasReply;
        });

        console.log(`✅ fetchLocationReviews: Found ${allReviews.length} total reviews, ${unansweredReviews.length} unanswered`);
        console.log('📊 fetchLocationReviews: Review ratings distribution:', {
          total: allReviews.length,
          unanswered: unansweredReviews.length,
          averageRating: response.data.averageRating,
          totalReviewCount: response.data.totalReviewCount
        });

        const result = {
          reviews: allReviews,
          unansweredReviews,
          nextPageToken: response.data.nextPageToken,
          averageRating: response.data.averageRating,
          totalReviewCount: response.data.totalReviewCount
        };
        
        console.log('🎉 fetchLocationReviews: Successfully completed with result:', {
          totalReviews: result.reviews.length,
          unansweredReviews: result.unansweredReviews.length,
          hasNextPage: !!result.nextPageToken,
          averageRating: result.averageRating
        });

        return result;
      },
      'fetchLocationReviews',
      cacheKey,
      2 * 60 * 1000 // Cache for 2 minutes (reviews change more frequently)
    );
  }

  /**
   * Get only unanswered reviews for a specific location
   */
  async fetchUnansweredReviews(
    locationName: string, 
    pageSize: number = 50, 
    pageToken?: string
  ): Promise<Review[]> {
    try {
      const reviewsResponse = await this.fetchLocationReviews(locationName, pageSize, pageToken);
      return reviewsResponse.unansweredReviews;
    } catch (error: any) {
      console.error('❌ Error fetching unanswered reviews:', error.message);
      throw this.handleApiError(error, 'Failed to fetch unanswered reviews');
    }
  }

  /**
   * Reply to a review
   */
  async replyToReview(reviewName: string, replyComment: string): Promise<{ success: boolean; message: string }> {
    console.log(`💬 Starting to reply to review: ${reviewName}`);
    console.log(`💬 Reply comment length: ${replyComment.length} characters`);
    console.log(`💬 Review name format: ${reviewName}`);

    return this.executeWithRetry(
      async () => {
        console.log('📡 replyToReview: Posting review reply');

        // Use the same approach as fetchLocationReviews - try googleapis client first, then HTTP
        let replyResult: boolean | null = null;
        
        // First, try to create the proper My Business v4.9 client
        const { google } = require('googleapis');
        let mybusinessClient: any = null;
        
        try {
          if (google.mybusiness) {
            mybusinessClient = google.mybusiness({ version: 'v4', auth: this.oauth2Client });
            console.log('✅ replyToReview: Created mybusiness v4 client');
          } else {
            console.log('🔍 replyToReview: mybusiness not available, trying discovery API');
            const discoveryUrl = 'https://mybusiness.googleapis.com/$discovery/rest?version=v4';
            mybusinessClient = await google.discoverAPI(discoveryUrl);
            console.log('✅ replyToReview: Created client via discovery API');
          }
        } catch (clientError: any) {
          console.error('❌ replyToReview: Failed to create mybusiness client:', clientError.message);
          mybusinessClient = null;
        }

        // Try using the googleapis client first
        if (mybusinessClient && mybusinessClient.accounts && mybusinessClient.accounts.locations && mybusinessClient.accounts.locations.reviews) {
          console.log('✅ replyToReview: Using googleapis mybusiness client');
          try {
            await mybusinessClient.accounts.locations.reviews.updateReply({
              name: reviewName,
              requestBody: {
                comment: replyComment
              }
            });
            console.log('✅ replyToReview: googleapis client reply successful');
            replyResult = true;
          } catch (clientError: any) {
            console.error('❌ replyToReview: googleapis client failed:', clientError.message);
            mybusinessClient = null; // Force fallback to HTTP
          }
        }

        // If googleapis client failed or wasn't available, use direct HTTP
        if (!replyResult) {
          console.log('🔄 replyToReview: Using direct HTTP call to Google My Business API v4.9');
          const axios = require('axios');
          const accessToken = this.oauth2Client.credentials.access_token;
          
          if (!accessToken) {
            throw new Error('No access token available for reply posting');
          }

          // Construct the proper API URL for updating review reply
          const replyUrl = `https://mybusiness.googleapis.com/v4/${reviewName}/reply`;
          console.log('🔍 replyToReview: Making request to:', replyUrl);
          
          const requestConfig = {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          };
          
          const requestBody = {
            comment: replyComment
          };
          
          console.log('🔍 replyToReview: Request config:', {
            url: replyUrl,
            headers: { ...requestConfig.headers, Authorization: '[REDACTED]' },
            body: requestBody
          });
          
          await axios.put(replyUrl, requestBody, requestConfig);
          console.log('✅ replyToReview: Direct HTTP call successful');
        }

        console.log('✅ replyToReview: Review reply posted successfully');

        return {
          success: true,
          message: 'Review reply posted successfully'
        };
      },
      'replyToReview',
      undefined, // Don't cache replies - they should be immediate
      undefined
    );
  }

  /**
   * Verify the access token is valid by making a test API call
   */
  async verifyAccess(): Promise<boolean> {
    console.log('🔍 verifyAccess: Starting access token verification...');
    
    // Check OAuth2 client credentials first
    const credentials = this.oauth2Client.credentials;
    console.log('🔍 verifyAccess: OAuth2 client credentials check:', {
      hasAccessToken: !!credentials.access_token,
      hasRefreshToken: !!credentials.refresh_token,
      tokenType: credentials.token_type,
      expiryDate: credentials.expiry_date
    });
    
    try {
      await this.executeWithRetry(
        async () => {
          console.log('📡 verifyAccess: Testing API access');
          
          // Make a simple API call to verify token
          const response = await this.accountManagement.accounts.list({
            pageSize: 1
          });
          
          console.log('✅ verifyAccess: API test successful');
          console.log('📊 verifyAccess: Response status:', response.status);
          console.log('📊 verifyAccess: Found accounts:', response.data.accounts?.length || 0);

          return response;
        },
        'verifyAccess',
        'verify_access_test', // Cache key for verification
        30 * 1000 // Cache for 30 seconds only
      );

      console.log('✅ verifyAccess: Access token is valid and working');
      return true;

    } catch (error: any) {
      console.error('❌ verifyAccess: Access verification failed after retries');
      console.error('❌ verifyAccess: Final error:', error.message);
      
      // Check if it's a specific API permission issue
      if (error.response?.status === 403) {
        console.error('❌ verifyAccess: PERMISSION DENIED - This usually means:');
        console.error('   1. Google My Business API is not enabled');
        console.error('   2. User does not have GMB account access');
        console.error('   3. OAuth scopes are insufficient');
        console.error('   4. Account management permissions missing');
      }
      
      return false;
    }
  }

  /**
   * Handle API errors and convert them to ServiceError format
   */
  private handleApiError(error: any, defaultMessage: string): ServiceError {
    console.error('🔍 handleApiError: Processing API error...');
    console.error('🔍 handleApiError: Default message:', defaultMessage);
    console.error('🔍 handleApiError: Error analysis:', {
      errorType: error.constructor.name,
      hasResponse: !!error.response,
      hasResponseData: !!error.response?.data,
      hasResponseDataError: !!error.response?.data?.error,
      httpStatus: error.response?.status,
      errorMessage: error.message,
      errorCode: error.code
    });

    const serviceError: ServiceError = {
      message: defaultMessage,
      code: 'UNKNOWN_ERROR',
      status: 500,
      details: error.message
    };

    // Handle Google API specific errors
    if (error.response?.data?.error) {
      console.log('🔍 handleApiError: Found Google API error in response.data.error');
      const apiError = error.response.data.error;
      console.error('🔍 handleApiError: Google API error details:', {
        message: apiError.message,
        code: apiError.code,
        status: apiError.status,
        details: apiError.details,
        errors: apiError.errors
      });
      
      serviceError.message = apiError.message || defaultMessage;
      serviceError.code = apiError.code || 'API_ERROR';
      serviceError.status = error.response.status || 500;
      serviceError.details = apiError;
      
      // Analyze specific Google API error messages
      if (apiError.message?.includes('API has not been used') || apiError.message?.includes('is disabled')) {
        console.error('🔍 handleApiError: DETECTED - API not enabled error');
        console.error('🔍 handleApiError: This is a Google Cloud Console API enablement issue');
        serviceError.code = 'API_NOT_ENABLED';
      } else if (apiError.message?.includes('permission') || apiError.message?.includes('access')) {
        console.error('🔍 handleApiError: DETECTED - Permission/access error');
        serviceError.code = 'PERMISSION_DENIED';
      }
      
    } else if (error.message) {
      console.log('🔍 handleApiError: Using generic error message');
      serviceError.message = `${defaultMessage}: ${error.message}`;
    }

    // Handle specific HTTP status codes with detailed analysis
    if (error.response?.status === 401) {
      console.error('🔍 handleApiError: HTTP 401 - Authentication Error');
      serviceError.message = 'Authentication failed. Please log in again.';
      serviceError.code = 'AUTHENTICATION_ERROR';
      serviceError.status = 401;
    } else if (error.response?.status === 403) {
      console.error('🔍 handleApiError: HTTP 403 - Permission Denied');
      console.error('🔍 handleApiError: 403 Error Analysis:');
      console.error('   - Could be API not enabled in Google Cloud Console');
      console.error('   - Could be insufficient OAuth scopes');
      console.error('   - Could be user lacks GMB account access');
      console.error('   - Could be trying to access non-existent resources');
      
      // Keep original message if it's more specific, otherwise use generic
      if (!serviceError.message.includes('API has not been used')) {
        serviceError.message = 'Access denied. Please ensure you have Google My Business permissions.';
      }
      serviceError.code = 'PERMISSION_DENIED';
      serviceError.status = 403;
    } else if (error.response?.status === 404) {
      console.error('🔍 handleApiError: HTTP 404 - Not Found');
      serviceError.message = 'Resource not found. The location or review may not exist.';
      serviceError.code = 'NOT_FOUND';
      serviceError.status = 404;
    } else if (error.response?.status === 429) {
      console.error('🔍 handleApiError: HTTP 429 - Rate Limited');
      serviceError.message = 'API rate limit exceeded. Please try again later.';
      serviceError.code = 'RATE_LIMIT_EXCEEDED';
      serviceError.status = 429;
    }

    console.error('🔍 handleApiError: Final service error:', {
      message: serviceError.message,
      code: serviceError.code,
      status: serviceError.status,
      hasDetails: !!serviceError.details
    });

    return serviceError;
  }
}

/**
 * Create a new GoogleMyBusinessService instance with user's access token
 */
export function createGMBService(accessToken: string): GoogleMyBusinessService {
  console.log('🔧 createGMBService: Creating new GoogleMyBusinessService instance...');
  
  if (!accessToken) {
    console.error('❌ createGMBService: No access token provided');
    throw new Error('Access token is required to create Google My Business service');
  }
  
  const tokenPreview = accessToken.substring(0, 20) + '...';
  console.log(`🔑 createGMBService: Using access token: ${tokenPreview}`);
  
  try {
    const service = new GoogleMyBusinessService(accessToken);
    console.log('✅ createGMBService: GoogleMyBusinessService instance created successfully');
    return service;
  } catch (error: any) {
    console.error('❌ createGMBService: Failed to create service instance:', error.message);
    throw error;
  }
}

/**
 * Extract access token from user session/profile
 */
export function getAccessTokenFromUser(user: any): string | null {
  console.log('🔍 getAccessTokenFromUser: Extracting access token from user object...');
  
  if (!user) {
    console.error('❌ getAccessTokenFromUser: No user object provided');
    return null;
  }

  console.log('🔍 getAccessTokenFromUser: User object structure:', {
    hasAccessToken: !!user.accessToken,
    hasJsonAccessToken: !!user._json?.accessToken,
    hasTokenAccessToken: !!user.token?.accessToken,
    userKeys: Object.keys(user),
    jsonKeys: user._json ? Object.keys(user._json) : null,
    tokenKeys: user.token ? Object.keys(user.token) : null
  });

  // Try different possible locations for the access token
  const accessToken = user.accessToken || 
                     user._json?.accessToken || 
                     user.token?.accessToken || 
                     null;

  if (accessToken) {
    const tokenPreview = accessToken.substring(0, 20) + '...';
    console.log(`✅ getAccessTokenFromUser: Found access token: ${tokenPreview}`);
  } else {
    console.error('❌ getAccessTokenFromUser: No access token found in user object');
    console.error('❌ getAccessTokenFromUser: Available user properties:', Object.keys(user));
  }

  return accessToken;
}

export default GoogleMyBusinessService;
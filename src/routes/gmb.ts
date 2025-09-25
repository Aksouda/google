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
 * POST /api/gmb/locations/resolve-addresses - Enrich a list of locations with addresses using Google Places API
 * Does NOT modify or touch any reviews APIs. Safe to use alongside existing mechanisms.
 */
router.post('/locations/resolve-addresses', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locations } = req.body || {};
    if (!Array.isArray(locations)) {
      return res.status(400).json({ success: false, error: 'INVALID_INPUT', message: 'locations array required' });
    }

    if (!process.env.GOOGLE_MAPS_API_KEY) {
      return res.status(500).json({ success: false, error: 'MISSING_API_KEY', message: 'GOOGLE_MAPS_API_KEY is not configured' });
    }

    const https = require('https');
    const gmbService: any = (req as any).gmbService;
    const accessToken = getAccessTokenFromUser((req as any).user);

    function fetchJson(url: string): Promise<any> {
      return new Promise((resolve, reject) => {
        https
          .get(url, (resp: any) => {
            let data = '';
            resp.on('data', (chunk: any) => (data += chunk));
            resp.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          })
          .on('error', reject);
      });
    }

    // Prefetch all GBP accounts from GMB v4 to enable exact ID→Place mapping per account
    let accountNames: string[] = [];
    if (accessToken) {
      try {
        const accountsList: any = await new Promise((resolve, reject) => {
          const url = new URL('https://mybusiness.googleapis.com/v4/accounts');
          const options: any = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` }
          };
          const r = https.request(options, (resp: any) => {
            let data = '';
            resp.on('data', (chunk: any) => (data += chunk));
            resp.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
          });
          r.on('error', reject);
          r.end();
        });
        accountNames = Array.isArray(accountsList?.accounts)
          ? accountsList.accounts.map((a: any) => a.name).filter(Boolean)
          : [];
      } catch {}
    }

    // Build a global map of v4 locationId -> { placeId, storefrontAddress, primaryPhone, websiteUrl }
    const v4LocationById: Map<string, any> = new Map();
    if (accessToken && accountNames.length > 0) {
      for (const acct of accountNames) {
        try {
          let pageToken: string | undefined = undefined;
          do {
            const baseUrl = new URL(`https://mybusiness.googleapis.com/v4/${acct}/locations`);
            baseUrl.searchParams.set('pageSize', '100');
            baseUrl.searchParams.set('fieldMask', 'name,locationKey,storefrontAddress,primaryPhone,websiteUrl');
            if (pageToken) baseUrl.searchParams.set('pageToken', pageToken);

            const listResp: any = await new Promise((resolve, reject) => {
              const options: any = {
                hostname: baseUrl.hostname,
                path: baseUrl.pathname + baseUrl.search,
                method: 'GET',
                headers: { Authorization: `Bearer ${accessToken}` }
              };
              const r = https.request(options, (resp: any) => {
                let data = '';
                resp.on('data', (chunk: any) => (data += chunk));
                resp.on('end', () => {
                  try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
              });
              r.on('error', reject);
              r.end();
            });

            const items = Array.isArray(listResp?.locations) ? listResp.locations : [];
            for (const item of items) {
              // item.name looks like 'accounts/{accountId}/locations/{locationId}'
              const id = (typeof item?.name === 'string') ? item.name.split('/').pop() : undefined;
              if (!id) continue;
              v4LocationById.set(id, {
                placeId: item?.locationKey?.placeId,
                storefrontAddress: item?.storefrontAddress,
                primaryPhone: item?.primaryPhone,
                websiteUrl: item?.websiteUrl
              });
            }

            pageToken = listResp?.nextPageToken;
          } while (pageToken);
        } catch {}
      }
    }

    // Also build a BI map: locationId -> { placeId, address, primaryPhone, websiteUri }
    const biLocationById: Map<string, any> = new Map();
    if (accessToken && accountNames.length > 0) {
      for (const acct of accountNames) {
        try {
          let pageToken: string | undefined = undefined;
          do {
            const baseUrl = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${acct}/locations`);
            baseUrl.searchParams.set('pageSize', '100');
            baseUrl.searchParams.set('readMask', 'locationKey,address,primaryPhone,websiteUri');
            if (pageToken) baseUrl.searchParams.set('pageToken', pageToken);

            const listResp: any = await new Promise((resolve, reject) => {
              const options: any = {
                hostname: baseUrl.hostname,
                path: baseUrl.pathname + baseUrl.search,
                method: 'GET',
                headers: { Authorization: `Bearer ${accessToken}` }
              };
              const r = https.request(options, (resp: any) => {
                let data = '';
                resp.on('data', (chunk: any) => (data += chunk));
                resp.on('end', () => {
                  try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                });
              });
              r.on('error', reject);
              r.end();
            });

            const items = Array.isArray(listResp?.locations) ? listResp.locations : [];
            for (const item of items) {
              // item.name may be 'locations/{id}' or 'accounts/{account}/locations/{id}'
              const rawName: string = typeof item?.name === 'string' ? item.name : '';
              const id = rawName.split('/').pop();
              if (!id) continue;
              biLocationById.set(id, {
                placeId: item?.locationKey?.placeId,
                address: item?.address,
                storefrontAddress: item?.storefrontAddress,
                primaryPhone: item?.primaryPhone,
                websiteUri: item?.websiteUri
              });
            }

            pageToken = listResp?.nextPageToken;
          } while (pageToken);
        } catch {}
      }
    }

    // Detect ambiguous names (same-name profiles) to avoid name-only fallbacks that collapse to one address
    const nameCounts = new Map<string, number>();
    for (const loc of locations) {
      const nm = (loc?.displayName || loc?.title || loc?.name || '').toString().trim();
      if (!nm) continue;
      nameCounts.set(nm, (nameCounts.get(nm) || 0) + 1);
    }

    // Limit concurrency to avoid rate limits
    const concurrency = 3;
    let index = 0;
    const results: any[] = new Array(locations.length);

    async function worker() {
      while (index < locations.length) {
        const current = index++;
        const loc = locations[current] || {};
        const name: string = loc.displayName || loc.title || loc.name || '';
        const locationId: string | undefined = (loc.name && typeof loc.name === 'string') ? (loc.name as string).split('/').pop() : undefined;

        try {
          if (!name) {
            results[current] = { ...loc, addressInfo: 'Address not available' };
            continue;
          }

          // 1) If incoming location already has a placeId, use it directly for deterministic match
          let placeId: string | undefined = loc?.locationKey?.placeId;
          let placeIdSource: string | undefined = placeId ? 'input' : undefined;
          let primaryPhone: string | undefined;
          let websiteUri: string | undefined;

          // 2) If no placeId, fetch BI details by exact location id to disambiguate identical names
          if (!placeId && gmbService && locationId) {
            try {
              const fullName = `locations/${locationId}`;
              // Try service method first
              const details = await gmbService.fetchLocationDetails(fullName);
              placeId = details?.locationKey?.placeId || placeId;
              if (placeId && placeIdSource !== 'input') placeIdSource = 'bi.service';
              // Some installs use phoneNumbers, some primaryPhone
              primaryPhone = (details as any)?.primaryPhone || (details as any)?.phoneNumbers?.primaryPhone;
              websiteUri = (details as any)?.websiteUri || (details as any)?.websiteUrl;
            } catch (e) {
              // Non-fatal
            }
          }

          // 2b) If still no placeId, use BI preload map by exact id
          if (!placeId && locationId && biLocationById.size > 0) {
            const bi = biLocationById.get(locationId);
              if (bi) {
              placeId = bi.placeId || placeId;
              if (placeId && placeIdSource !== 'input') placeIdSource = 'bi.preload';
              primaryPhone = primaryPhone || bi.primaryPhone;
              websiteUri = websiteUri || bi.websiteUri;
              // Prefer storefrontAddress over postal address when present
              if ((Array.isArray(bi.storefrontAddress?.addressLines) && bi.storefrontAddress.addressLines.length) || bi.address?.formattedAddress || (Array.isArray(bi.address?.addressLines) && bi.address.addressLines.length)) {
                const formatted = (Array.isArray(bi.storefrontAddress?.addressLines) && bi.storefrontAddress.addressLines.length)
                  ? bi.storefrontAddress.addressLines.join(', ')
                  : (bi.address?.formattedAddress || (Array.isArray(bi.address?.addressLines) ? bi.address.addressLines.join(', ') : undefined));
                results[current] = {
                  ...loc,
                  addressInfo: formatted,
                  hasPhysicalAddress: true,
                  places: placeId ? { placeId, formattedAddress: formatted } : undefined,
                  source: 'bi.preload'
                };
                continue;
              }
            }
          }

          // 2c) If still no placeId, call Business Information API directly via HTTP with proper readMask
          if (!placeId && accessToken && locationId) {
            try {
              const url = `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${encodeURIComponent(locationId)}?readMask=storefrontAddress`;
              const biResp: any = await new Promise((resolve, reject) => {
                const reqOpts = new URL(url);
                const options: any = {
                  hostname: reqOpts.hostname,
                  path: reqOpts.pathname + reqOpts.search,
                  method: 'GET',
                  headers: {
                    Authorization: `Bearer ${accessToken}`
                  }
                };
                const r = https.request(options, (resp: any) => {
                  let data = '';
                  resp.on('data', (chunk: any) => (data += chunk));
                  resp.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                  });
                });
                r.on('error', reject);
                r.end();
              });

              if (biResp) {
                try {
                  console.log('🔎 BI direct response (locations/' + locationId + '): keys=', Object.keys(biResp || {}));
                  if (biResp.address || biResp.storefrontAddress || biResp.locationKey) {
                    console.log('🔎 BI direct snippet:', JSON.stringify({
                      locationId,
                      locationKey: biResp.locationKey,
                      hasStorefront: !!biResp.storefrontAddress,
                      storefrontAddress: biResp.storefrontAddress,
                      hasAddress: !!biResp.address,
                      address: biResp.address
                    }));
                  } else {
                    console.log('🔎 BI direct raw:', JSON.stringify(biResp));
                  }
                } catch {}
                // Only focusing on storefrontAddress; ignore other fields to avoid mask errors
                // If BI already returned a structured address, prefer it (storefrontAddress or address)
                const storefront = biResp?.storefrontAddress;
                if (storefront && Array.isArray(storefront.addressLines) && storefront.addressLines.length) {
                  const parts: string[] = [];
                  parts.push(...storefront.addressLines.filter(Boolean));
                  if (storefront.locality) parts.push(storefront.locality);
                  if (storefront.administrativeArea) parts.push(storefront.administrativeArea);
                  if (storefront.postalCode) parts.push(storefront.postalCode);
                  if (storefront.regionCode) parts.push(storefront.regionCode);
                  const formatted = parts.filter(Boolean).join(', ');
                  if (formatted) {
                    results[current] = {
                      ...loc,
                      addressInfo: formatted,
                      hasPhysicalAddress: true,
                      places: placeId ? { placeId, formattedAddress: formatted } : undefined
                    };
                    continue;
                  }
                }
              }
            } catch (e) {
              // ignore
            }
          }

          // 2c-bis) Try BI accounts/{accountId}/locations/{locationId} to ensure account scoping, prefer storefrontAddress
          if (!placeId && accessToken && locationId && accountNames.length > 0) {
            for (const acct of accountNames) {
              try {
                const urlScoped = `https://mybusinessbusinessinformation.googleapis.com/v1/${encodeURIComponent(acct)}/locations/${encodeURIComponent(locationId)}?readMask=storefrontAddress`;
                const scopedResp: any = await new Promise((resolve, reject) => {
                  const reqUrl = new URL(urlScoped);
                  const options: any = {
                    hostname: reqUrl.hostname,
                    path: reqUrl.pathname + reqUrl.search,
                    method: 'GET',
                    headers: { Authorization: `Bearer ${accessToken}` }
                  };
                  const r = https.request(options, (resp: any) => {
                    let data = '';
                    resp.on('data', (chunk: any) => (data += chunk));
                    resp.on('end', () => {
                      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
                    });
                  });
                  r.on('error', reject);
                  r.end();
                });
                if (scopedResp) {
                  try {
                    console.log('🔎 BI accounts.get response (' + acct + '/locations/' + locationId + '): keys=', Object.keys(scopedResp || {}));
                    if (scopedResp.address || scopedResp.storefrontAddress || scopedResp.locationKey) {
                      console.log('🔎 BI accounts.get snippet:', JSON.stringify({
                        account: acct,
                        locationId,
                        locationKey: scopedResp.locationKey,
                        hasStorefront: !!scopedResp.storefrontAddress,
                        storefrontAddress: scopedResp.storefrontAddress,
                        hasAddress: !!scopedResp.address,
                        address: scopedResp.address
                      }));
                    } else {
                      console.log('🔎 BI accounts.get raw:', JSON.stringify(scopedResp));
                    }
                  } catch {}
                  // Only focusing on storefrontAddress; ignore other fields to avoid mask errors
                  const sf = scopedResp?.storefrontAddress;
                  // Format storefrontAddress like the reference snippet
                  const formatPostal = (addr: any): string | undefined => {
                    if (!addr) return undefined;
                    const parts: string[] = [];
                    if (Array.isArray(addr.addressLines)) parts.push(...addr.addressLines.filter(Boolean));
                    if (addr.locality) parts.push(addr.locality);
                    if (addr.administrativeArea) parts.push(addr.administrativeArea);
                    if (addr.postalCode) parts.push(addr.postalCode);
                    if (addr.regionCode) parts.push(addr.regionCode);
                    const joined = parts.filter(Boolean).join(', ');
                    return joined || undefined;
                  };
                  const formattedScoped = formatPostal(sf);
                  if (formattedScoped) {
                    results[current] = {
                      ...loc,
                      addressInfo: formattedScoped,
                      hasPhysicalAddress: true,
                      places: placeId ? { placeId, formattedAddress: formattedScoped } : undefined,
                      source: 'bi.accounts.get'
                    };
                    break;
                  }
                }
              } catch {}
            }
            if (results[current]) continue;
          }

          // 2d) If still no placeId, use the preloaded v4 map for exact ID mapping
          if (!placeId && locationId && v4LocationById.size > 0) {
            const v4 = v4LocationById.get(locationId);
            if (v4) {
              placeId = v4.placeId || placeId;
              if (placeId && placeIdSource !== 'input') placeIdSource = 'v4.preload';
              primaryPhone = primaryPhone || v4.primaryPhone;
              websiteUri = websiteUri || v4.websiteUrl;
              if (v4.storefrontAddress?.addressLines) {
                const formatted = Array.isArray(v4.storefrontAddress.addressLines)
                  ? v4.storefrontAddress.addressLines.join(', ')
                  : undefined;
                if (formatted) {
                  results[current] = {
                    ...loc,
                    addressInfo: formatted,
                    hasPhysicalAddress: true,
                    places: placeId ? { placeId, formattedAddress: formatted } : undefined
                  };
                  continue;
                }
              }
            }
          }

          // 3) If we have placeId, call Places Details for the authoritative formatted address
          // Only trust placeId if it originated from BI/v4 for this exact id (prevents cross-match)
          const sourceTag: string = typeof placeIdSource === 'string' ? placeIdSource : '';
          const trustedPlaceId = !!placeId && (['bi.service','bi.preload','bi.direct','v4.preload'] as string[]).includes(sourceTag);
          if (trustedPlaceId) {
            const pid = placeId as string;
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pid)}&fields=formatted_address&key=${process.env.GOOGLE_MAPS_API_KEY}`;
            const detailsResp = await fetchJson(detailsUrl);
            if (detailsResp?.status === 'OK' && detailsResp?.result?.formatted_address) {
              const formatted = detailsResp.result.formatted_address;
              results[current] = {
                ...loc,
                addressInfo: formatted,
                hasPhysicalAddress: true,
                places: { placeId, formattedAddress: formatted },
                source: 'places.details.byPlaceId'
              };
              continue;
            }
          }

          // 4) Remove phone-based fallback for strict ID matching to prevent cross-profile matches

          // 5) Try Text Search with additional discriminators (website domain, storeCode, id appended)
          const extraTokens: string[] = [];
          if (websiteUri) {
            try {
              const u = new URL(websiteUri);
              extraTokens.push(u.hostname);
            } catch {}
          }
          if (loc.storeCode) extraTokens.push(String(loc.storeCode));
          if (locationId) extraTokens.push(String(locationId));

          const isAmbiguous = name && nameCounts.get(name) && (nameCounts.get(name) as number) > 1;

          // Strict ID-only: do not use any name-based fallbacks for ambiguous names.
          // If we reached here, we could not resolve a trusted address for this exact locationId.
          results[current] = { ...loc, addressInfo: 'Address not available', source: isAmbiguous ? 'ambiguous_name_no_fallback' : 'id_strict_unresolved' };
        } catch (err: any) {
          console.warn('⚠️ resolve-addresses: Error enriching location', name, err?.message);
          results[current] = { ...loc, addressInfo: 'Address not available', source: 'error' };
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, locations.length) }, () => worker());
    await Promise.all(workers);

    res.json({ success: true, data: { locations: results }, message: 'Addresses resolved via Google Places' });
  } catch (error: any) {
    console.error('❌ GMB API Error resolving addresses:', error);
    res.status(500).json({ success: false, error: 'RESOLVE_ADDRESSES_ERROR', message: error?.message || 'Failed to resolve addresses' });
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
 * POST /api/gmb/locations/enrich-addresses - Enrich existing locations with address data
 */
router.post('/locations/enrich-addresses', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locations } = req.body;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log('🏠 GMB API: Enriching locations with address data');
    console.log(`🏠 GMB API: Processing ${locations?.length || 0} locations`);

    if (!locations || !Array.isArray(locations)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'Locations array is required'
      });
    }

    // Enrich each location with detailed address information
    const enrichedLocations = await Promise.all(
      locations.map(async (location: any) => {
        try {
          const locationId = location.name ? location.name.split('/').pop() : null;
          if (!locationId) {
            console.warn(`🏠 Location skipped - no ID: ${location.displayName}`);
            return { ...location, addressInfo: 'Location ID unavailable' };
          }

          console.log(`🏠 Fetching address for: ${location.displayName} (ID: ${locationId})`);
          
          // Get detailed location data including address
          const locationDetails = await gmbService.fetchLocationDetails(location.name);
          
          if (locationDetails.address) {
            const addressParts = [];
            
            // Format address from Business Information API structure
            if (locationDetails.address.addressLines?.length > 0) {
              addressParts.push(...locationDetails.address.addressLines);
            }
            
            if (locationDetails.address.locality) {
              addressParts.push(locationDetails.address.locality);
            }
            
            if (locationDetails.address.administrativeArea) {
              addressParts.push(locationDetails.address.administrativeArea);
            }
            
            if (locationDetails.address.postalCode) {
              addressParts.push(locationDetails.address.postalCode);
            }
            
            const formattedAddress = addressParts.length > 0 
              ? addressParts.join(', ')
              : 'Address available but incomplete';
              
            console.log(`✅ Address found for ${location.displayName}: ${formattedAddress}`);
            
            return {
              ...location,
              ...locationDetails,
              addressInfo: formattedAddress,
              fullAddress: locationDetails.address
            };
          } else {
            console.warn(`🏠 No address found for: ${location.displayName}`);
            return {
              ...location,
              ...locationDetails,
              addressInfo: 'Address not available'
            };
          }
        } catch (error: any) {
          console.error(`❌ Error enriching location ${location.displayName}:`, error.message);
          return {
            ...location,
            addressInfo: 'Error fetching address'
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        locations: enrichedLocations,
        totalLocations: enrichedLocations.length,
        addressesFound: enrichedLocations.filter(loc => loc.fullAddress).length
      },
      message: `Enriched ${enrichedLocations.length} locations with address data`
    });

  } catch (error: any) {
    console.error('❌ GMB API Error enriching addresses:', error);
    const serviceError = error as ServiceError;
    
    res.status(serviceError.status || 500).json({
      success: false,
      error: serviceError.code || 'ENRICH_ADDRESSES_ERROR',
      message: serviceError.message || 'Failed to enrich locations with addresses'
    });
  }
});

/**
 * GET /api/gmb/debug/location/:locationId - Debug location data fetching
 */
router.get('/debug/location/:locationId', requireGoogleAuth, attachGMBService, async (req: express.Request, res: express.Response) => {
  try {
    const { locationId } = req.params;
    const gmbService: GoogleMyBusinessService = (req as any).gmbService;

    console.log(`🐛 GMB DEBUG: Starting debug for location: ${locationId}`);

    // Get the account info first
    const accountsResponse = await (gmbService as any).accountManagement.accounts.list({ pageSize: 1 });
    const accounts = accountsResponse.data.accounts;
    const accountName = accounts?.[0]?.name;
    
    // Build full location name
    const fullLocationName = locationId.startsWith('accounts/') 
      ? locationId 
      : `${accountName}/locations/${locationId}`;

    console.log(`🐛 GMB DEBUG: Full location name: ${fullLocationName}`);

    // Try different APIs and log everything
    const debugResults = {
      accountName,
      fullLocationName,
      businessInfoResults: [] as any[],
      v4Results: null as any,
      locationsListResult: null as any
    };

    // Test Business Information API with different readMasks
    const readMasks = [
      '*',
      'name,displayName,address,primaryPhone,websiteUri,categories',
      'name,displayName,address',
      'name,displayName,storefrontAddress',
      'name,displayName,profile,address',
      'name,displayName'
    ];

    for (const readMask of readMasks) {
      try {
        console.log(`🐛 GMB DEBUG: Testing readMask: ${readMask}`);
        const response = await (gmbService as any).businessInfo.locations.get({
          name: fullLocationName,
          readMask: readMask
        });
        
        debugResults.businessInfoResults.push({
          readMask,
          success: true,
          keys: Object.keys(response.data || {}),
          hasAddress: !!(response.data?.address),
          hasStorefrontAddress: !!(response.data?.storefrontAddress),
          data: response.data
        });
        
        console.log(`✅ GMB DEBUG: readMask "${readMask}" succeeded`);
        console.log(`📍 GMB DEBUG: Response keys:`, Object.keys(response.data || {}));
        console.log(`📍 GMB DEBUG: Full response:`, JSON.stringify(response.data, null, 2));
        
      } catch (error: any) {
        debugResults.businessInfoResults.push({
          readMask,
          success: false,
          error: error.message
        });
        console.log(`❌ GMB DEBUG: readMask "${readMask}" failed:`, error.message);
      }
    }

    // Test v4.9 API
    try {
      const { google } = require('googleapis');
      const mybusiness = google.mybusiness({ version: 'v4', auth: (gmbService as any).oauth2Client });
      const v4Response = await mybusiness.accounts.locations.get({ name: fullLocationName });
      debugResults.v4Results = {
        success: true,
        keys: Object.keys(v4Response.data || {}),
        data: v4Response.data
      };
      console.log(`✅ GMB DEBUG: v4.9 API succeeded`);
      console.log(`📍 GMB DEBUG: v4.9 Response:`, JSON.stringify(v4Response.data, null, 2));
    } catch (v4Error: any) {
      debugResults.v4Results = {
        success: false,
        error: v4Error.message
      };
      console.log(`❌ GMB DEBUG: v4.9 API failed:`, v4Error.message);
    }

    // Test locations list approach
    try {
      const locationsResponse = await gmbService.fetchBusinessLocations(100);
      const matchingLocation = locationsResponse.locations.find(loc => 
        loc.name === fullLocationName || 
        loc.name.endsWith(locationId) ||
        loc.name.includes(locationId)
      );
      debugResults.locationsListResult = {
        success: true,
        found: !!matchingLocation,
        keys: matchingLocation ? Object.keys(matchingLocation) : [],
        data: matchingLocation
      };
      console.log(`✅ GMB DEBUG: Locations list search completed, found:`, !!matchingLocation);
      if (matchingLocation) {
        console.log(`📍 GMB DEBUG: Matching location:`, JSON.stringify(matchingLocation, null, 2));
      }
    } catch (listError: any) {
      debugResults.locationsListResult = {
        success: false,
        error: listError.message
      };
      console.log(`❌ GMB DEBUG: Locations list failed:`, listError.message);
    }

    res.json({
      success: true,
      data: debugResults,
      message: 'Debug information collected'
    });

  } catch (error: any) {
    console.error('❌ GMB DEBUG API Error:', error);
    res.status(500).json({
      success: false,
      error: 'DEBUG_ERROR',
      message: error.message,
      details: error
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
// Dashboard JavaScript - External File
// All event handlers and functions for the Google Reviews Manager Dashboard

// ============================
// STATE MANAGEMENT & CACHING
// ============================

// Application State
const AppState = {
    // Loading flags
    userLoaded: false,
    locationsLoaded: false,
    gmbStatusLoaded: false,
    cacheStatsLoaded: false,
    
    // Loading states
    isLoadingUser: false,
    isLoadingLocations: false,
    isLoadingReviews: false,
    isLoadingGMBStatus: false,
    isLoadingCacheStats: false,
    
    // Cached data
    userData: null,
    locationsData: null,
    reviewsData: {},  // keyed by locationId
    gmbStatusData: null,
    cacheStatsData: null,
    
    // UI state
    currentTab: 'overview',
    currentLocation: null,
    currentLocationId: null,
    currentFilter: null,
    currentReviewsFilter: true, // unanswered only
    reviewsPagination: {},
    bypassCacheUntil: null,
    
    // Overview state
    overviewSelectedLocation: null,
    overviewSelectedLocationName: null,
    
    // Methods
    clearCache() {
        console.log('🗑️ Clearing AppState cache...');
        this.userLoaded = false;
        this.locationsLoaded = false;
        this.gmbStatusLoaded = false;
        this.cacheStatsLoaded = false;
        
        this.userData = null;
        this.locationsData = null;
        this.reviewsData = {};
        this.gmbStatusData = null;
        this.cacheStatsData = null;
        
        this.currentLocation = null;
        this.currentLocationId = null;
        this.currentFilter = null;
        this.reviewsPagination = {};
        this.bypassCacheUntil = null;
        
        this.overviewSelectedLocation = null;
        this.overviewSelectedLocationName = null;
    },
    
    setLoading(type, isLoading) {
        this[`isLoading${type}`] = isLoading;
        this.updateLoadingUI(type, isLoading);
    },
    
    updateLoadingUI(type, isLoading) {
        // Update UI elements based on loading state
        const loadingClass = 'loading';
        const disabledClass = 'disabled';
        
        switch(type) {
            case 'User':
                const userElements = document.querySelectorAll('#user-name, #user-email');
                userElements.forEach(el => {
                    if (isLoading) {
                        el.classList.add(loadingClass);
                    } else {
                        el.classList.remove(loadingClass);
                    }
                });
                break;
                
            case 'Locations':
                const locationSelect = document.getElementById('location-select');
                if (locationSelect) {
                    locationSelect.disabled = isLoading;
                    if (isLoading) {
                        locationSelect.classList.add(loadingClass);
                    } else {
                        locationSelect.classList.remove(loadingClass);
                    }
                }
                
                const loadReviewsBtns = document.querySelectorAll('[data-action="load-reviews"]');
                loadReviewsBtns.forEach(btn => {
                    btn.disabled = isLoading;
                    if (isLoading) {
                        btn.classList.add(disabledClass);
                    } else {
                        btn.classList.remove(disabledClass);
                    }
                });
                break;
                
            case 'Reviews':
                const reviewsBtns = document.querySelectorAll('[data-action="load-reviews"]');
                reviewsBtns.forEach(btn => {
                    btn.disabled = isLoading;
                    if (isLoading) {
                        btn.innerHTML = btn.innerHTML.replace('Load Reviews', 'Loading...');
                        btn.classList.add(disabledClass);
                    } else {
                        btn.innerHTML = btn.innerHTML.replace('Loading...', 'Load Reviews');
                        btn.classList.remove(disabledClass);
                    }
                });
                break;
        }
    }
};

// DOM Content Loaded Event Listener
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Dashboard initializing...');
    
    // Set up event listeners for buttons
    setupEventListeners();
    
    // Smart initialization - load only essential data first
    loadUserInfo();
    
    // Check if we should auto-navigate to reviews tab (from auth success page)
    if (window.location.hash === '#reviews') {
        setTimeout(() => {
            showTab('reviews');
            // Remove the hash from URL
            history.replaceState(null, null, window.location.pathname + window.location.search);
        }, 100);
    }
    
    // Load OpenAI status on page load
    loadOpenAIStatus();
    
    // Load locations only after user is loaded (will be handled by loadUserInfo)
    // Other data will be loaded when tabs are clicked
    
    console.log('✅ Dashboard initialized');
});

// Window focus event listener - recheck authentication
window.addEventListener('focus', function() {
    setTimeout(loadUserInfo, 500);
});

// Setup all event listeners for buttons and elements
function setupEventListeners() {
    // Prevent duplicate event listener setup
    if (window.eventListenersSetup) {
        return;
    }
    window.eventListenersSetup = true;
    
    // Logout button
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Tab buttons
    const tabButtons = document.querySelectorAll('.tab');
    tabButtons.forEach(button => {
        button.addEventListener('click', function(event) {
            const tabName = this.textContent.toLowerCase();
            showTab(tabName, event);
        });
    });
    
    // Reviews section buttons
    const loadReviewsButtons = document.querySelectorAll('[data-action="load-reviews"]');
    loadReviewsButtons.forEach(button => {
        button.addEventListener('click', loadReviews);
    });
    
    // GMB service buttons
    const testGMBBtn = document.querySelector('[data-action="test-gmb"]');
    if (testGMBBtn) testGMBBtn.addEventListener('click', testGMBService);
    
    const checkStatusBtn = document.querySelector('[data-action="check-status"]');
    if (checkStatusBtn) checkStatusBtn.addEventListener('click', checkGMBStatus);
    
    const debugLocationsBtn = document.querySelector('[data-action="debug-locations"]');
    if (debugLocationsBtn) debugLocationsBtn.addEventListener('click', debugLocations);
    
    // Refresh page button (in help section)
    const refreshBtn = document.querySelector('[data-action="refresh-page"]');
    if (refreshBtn) refreshBtn.addEventListener('click', () => window.location.reload());
    
    // Cache management buttons
    const getCacheStatsBtn = document.querySelector('[data-action="get-cache-stats"]');
    if (getCacheStatsBtn) getCacheStatsBtn.addEventListener('click', getCacheStats);
    
    const clearCacheBtn = document.querySelector('[data-action="clear-cache"]');
    if (clearCacheBtn) clearCacheBtn.addEventListener('click', clearCache);
    
    // Show all reviews button
    const showAllBtn = document.querySelector('[data-action="show-all-reviews"]');
    if (showAllBtn) {
        showAllBtn.addEventListener('click', function() {
            document.getElementById('unanswered-only').checked = false;
            loadReviews();
        });
    }
    
    // Review reply actions (using event delegation for dynamic content)
    document.addEventListener('click', function(e) {
        const target = e.target;
        const action = target.getAttribute('data-action');
        
        if (action === 'generate-response') {
            const reviewId = target.getAttribute('data-review-id');
            const starRating = target.getAttribute('data-star-rating');
            const reviewComment = target.getAttribute('data-review-comment');
            generateResponse(reviewId, starRating, reviewComment, target);
        }
        else if (action === 'toggle-manual-reply') {
            const reviewId = target.getAttribute('data-review-id');
            toggleManualReply(reviewId);
        }
        else if (action === 'post-reply') {
            const reviewName = target.getAttribute('data-review-name');
            const textareaId = target.getAttribute('data-textarea-id');
            postReply(reviewName, textareaId, target);
        }
        else if (action === 'edit-reply') {
            const reviewId = target.getAttribute('data-review-id');
            const reviewName = target.getAttribute('data-review-name');
            const currentReply = target.getAttribute('data-current-reply');
            editReply(reviewId, reviewName, currentReply);
        }
        else if (action === 'cancel-edit-reply') {
            const reviewId = target.getAttribute('data-review-id');
            cancelEditReply(reviewId);
        }
        else if (action === 'update-reply') {
            const reviewName = target.getAttribute('data-review-name');
            const textareaId = target.getAttribute('data-textarea-id');
            updateReply(reviewName, textareaId, target);
        }
        else if (action === 'test-openai') {
            testOpenAI();
        }
        else if (action === 'save-openai') {
            saveOpenAIKey();
        }
        else if (action === 'generate-ai-response') {
            const reviewId = target.getAttribute('data-review-id');
            const starRating = target.getAttribute('data-star-rating');
            const reviewComment = target.getAttribute('data-review-comment');
            const reviewerName = target.getAttribute('data-reviewer-name');
            generateAIResponse(reviewId, starRating, reviewComment, reviewerName, target);
        }
        else if (action === 'load-more-reviews') {
            loadMoreReviews();
        }
        else if (action === 'load-locations-overview') {
            loadLocationsOverview();
        }
        else if (action === 'refresh-overview') {
            refreshOverviewStats();
        }
        else if (action === 'go-to-reviews') {
            goToReviewsTab();
        }
        else if (action === 'refresh-reviews') {
            refreshReviews();
        }
        else if (action === 'check-reply-history') {
            checkReplyHistory();
        }
        else if (action === 'clear-reply-history') {
            clearReplyHistory();
        }
    });
    
    // Back to locations button
    const backToLocationsBtn = document.getElementById('back-to-locations');
    if (backToLocationsBtn) {
        backToLocationsBtn.addEventListener('click', backToLocationSelection);
    }
    
    // Overview statistics buttons
    const loadStatsBtn = document.getElementById('load-location-stats');
    if (loadStatsBtn) {
        loadStatsBtn.addEventListener('click', loadLocationStatistics);
    }
    
    const goToReviewsBtn = document.getElementById('go-to-reviews-from-overview');
    if (goToReviewsBtn) {
        goToReviewsBtn.addEventListener('click', goToReviewsFromOverview);
    }
    
    // Cache management
    document.querySelectorAll('[data-action="get-cache-stats"]').forEach(button => {
        button.addEventListener('click', getCacheStats);
    });
    
    document.querySelectorAll('[data-action="clear-cache"]').forEach(button => {
        button.addEventListener('click', clearCache);
    });
    
    // Pagination cache management
    document.querySelectorAll('[data-action="clear-pagination-cache"]').forEach(button => {
        button.addEventListener('click', () => {
            const locationId = AppState.currentLocationId;
            if (locationId) {
                clearPaginationCache(locationId);
                showToast('Pagination cache cleared for current location', 'success');
            } else {
                showToast('No location selected. Please select a location first.', 'warning');
            }
        });
    });
    
    document.querySelectorAll('[data-action="clear-all-pagination-cache"]').forEach(button => {
        button.addEventListener('click', () => {
            clearPaginationCache();
            showToast('All pagination cache cleared', 'success');
        });
    });
    
    // Debug pagination
    document.querySelectorAll('[data-action="debug-pagination"]').forEach(button => {
        button.addEventListener('click', debugPagination);
    });
}

// Overview Management Functions
// fetchOverviewStats function removed since we no longer need review statistics

function updateOverviewStats() {
    console.log('📊 Updating overview statistics...');
    
    // Update account information
    if (AppState.userData && AppState.userData.user) {
        const user = AppState.userData.user;
        document.getElementById('user-name-display').textContent = user.displayName || 'Unknown';
        document.getElementById('user-email-display').textContent = user.emails?.[0]?.value || 'No email';
        document.getElementById('auth-status').textContent = '✅ Authenticated';
        document.getElementById('auth-status').style.color = '#28a745';
    } else {
        document.getElementById('user-name-display').textContent = 'Not loaded';
        document.getElementById('user-email-display').textContent = 'Not loaded';
        document.getElementById('auth-status').textContent = '❌ Not authenticated';
        document.getElementById('auth-status').style.color = '#dc3545';
    }
    
    // Update overview location selector
    updateOverviewLocationSelector();
}

function updateOverviewStatsFromCache() {
    console.log('📊 Using cached data for overview statistics...');
    // This function is no longer needed since we removed the review statistics
    // Keeping it for potential future use
}

async function refreshOverviewStats() {
    console.log('🔄 Refreshing overview statistics...');
    
    updateOverviewStats();
}

async function loadLocationsOverview() {
    console.log('📍 Loading locations for overview...');
    
    if (!AppState.locationsLoaded) {
        await loadBusinessLocations();
    }
    
    updateOverviewStats();
}

function goToReviewsTab() {
    showTab('reviews');
}

// New function to update overview location selector
function updateOverviewLocationSelector() {
    const select = document.getElementById('overview-location-select');
    
    if (!select) return; // Element not found (might be on different tab)
    
    if (AppState.locationsData && AppState.locationsData.locations) {
        const locations = AppState.locationsData.locations;
        
        // Clear existing options except the first one
        select.innerHTML = '<option value="">Select a location to view statistics...</option>';
        
        locations.forEach(location => {
            const option = document.createElement('option');
            option.value = location.name;
            option.textContent = location.displayName || location.name;
            select.appendChild(option);
        });
        
        console.log(`📍 Updated overview location selector with ${locations.length} locations`);
    } else {
        select.innerHTML = '<option value="">Loading locations...</option>';
    }
}

// Function to load location statistics
async function loadLocationStatistics() {
    const select = document.getElementById('overview-location-select');
    const statsSection = document.getElementById('review-stats-section');
    const locationNameSpan = document.getElementById('selected-location-overview');
    
    const selectedLocation = select.value;
    if (!selectedLocation) {
        alert('Please select a location first');
        return;
    }
    
    const locationDisplayName = select.options[select.selectedIndex].textContent;
    locationNameSpan.textContent = locationDisplayName;
    
    // Show loading state
    document.getElementById('responded-count').textContent = 'Loading...';
    document.getElementById('unresponded-count').textContent = 'Loading...';
    document.getElementById('average-rating').textContent = 'Loading...';
    statsSection.style.display = 'block';
    
    try {
        const locationId = selectedLocation.split('/').pop();
        
        // Fetch all reviews to calculate statistics
        const response = await fetch(`/api/reviews/location/${locationId}`);
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                const reviewData = data.data;
                
                // Calculate statistics
                const totalReviews = reviewData.reviews ? reviewData.reviews.length : 0;
                const unansweredReviews = reviewData.unansweredReviews ? reviewData.unansweredReviews.length : 0;
                const respondedReviews = totalReviews - unansweredReviews;
                const averageRating = reviewData.averageRating || 0;
                
                // Update UI
                document.getElementById('responded-count').textContent = respondedReviews;
                document.getElementById('unresponded-count').textContent = unansweredReviews;
                document.getElementById('average-rating').textContent = averageRating > 0 ? averageRating.toFixed(1) : 'N/A';
                
                // Store current location for "Manage Reviews" button
                AppState.overviewSelectedLocation = selectedLocation;
                AppState.overviewSelectedLocationName = locationDisplayName;
                
                console.log(`📊 Loaded statistics for ${locationDisplayName}: ${respondedReviews} responded, ${unansweredReviews} unresponded, ${averageRating} avg rating`);
            } else {
                throw new Error(data.message || 'Failed to load reviews');
            }
        } else {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('❌ Error loading location statistics:', error);
        document.getElementById('responded-count').textContent = 'Error';
        document.getElementById('unresponded-count').textContent = 'Error';
        document.getElementById('average-rating').textContent = 'Error';
        alert('Failed to load location statistics: ' + error.message);
    }
}

// Function to navigate to reviews tab from overview
function goToReviewsFromOverview() {
    if (!AppState.overviewSelectedLocation) {
        alert('Please select a location and load statistics first');
        return;
    }
    
    // Switch to reviews tab
    showTab('reviews');
    
    // Set the selected location in reviews tab
    setTimeout(() => {
        const reviewsLocationSelect = document.getElementById('location-select');
        if (reviewsLocationSelect) {
            reviewsLocationSelect.value = AppState.overviewSelectedLocation;
            AppState.currentLocation = AppState.overviewSelectedLocation;
            AppState.currentLocationId = AppState.overviewSelectedLocation.split('/').pop();
            
            // Auto-load reviews
            loadReviews();
        }
    }, 100);
}

// User Authentication Functions
function loadUserInfo() {
    // Check if already loaded or loading
    if (AppState.userLoaded && AppState.userData) {
        console.log('✅ User info already loaded, using cache');
        updateUserInfoUI(AppState.userData);
        return;
    }
    
    if (AppState.isLoadingUser) {
        console.log('⏳ User info already loading, skipping duplicate call');
        return;
    }
    
    console.log('🔍 Loading user info...');
    AppState.setLoading('User', true);
    
    // Show loading state
    document.getElementById('user-name').textContent = 'Loading...';
    document.getElementById('user-email').textContent = '';
    
    fetch('/auth/profile')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.user && data.user.displayName) {
                // Cache the user data
                AppState.userData = data;
                AppState.userLoaded = true;
                
                // Update UI
                updateUserInfoUI(data);
                
                console.log('✅ User loaded and cached:', data.user.displayName);
                
                // Auto-load locations if we're on the reviews tab or if locations haven't been loaded yet
                if ((AppState.currentTab === 'reviews' || !AppState.locationsLoaded) && !AppState.isLoadingLocations) {
                    console.log('👆 Auto-loading locations after user login...');
                    setTimeout(() => loadBusinessLocations(), 100);
                }
                
                // Update overview stats
                updateOverviewStats();
            } else {
                // User not authenticated or missing data
                console.warn('⚠️ User not authenticated, redirecting to home');
                AppState.clearCache(); // Clear any stale cache
                window.location.href = '/?message=login_required';
            }
        })
        .catch(error => {
            console.error('❌ Error loading user info:', error);
            AppState.clearCache(); // Clear cache on error
            
            // Handle different error types with better user experience
            if (error.message.includes('401') || error.message.includes('403')) {
                console.warn('⚠️ Authentication expired, redirecting to login');
                handleAuthFailure('Authentication expired. Please log in again.');
            } else if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
                console.warn('⚠️ Network error, redirecting to login');
                handleAuthFailure('Connection error. Please check your internet and try logging in again.');
            } else {
                console.warn('⚠️ Server error, redirecting to home');
                handleAuthFailure('Server error occurred. Please try logging in again.');
            }
        })
        .finally(() => {
            AppState.setLoading('User', false);
        });
}

/**
 * Handle authentication failures with user-friendly messaging and redirect
 */
function handleAuthFailure(message) {
    console.log(`🔄 Handling auth failure: ${message}`);
    
    // Show user-friendly message in the main content area
    const mainContent = document.querySelector('.tab-content.active') || document.querySelector('.tab-content');
    if (mainContent) {
        mainContent.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #dc3545;">
                <div style="font-size: 48px; margin-bottom: 20px;">🔒</div>
                <h3 style="color: #dc3545; margin-bottom: 15px;">Authentication Required</h3>
                <p style="margin-bottom: 20px; max-width: 400px; margin-left: auto; margin-right: auto;">${message}</p>
                <p style="color: #666; font-size: 0.9rem; margin-bottom: 20px;">You will be redirected to the login page...</p>
                <div style="display: inline-block; width: 30px; height: 30px; border: 3px solid #f3f3f3; border-top: 3px solid #dc3545; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 20px;"></div>
                <div>
                    <button onclick="window.location.href='/login.html'" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 1rem;">
                        Go to Login Now
                    </button>
                </div>
            </div>
        `;
    }
    
    // Clear any cached data
    AppState.clearCache();
    
    // Redirect after showing the message
    setTimeout(() => {
        window.location.href = '/login.html';
    }, 3000);
}

function updateUserInfoUI(userData) {
    // Check if elements exist before setting textContent
    const userNameElement = document.getElementById('user-name');
    const userEmailElement = document.getElementById('user-email');
    const userNameDisplayElement = document.getElementById('user-name-display');
    
    if (userNameElement) {
        userNameElement.textContent = userData.user.displayName || 'User';
    }
    
    if (userEmailElement) {
        userEmailElement.textContent = userData.user.emails?.[0]?.value || 'No email available';
    }
    
    if (userNameDisplayElement) {
        userNameDisplayElement.textContent = userData.user.displayName || 'User';
    }
    
    // Update auth manager with Google user info
    if (window.authManager) {
        window.authManager.googleUser = userData.user;
        window.authManager.isGoogleAuthenticated = true;
        window.authManager.updateAuthUI();
    }
}

function logout() {
    // Clear cache before logging out
    AppState.clearCache();
    console.log('🔄 Cache cleared on logout');
    window.location.href = '/auth/logout';
}

// Tab Management Functions
function showTab(tabName, event = null) {
    // Update app state
    AppState.currentTab = tabName;
    
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab').forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    
    // Set active class on the clicked tab button (if event provided)
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // If no event, find and activate the corresponding tab button by text content
        const tabButtons = document.querySelectorAll('.tab');
        tabButtons.forEach(button => {
            if (button.textContent.toLowerCase() === tabName.toLowerCase()) {
                button.classList.add('active');
            }
        });
    }
    
    // Smart loading based on tab
    console.log(`📊 Switching to ${tabName} tab`);
    
    switch(tabName) {
        case 'overview':
            // Update overview stats when switching to overview tab
            updateOverviewStats();
            break;
            
        case 'reviews':
            // Load locations if not already loaded
            if (!AppState.locationsLoaded && !AppState.isLoadingLocations) {
                console.log('📍 Reviews tab: Loading locations...');
                loadBusinessLocations();
            } else if (AppState.locationsLoaded) {
                console.log('📍 Reviews tab: Using cached locations');
            }
            break;
            
        case 'settings':
            // Load GMB status and cache stats if not already loaded
            if (!AppState.gmbStatusLoaded && !AppState.isLoadingGMBStatus) {
                console.log('⚙️ Settings tab: Loading GMB status...');
                setTimeout(() => checkGMBStatus(), 500);
            }
            
            if (!AppState.cacheStatsLoaded && !AppState.isLoadingCacheStats) {
                console.log('⚙️ Settings tab: Loading cache stats...');
                setTimeout(() => getCacheStats(), 1000);
            }
            break;
    }
}

// Business Locations Functions
function loadBusinessLocations() {
    // Check if already loaded or loading
    if (AppState.locationsLoaded && AppState.locationsData) {
        console.log('✅ Locations already loaded, using cache');
        updateLocationsUI(AppState.locationsData);
        return;
    }
    
    if (AppState.isLoadingLocations) {
        console.log('⏳ Locations already loading, skipping duplicate call');
        return;
    }
    
    // Check if user info is loaded first
    if (!AppState.userLoaded || !AppState.userData) {
        console.warn('⚠️ User not loaded yet, cannot load locations');
        return;
    }
    
    console.log('🔍 Loading business locations...');
    AppState.setLoading('Locations', true);
    
    const select = document.getElementById('location-select');
    
    // Show loading state
    select.innerHTML = '<option value="">Loading locations...</option>';
    select.disabled = true;

    fetch('/api/reviews/locations')
        .then(response => {
            console.log('🔍 Location API Response Status:', response.status);
            if (!response.ok) {
                console.error('❌ Location API Response not OK:', response.status, response.statusText);
            }
            return response.json();
        })
        .then(data => {
            console.log('🔍 Location API Response Data:', data);
            if (data.success) {
                // Cache the basic locations data first
                AppState.locationsData = data.data;
                AppState.locationsLoaded = true;
                
                // Update UI with basic location data
                updateLocationsUI(data.data);
                
                // Update overview stats with new location data
                updateOverviewStats();
                
                console.log(`✅ Locations loaded and cached: ${data.data.locations.length} locations`);
                
                // Now enrich with address data via separate API call (non-blocking)
                enrichLocationsWithAddresses(data.data.locations);
            } else {
                // Check if this is a session expiration error
                if (isAuthenticationError(data)) {
                    handleSessionExpired();
                    return;
                }
                
                console.error('❌ Location API returned error:', data.message || data.error);
                showError(`Failed to load locations: ${data.message || data.error}`);
                select.innerHTML = '<option value="">Error loading locations</option>';
            }
        })
        .catch(error => {
            console.error('❌ Error loading locations:', error);
            
            // Handle authentication errors with better UX
            if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                console.log('🔒 Authentication expired in locations load');
                handleAuthFailure('Authentication expired. Please log in again.');
                return;
            } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
                console.log('🚫 Authorization insufficient in locations load');
                handleAuthFailure('Google Business Profile access required. Please reconnect your account.');
                return;
            } else if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
                console.log('🌐 Network error in locations load');
                handleAuthFailure('Connection error. Please check your internet and try logging in again.');
                return;
            }
            
            // Check if this is a session expiration error (fallback)
            if (isAuthenticationError && isAuthenticationError(error)) {
                console.log('🔒 Session expired detected by legacy handler');
                handleSessionExpired && handleSessionExpired();
                return;
            }
            
            const select = document.getElementById('location-select');
            select.innerHTML = '<option value="">Error loading locations</option>';
            select.disabled = false;
            
            showError('Failed to load business locations: ' + error.message);
        })
        .finally(() => {
            AppState.setLoading('Locations', false);
        });
}

// Enrich locations with address data using separate API call
async function enrichLocationsWithAddresses(locations) {
    console.log('🏠 Enriching locations with address data...');
    
    try {
        const response = await fetch('/api/gmb/locations/enrich-addresses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ locations })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                console.log(`✅ Address enrichment successful: ${data.data.addressesFound}/${data.data.totalLocations} locations have addresses`);
                
                // Update cached location data with address information
                AppState.locationsData.locations = data.data.locations;
                
                // Update UI with enriched data
                updateLocationsUI(AppState.locationsData);
                
                // Log address information for debugging
                data.data.locations.forEach((location, index) => {
                    if (location.fullAddress) {
                        console.log(`🏠 Location ${index + 1} (${location.displayName}) address:`, location.addressInfo);
                    } else {
                        console.log(`🏠 Location ${index + 1} (${location.displayName}) no address available`);
                    }
                });
            } else {
                console.warn('⚠️ Address enrichment API returned error:', data.message);
            }
        } else {
            console.warn('⚠️ Address enrichment API call failed:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('❌ Error enriching locations with addresses:', error);
        // Don't show error to user as this is supplementary functionality
    }
}

function updateLocationsUI(locationsData) {
    const select = document.getElementById('location-select');
    const locations = locationsData.locations;
    
    select.innerHTML = '<option value="">Select a location...</option>';
    
    if (locations.length === 0) {
        // Show help section for empty locations
        document.getElementById('no-locations-help').style.display = 'block';
        select.innerHTML = '<option value="">No locations found - Set up Google Business Profile first</option>';
        select.disabled = true;
        console.log('⚠️ No business locations found - user needs to set up Google Business Profile');
    } else {
        // Hide help section and populate locations
        document.getElementById('no-locations-help').style.display = 'none';
        locations.forEach(location => {
            const option = document.createElement('option');
            option.value = location.name;
            
            // Include address in display text if available
            let displayText = location.displayName || location.name;
            if (location.addressInfo && location.addressInfo !== 'Address not available' && location.addressInfo !== 'Error fetching address') {
                displayText += ` - ${location.addressInfo}`;
            }
            
            option.textContent = displayText;
            select.appendChild(option);
        });
        select.disabled = false;
        
        // Check if there's a pre-selected location from auth success page
        const selectedLocation = sessionStorage.getItem('selectedLocation');
        if (selectedLocation) {
            try {
                const locationData = JSON.parse(selectedLocation);
                select.value = locationData.name;
                AppState.currentLocation = locationData.name;
                AppState.currentLocationId = locationData.name.split('/').pop();
                console.log(`📍 Pre-selected location: ${locationData.displayName}`);
                
                // Clear the stored selection after using it
                sessionStorage.removeItem('selectedLocation');
                
                // Auto-load reviews for the pre-selected location
                setTimeout(() => {
                    loadReviews();
                }, 500);
            } catch (error) {
                console.error('Error parsing selected location:', error);
                sessionStorage.removeItem('selectedLocation');
            }
        }
        
        console.log(`📍 Updated locations UI with ${locations.length} locations`);
    }
}

// Function to go back to location selection (auth success page)
function backToLocationSelection() {
    console.log('📍 Returning to location selection page');
    window.location.href = '/auth-success.html';
}

// Reviews Management Functions
function loadReviews() {
    const locationSelect = document.getElementById('location-select');
    const unansweredOnly = document.getElementById('unanswered-only').checked;
    const container = document.getElementById('reviews-container');
    
    const selectedLocation = locationSelect.value;
    if (!selectedLocation) {
        showError('Please select a business location first');
        return;
    }
    
    // Extract location ID from the full location name
    const locationId = selectedLocation.split('/').pop();
    const cacheKey = `${locationId}:${unansweredOnly}`;
    
    // Set current state for other functions to use
    AppState.currentLocationId = locationId;
    AppState.currentFilter = unansweredOnly ? 'unanswered' : 'all';
    
    // Check if reviews are already cached for this location and filter
    // Only use cache if it's not expired and we're not forcing a refresh
    const now = Date.now();
    const cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    const cachedData = AppState.reviewsData[cacheKey];
    const shouldUseCache = cachedData && 
                          !AppState.isLoadingReviews && 
                          cachedData.timestamp && 
                          (now - cachedData.timestamp) < cacheExpiry &&
                          !AppState.bypassCacheUntil;
    
    if (shouldUseCache) {
        console.log(`✅ Reviews cached for ${locationId} (unanswered: ${unansweredOnly}), age: ${Math.round((now - cachedData.timestamp) / 1000)}s`);
        displayReviews(cachedData, unansweredOnly);
        return;
    } else if (cachedData) {
        console.log(`🔄 Cache expired for ${locationId}, fetching fresh reviews`);
    }
    
    if (AppState.isLoadingReviews) {
        console.log('⏳ Reviews already loading, skipping duplicate call');
        return;
    }

    console.log(`🔍 Loading reviews for location: ${selectedLocation}`);
    AppState.setLoading('Reviews', true);
    AppState.currentLocation = selectedLocation;
    AppState.currentReviewsFilter = unansweredOnly;
    
    // Show loading state
    container.innerHTML = `
        <div class="review-card" style="text-align: center; padding: 40px;">
            <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #4285f4; border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p style="margin-top: 20px; color: #666;">Loading reviews...</p>
        </div>
    `;

    const url = `/api/reviews/location/${locationId}${unansweredOnly ? '?unansweredOnly=true' : ''}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Cache the reviews data with timestamp
                AppState.reviewsData[cacheKey] = {
                    ...data.data,
                    timestamp: Date.now()
                };
                
                displayReviews(data.data, unansweredOnly);
                
                // Update overview stats with new review data
                updateOverviewStats();
                
                console.log(`✅ Reviews loaded and cached for ${locationId} (unanswered: ${unansweredOnly})`);
            } else {
                // Check if this is a session expiration error
                if (isAuthenticationError(data)) {
                    handleSessionExpired();
                    return;
                }
                
                // Check if this is a Google API restriction error
                const isApiRestriction = data.message && data.message.includes('restricted programmatic access');
                
                if (isApiRestriction) {
                    container.innerHTML = `
                        <div class="review-card" style="text-align: center; padding: 40px; background: #f8f9fa; border: 1px solid #dee2e6;">
                            <div style="margin-bottom: 20px;">
                                <span style="font-size: 48px;">📝</span>
                            </div>
                            <h3 style="color: #495057; margin-bottom: 15px;">Reviews Access Limited</h3>
                            <p style="color: #666; font-size: 0.95rem; margin-bottom: 20px; line-height: 1.5;">
                                Google has restricted programmatic access to reviews through their APIs. 
                                This is a platform-wide limitation, not an issue with your setup.
                            </p>
                            <div style="background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                                <p style="color: #0066cc; font-size: 0.9rem; margin: 0;">
                                    <strong>💡 Alternative:</strong> Use the official Google Business Profile dashboard or mobile app to view and manage your reviews.
                                </p>
                            </div>
                            <a href="https://business.google.com" target="_blank" 
                               style="display: inline-block; padding: 10px 20px; background: #4285f4; color: white; text-decoration: none; border-radius: 5px; font-weight: 500;">
                                Open Google Business Profile →
                            </a>
                        </div>
                    `;
                } else {
                    container.innerHTML = `
                        <div class="review-card" style="text-align: center; padding: 40px;">
                            <p style="color: #dc3545; margin-bottom: 10px;">❌ Error loading reviews</p>
                            <p style="color: #666; font-size: 0.9rem;">${data.message}</p>
                            <button data-action="load-reviews" style="margin-top: 15px; padding: 8px 16px; background: #4285f4; color: white; border: none; border-radius: 5px; cursor: pointer;">
                                Try Again
                            </button>
                        </div>
                    `;
                }
                
                console.error('❌ Failed to load reviews:', data.message);
                showError('Failed to load reviews: ' + data.message);
                
                // Re-setup event listeners for new buttons
                setupEventListeners();
            }
        })
        .catch(error => {
            console.error('❌ Error loading reviews:', error);
            
            // Check if this is a session expiration error
            if (isAuthenticationError(error)) {
                handleSessionExpired();
                return;
            }
            
            container.innerHTML = `
                <div class="review-card" style="text-align: center; padding: 40px;">
                    <p style="color: #dc3545; margin-bottom: 10px;">❌ Network Error</p>
                    <p style="color: #666; font-size: 0.9rem;">Unable to connect to the server. Please check your connection.</p>
                    <button data-action="load-reviews" style="margin-top: 15px; padding: 8px 16px; background: #4285f4; color: white; border: none; border-radius: 5px; cursor: pointer;">
                        Try Again
                    </button>
                </div>
            `;
            showError('Network error loading reviews. Please try again.');
            
            // Re-setup event listeners for new buttons
            setupEventListeners();
        })
        .finally(() => {
            AppState.setLoading('Reviews', false);
        });
}

// Force refresh reviews by bypassing cache
function refreshReviews() {
    console.log('🔄 Force refreshing reviews...');
    
    // Set bypass cache flag
    AppState.bypassCacheUntil = Date.now() + 10000; // 10 seconds
    
    // Clear existing cache for current location
    const locationSelect = document.getElementById('location-select');
    const unansweredOnly = document.getElementById('unanswered-only').checked;
    const selectedLocation = locationSelect.value;
    
    if (selectedLocation) {
        const locationId = selectedLocation.split('/').pop();
        const cacheKey = `${locationId}:${unansweredOnly}`;
        delete AppState.reviewsData[cacheKey];
        delete AppState.reviewsPagination[cacheKey];
        
        // Also clear backend pagination cache by making a request to clear it
        fetch('/api/reviews/clear-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId })
        }).catch(err => console.warn('Could not clear backend cache:', err));
        
        // Load fresh reviews
        loadReviews();
        
        showSuccess('🔄 Refreshing reviews with latest data...');
    } else {
        showError('Please select a location first');
    }
}

function displayReviews(reviewData, unansweredOnly, isAppending = false) {
    const container = document.getElementById('reviews-container');
    const reviews = unansweredOnly ? reviewData.reviews : reviewData.reviews;
    
    // Store pagination info
    const locationId = AppState.currentLocationId;
    const cacheKey = `${locationId}:${unansweredOnly}`;
    if (!AppState.reviewsPagination) AppState.reviewsPagination = {};
    
    AppState.reviewsPagination[cacheKey] = {
        hasNextPage: !!reviewData.hasNextPage || !!reviewData.nextPageToken,
        nextPageToken: reviewData.nextPageToken,
        totalReviews: reviewData.totalReviews || 0,
        currentCount: reviews ? reviews.length : 0
    };
    
    console.log('📊 Pagination info set:', AppState.reviewsPagination[cacheKey]);
    
    if (!reviews || reviews.length === 0) {
        if (!isAppending) {
            container.innerHTML = `
                <div class="review-card" style="text-align: center; padding: 40px;">
                    <p style="color: #666; font-size: 1.1rem; margin-bottom: 10px;">📝 No ${unansweredOnly ? 'unanswered ' : ''}reviews found</p>
                    <p style="color: #999; font-size: 0.9rem;">This location has no ${unansweredOnly ? 'unanswered ' : ''}reviews at the moment.</p>
                    ${unansweredOnly ? `
                        <button data-action="show-all-reviews" style="margin-top: 15px; padding: 8px 16px; background: #4285f4; color: white; border: none; border-radius: 5px; cursor: pointer;">
                            Show All Reviews
                        </button>
                    ` : ''}
                </div>
            `;
            
            // Re-setup event listeners for new buttons
            setupEventListeners();
        }
        return;
    }

    const reviewsHtml = reviews.map(review => {
        const starRating = getStarRating(review.starRating);
        const hasReply = review.reviewReply && review.reviewReply.comment;
        
        // Debug: Check if we're showing replied reviews when we shouldn't
        if (unansweredOnly && hasReply) {
            console.warn('⚠️ FOUND REPLIED REVIEW IN UNANSWERED FILTER:', {
                reviewId: review.reviewId,
                hasReply: !!hasReply,
                replyComment: hasReply?.comment,
                unansweredOnly: unansweredOnly
            });
        }
        
        // Check if this review was recently replied to but now shows no reply
        const replyHistory = JSON.parse(sessionStorage.getItem('replyHistory') || '[]');
        const recentReply = replyHistory.find(r => r.reviewId === review.reviewId);
        
        if (recentReply && !hasReply) {
            console.error('🚨 MISSING REPLY DETECTED:', {
                reviewId: review.reviewId,
                reviewName: review.name,
                expectedReply: recentReply.replyText,
                repliedAt: recentReply.timestamp,
                timeSinceReply: new Date() - new Date(recentReply.timestamp),
                currentlyHasReply: !!hasReply,
                reviewReplyObject: review.reviewReply,
                reviewReplyComment: review.reviewReply?.comment,
                reviewReplyKeys: review.reviewReply ? Object.keys(review.reviewReply) : null
            });
            
            // Show warning in UI
            showError(`⚠️ Reply missing for review ${review.reviewId.substring(0, 8)}... (replied ${Math.round((new Date() - new Date(recentReply.timestamp)) / 1000 / 60)} min ago)`);
        }
        
        // Parse the review date properly (Google returns RFC3339 format)
        const reviewDate = parseReviewDate(review.createTime);
        
        // Only log date debug for invalid dates
        if (isNaN(reviewDate.getTime())) {
            console.warn('📅 Invalid review date:', {
                original: review.createTime,
                parsed: reviewDate
            });
        }
        
        const formattedDate = reviewDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        const timeAgo = getTimeAgo(reviewDate);
        const reviewId = review.name.replace(/[^a-zA-Z0-9]/g, '');
        
        return `
            <div class="review-card" style="margin-bottom: 20px; border-left: 4px solid ${hasReply ? '#28a745' : '#ff9800'}; transition: all 0.3s ease;">
                <!-- Review Header -->
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #4285f4, #34a853); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 1.1rem;">
                            ${review.reviewer.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <strong style="font-size: 1.1rem; color: #333;">${review.reviewer.displayName}</strong>
                            <div style="color: #ffc107; margin: 3px 0; font-size: 1.2rem;">${starRating}</div>
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <div style="font-size: 0.85rem; color: #666;">${formattedDate}</div>
                        <div style="font-size: 0.75rem; color: #999;">${timeAgo}</div>
                    </div>
                </div>
                
                <!-- Review Content -->
                ${review.comment ? `
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #e9ecef;">
                        <p style="margin: 0; color: #333; line-height: 1.5; font-size: 0.95rem;">"${review.comment}"</p>
                    </div>
                ` : `
                    <div style="background: #fff3cd; padding: 12px; border-radius: 6px; margin-bottom: 15px; border: 1px solid #ffeaa7;">
                        <p style="margin: 0; color: #856404; font-style: italic; font-size: 0.9rem;">⚠️ No written review provided</p>
                    </div>
                `}
                
                ${hasReply ? `
                    <!-- Existing Reply -->
                    <div id="reply-section-${reviewId}" style="background: #d4edda; padding: 15px; border-radius: 8px; border: 1px solid #c3e6cb;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #155724; font-weight: bold;">✅ Your Response:</span>
                                <span style="font-size: 0.8rem; color: #6c757d;">${new Date(review.reviewReply.updateTime).toLocaleDateString()}</span>
                            </div>
                            <button data-action="edit-reply" data-review-id="${reviewId}" data-review-name="${review.name}" data-current-reply="${(review.reviewReply.comment || '').replace(/"/g, '&quot;')}"
                                    style="padding: 5px 10px; background: #ffc107; color: #212529; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">
                                ✏️ Edit Reply
                            </button>
                        </div>
                        <p id="reply-text-${reviewId}" style="margin: 0; color: #155724; line-height: 1.4;">${review.reviewReply.comment}</p>
                        
                        <!-- Edit Reply Section (initially hidden) -->
                        <div id="edit-reply-${reviewId}" style="display: none; margin-top: 15px; border-top: 1px solid #c3e6cb; padding-top: 15px;">
                            <textarea id="edit-reply-text-${reviewId}" 
                                     style="width: 100%; padding: 12px; border: 1px solid #c3e6cb; border-radius: 6px; resize: vertical; min-height: 80px; font-family: inherit; font-size: 0.9rem;"
                                     placeholder="Edit your reply...">${review.reviewReply.comment}</textarea>
                            <div style="display: flex; gap: 10px; margin-top: 10px;">
                                <button data-action="update-reply" data-review-name="${review.name}" data-textarea-id="edit-reply-text-${reviewId}"
                                        style="flex: 1; padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                                    💾 Update Reply
                                </button>
                                <button data-action="cancel-edit-reply" data-review-id="${reviewId}"
                                        style="padding: 8px 15px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                ` : `
                    <!-- Response Section -->
                    <div style="border-top: 1px solid #e9ecef; padding-top: 15px;">
                        <div id="response-buttons-${reviewId}" style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;">
                            <!-- Template-based response (always available) -->
                            <button data-action="generate-response" data-review-id="${reviewId}" data-star-rating="${starRating}" data-review-comment="${(review.comment || '').replace(/"/g, '&quot;')}" 
                                    style="flex: 1; min-width: 140px; padding: 10px 12px; background: linear-gradient(135deg, #28a745, #20c997); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: 0.9rem;">
                                🤖 Quick Response
                            </button>
                            
                            <!-- AI-powered response (only show if OpenAI is configured) -->
                            <button data-action="generate-ai-response" data-review-id="${reviewId}" data-star-rating="${starRating}" data-review-comment="${(review.comment || '').replace(/"/g, '&quot;')}" data-reviewer-name="${(review.reviewer?.displayName || 'Anonymous').replace(/"/g, '&quot;')}"
                                    style="flex: 1; min-width: 140px; padding: 10px 12px; background: linear-gradient(135deg, #6f42c1, #e83e8c); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: 0.9rem; display: none;"
                                    class="ai-response-btn">
                                🧠 AI Response
                            </button>
                            
                            <button data-action="toggle-manual-reply" data-review-id="${reviewId}" 
                                    style="padding: 10px 15px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; transition: all 0.2s; font-size: 0.9rem;">
                                ✍️ Manual
                            </button>
                        </div>
                        
                        <div id="manual-reply-${reviewId}" style="display: none; margin-top: 10px;">
                            <textarea id="reply-${reviewId}" 
                                     placeholder="Write your personalized response..." 
                                     style="width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; resize: vertical; min-height: 100px; font-family: inherit; font-size: 0.9rem;"></textarea>
                            <div style="display: flex; gap: 10px; margin-top: 10px;">
                                <button data-action="post-reply" data-review-name="${review.name}" data-textarea-id="reply-${reviewId}" 
                                        style="flex: 1; padding: 10px 15px; background: #4285f4; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                                    📤 Post Reply
                                </button>
                                <button data-action="toggle-manual-reply" data-review-id="${reviewId}" 
                                        style="padding: 10px 15px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                `}
            </div>
        `;
    }).join('');

    // Get pagination info for this location/filter combo
    const paginationInfo = AppState.reviewsPagination[cacheKey] || {};
    const totalCount = paginationInfo.totalReviews || reviews.length;
    const currentCount = isAppending ? 
        (container.querySelectorAll('.review-card').length - 1 + reviews.length) : // -1 for summary card
        reviews.length;
    
    console.log('🔍 displayReviews Debug:', {
        cacheKey,
        paginationInfo,
        hasNextPage: paginationInfo.hasNextPage,
        nextPageToken: paginationInfo.nextPageToken,
        totalCount,
        currentCount,
        reviewsLength: reviews.length,
        isAppending,
        willShowLoadMore: paginationInfo.hasNextPage,
        reviewDataKeys: Object.keys(reviewData),
        reviewDataHasNextPage: reviewData.hasNextPage,
        reviewDataNextPageToken: reviewData.nextPageToken
    });
    
    // Summary header (only create if not appending)
    const summaryHtml = !isAppending ? `
        <div style="margin-bottom: 20px; padding: 20px; background: linear-gradient(135deg, #e3f2fd, #f3e5f5); border-radius: 12px; border: 1px solid #bbdefb;">
            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 15px;">
                <div>
                    <strong style="font-size: 1.1rem; color: #1565c0;">📊 Reviews Summary</strong>
                    <p style="margin: 5px 0 0 0; color: #666;">
                        ${paginationInfo.hasNextPage ? 
                            `Showing ${currentCount} of ${totalCount} ${unansweredOnly ? 'unanswered ' : ''}reviews` :
                            `${reviews.length} ${unansweredOnly ? 'unanswered ' : ''}reviews found`
                        }
                    </p>
                </div>
                ${reviewData.averageRating ? `
                    <div style="text-align: right;">
                        <div style="color: #ffc107; font-size: 1.2rem; margin-bottom: 3px;">${getStarRating(getStarRatingKey(reviewData.averageRating))}</div>
                        <div style="color: #666; font-size: 0.9rem;">${reviewData.averageRating.toFixed(1)} average rating</div>
                    </div>
                ` : ''}
            </div>
        </div>
    ` : '';

    // Load More button
    const loadMoreHtml = paginationInfo.hasNextPage ? `
        <div style="text-align: center; margin: 30px 0; padding: 20px;">
            <button id="load-more-reviews" data-action="load-more-reviews" 
                    style="padding: 12px 24px; background: #4285f4; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 500; transition: all 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
                    onmouseover="this.style.background='#3367d6'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 8px rgba(0,0,0,0.15)'"
                    onmouseout="this.style.background='#4285f4'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(0,0,0,0.1)'">
                📄 Load More Reviews
            </button>
        </div>
    ` : '';
    
    console.log('🔍 Load More Button Debug:', {
        willShowButton: paginationInfo.hasNextPage,
        buttonHtml: loadMoreHtml ? 'Will show button' : 'No button'
    });

    if (isAppending) {
        // Append new reviews to existing content (remove any existing load more button first)
        const existingLoadMore = container.querySelector('[data-action="load-more-reviews"]');
        if (existingLoadMore) {
            existingLoadMore.closest('div').remove();
        }
        container.insertAdjacentHTML('beforeend', reviewsHtml + loadMoreHtml);
    } else {
        // Replace all content
        container.innerHTML = summaryHtml + reviewsHtml + loadMoreHtml;
    }
    
    // Setup event listeners for review action buttons
    setupReviewEventListeners();
    
    // Check OpenAI status and show AI buttons if configured
    checkAndShowAIButtons();
}

// Session Handling Functions
function handleSessionExpired() {
    console.log('🔐 Session expired, forcing logout...');
    
    // Clear all app state
    AppState.clearCache();
    
    // Set bypass cache flag for next 10 seconds to ensure fresh data
    AppState.bypassCacheUntil = Date.now() + 10000;
    
    // Clear any stored tokens or user data
    localStorage.removeItem('user_session');
    
    // Show session expired message
    showError('Your session has expired. Please log in again to continue.', 'Session Expired');
    
    // Redirect to login after a short delay
    setTimeout(() => {
        console.log('🔄 Redirecting to login...');
        window.location.href = '/auth/google';
    }, 2000);
}

function isAuthenticationError(error) {
    // Check for various authentication error indicators
    if (error.status === 401 || error.statusCode === 401) {
        return true;
    }
    
    if (error.message && (
        error.message.includes('Invalid Credentials') ||
        error.message.includes('UNAUTHENTICATED') ||
        error.message.includes('authentication') ||
        error.message.includes('Unauthorized')
    )) {
        return true;
    }
    
    if (error.error && (
        error.error === 'AUTHENTICATION_REQUIRED' ||
        error.error === 'UNAUTHORIZED' ||
        error.error.includes('auth')
    )) {
        return true;
    }
    
    return false;
}

// Load More Reviews Function
async function loadMoreReviews() {
    const locationId = AppState.currentLocationId;
    if (!locationId) {
        console.error('❌ No location selected for loading more reviews');
        return;
    }
    
    const unansweredOnly = AppState.currentFilter === 'unanswered';
    const cacheKey = `${locationId}:${unansweredOnly}`;
    const paginationInfo = AppState.reviewsPagination[cacheKey];
    
    console.log('🔍 Load More Reviews Debug:', {
        locationId,
        unansweredOnly,
        cacheKey,
        paginationInfo,
        hasPaginationInfo: !!paginationInfo,
        hasNextPage: paginationInfo?.hasNextPage,
        nextPageToken: paginationInfo?.nextPageToken,
        currentCount: paginationInfo?.currentCount,
        totalReviews: paginationInfo?.totalReviews
    });
    
    if (!paginationInfo) {
        console.log('⚠️ No pagination info available - reviews may not have been loaded yet');
        showToast('Please load reviews first before trying to load more', 'info');
        return;
    }
    
    if (!paginationInfo.hasNextPage || !paginationInfo.nextPageToken) {
        console.log('⚠️ No more reviews to load:', {
            hasNextPage: paginationInfo.hasNextPage,
            nextPageToken: paginationInfo.nextPageToken
        });
        showToast('No more reviews available to load', 'info');
        return;
    }
    
    const loadMoreBtn = document.getElementById('load-more-reviews');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '⏳ Loading...';
    }
    
    try {
        console.log(`📄 Loading more reviews for location: ${locationId}, token: ${paginationInfo.nextPageToken}`);
        
        // Handle the new pagination token format
        const pageToken = paginationInfo.nextPageToken === 'continue' ? 'continue' : paginationInfo.nextPageToken;
        
        const response = await fetch(`/api/reviews/location/${encodeURIComponent(locationId)}?unansweredOnly=${unansweredOnly}&pageToken=${encodeURIComponent(pageToken)}&pageSize=50`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('📄 Load more reviews response:', data);
        
        if (data.success && data.data && data.data.reviews) {
            // Append new reviews to existing cached data
            if (AppState.reviewsData[cacheKey]) {
                AppState.reviewsData[cacheKey].reviews.push(...data.data.reviews);
                // Update pagination info
                AppState.reviewsData[cacheKey].hasNextPage = data.data.hasNextPage;
                AppState.reviewsData[cacheKey].nextPageToken = data.data.nextPageToken;
            }
            
            // Update pagination state
            AppState.reviewsPagination[cacheKey] = {
                hasNextPage: !!data.data.hasNextPage,
                nextPageToken: data.data.nextPageToken,
                totalReviews: data.data.totalReviews || paginationInfo.totalReviews,
                currentCount: paginationInfo.currentCount + data.data.reviews.length
            };
            
            // Display new reviews (appending mode)
            displayReviews(data.data, unansweredOnly, true);
            
            console.log(`✅ Loaded ${data.data.reviews.length} more reviews. New pagination state:`, AppState.reviewsPagination[cacheKey]);
            
            // Show success message
            showToast(`✅ Loaded ${data.data.reviews.length} more reviews`, 'success');
        } else {
            throw new Error(data.message || 'Failed to load more reviews');
        }
        
    } catch (error) {
        console.error('❌ Error loading more reviews:', error);
        showToast(`❌ Error loading more reviews: ${error.message}`, 'error');
    } finally {
        if (loadMoreBtn) {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = '📄 Load More Reviews';
        }
    }
}

// Setup event listeners specifically for review action buttons
function setupReviewEventListeners() {
    // Generate response buttons
    document.querySelectorAll('[data-action="generate-response"]').forEach(button => {
        button.addEventListener('click', function() {
            const reviewId = this.getAttribute('data-review-id');
            const starRating = this.getAttribute('data-star-rating');
            const reviewComment = this.getAttribute('data-review-comment');
            generateResponse(reviewId, starRating, reviewComment, this);
        });
    });
    
    // Toggle manual reply buttons
    document.querySelectorAll('[data-action="toggle-manual-reply"]').forEach(button => {
        button.addEventListener('click', function() {
            const reviewId = this.getAttribute('data-review-id');
            toggleManualReply(reviewId);
        });
    });
    
    // Post reply buttons
    document.querySelectorAll('[data-action="post-reply"]').forEach(button => {
        button.addEventListener('click', function() {
            const reviewName = this.getAttribute('data-review-name');
            const textareaId = this.getAttribute('data-textarea-id');
            postReply(reviewName, textareaId, this);
        });
    });
    
    // Toast close buttons (dynamic content)
    document.addEventListener('click', function(e) {
        if (e.target && e.target.getAttribute('data-action') === 'close-toast') {
            e.target.closest('div').remove();
        }
    });
}

// Review Response Functions
function generateResponse(reviewId, starRating, reviewComment, buttonElement) {
    console.log(`🤖 Generating response for review: ${reviewId}`);
    
    const originalText = buttonElement.innerHTML;
    
    // Show loading state
    buttonElement.disabled = true;
    buttonElement.innerHTML = '🔄 Generating...';
    buttonElement.style.opacity = '0.7';
    
    // Simple response generation based on rating and content
    setTimeout(() => {
        const response = generateResponseText(starRating, reviewComment);
        
        // Show the manual reply section with generated text
        const textarea = document.getElementById(`reply-${reviewId}`);
        const manualReplyDiv = document.getElementById(`manual-reply-${reviewId}`);
        
        textarea.value = response;
        manualReplyDiv.style.display = 'block';
        
        // Restore button
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalText;
        buttonElement.style.opacity = '1';
        
        // Focus and select the generated text
        textarea.focus();
        textarea.select();
        
        showSuccess('Response generated! You can edit it before posting.');
    }, 1500); // Simulate API call delay
}

function generateResponseText(starRating, reviewComment) {
    // Use AI-powered personalized response generation
    // Following the prompt: "help reply to this review, read it then, make a short, compassionate and personalized reply, never make any promises and never mention my staff names in replies just say 'team' instead"
    
    const rating = starRating.length; // Count stars for numeric rating
    const hasComment = reviewComment && reviewComment.trim() !== '';
    const comment = hasComment ? reviewComment.trim() : '';
    
    // Generate personalized responses based on the review content and rating
    let response = '';
    
    if (rating >= 4) {
        // Positive reviews - personalized and grateful responses
        if (hasComment) {
            // Analyze the comment for specific mentions and respond accordingly
            const lowerComment = comment.toLowerCase();
            
            if (lowerComment.includes('service') || lowerComment.includes('staff') || lowerComment.includes('team')) {
                response = `Thank you so much for your kind words about our team! We're delighted that our service made such a positive impression on you.`;
            } else if (lowerComment.includes('food') || lowerComment.includes('meal') || lowerComment.includes('delicious')) {
                response = `We're thrilled you enjoyed your experience with us! Your feedback about the quality means so much to our team.`;
            } else if (lowerComment.includes('clean') || lowerComment.includes('atmosphere') || lowerComment.includes('ambiance')) {
                response = `Thank you for noticing the care our team puts into creating a welcoming environment. We're so glad you felt comfortable with us.`;
            } else if (lowerComment.includes('quick') || lowerComment.includes('fast') || lowerComment.includes('prompt')) {
                response = `We appreciate you taking the time to share your experience! Our team works hard to provide efficient service while maintaining quality.`;
            } else {
                response = `Thank you for sharing your wonderful experience! It truly brightens our day to know we made a positive impact during your visit.`;
            }
        } else {
            // Rating-only positive reviews
            const positiveResponses = [
                "Thank you for the fantastic rating! We're grateful for customers like you who take the time to share their experience.",
                "We're so pleased you had a great experience with us! Thank you for choosing us and for your positive feedback.",
                "Your 5-star rating means the world to our team! We're delighted we could provide you with excellent service."
            ];
            response = positiveResponses[Math.floor(Math.random() * positiveResponses.length)];
        }
        
        // Add closing without promises
        response += " We look forward to welcoming you back soon!";
        
    } else if (rating === 3) {
        // Neutral reviews - acknowledge and show appreciation
        if (hasComment) {
            response = `Thank you for taking the time to share your honest feedback. Our team values all input as it helps us understand how we can better serve our customers.`;
        } else {
            response = `Thank you for your feedback. We appreciate you taking the time to rate your experience with us.`;
        }
        response += " We hope to have another opportunity to serve you in the future.";
        
    } else {
        // Negative reviews - compassionate and understanding
        if (hasComment) {
            const lowerComment = comment.toLowerCase();
            
            if (lowerComment.includes('wait') || lowerComment.includes('slow') || lowerComment.includes('long')) {
                response = `We sincerely apologize for the longer wait time you experienced. We understand how frustrating this can be, and our team is working to improve our service flow.`;
            } else if (lowerComment.includes('rude') || lowerComment.includes('unprofessional') || lowerComment.includes('attitude')) {
                response = `We're truly sorry to hear about this disappointing interaction. This doesn't reflect the standard of service our team strives to provide, and we take your feedback very seriously.`;
            } else if (lowerComment.includes('dirty') || lowerComment.includes('messy') || lowerComment.includes('unclean')) {
                response = `Thank you for bringing this to our attention. Maintaining a clean environment is important to us, and we're addressing this matter with our team immediately.`;
            } else if (lowerComment.includes('cold') || lowerComment.includes('wrong') || lowerComment.includes('mistake')) {
                response = `We apologize that your experience didn't meet expectations. Our team takes pride in getting things right, and we're sorry we fell short this time.`;
            } else {
                response = `We're genuinely sorry to hear about your disappointing experience. Your feedback is important to us and helps our team understand where we need to improve.`;
            }
        } else {
            response = `We're sorry to see that your experience with us wasn't positive. We value all feedback as it helps our team grow and improve.`;
        }
        
        // Add compassionate closing without specific promises
        response += " Please feel free to reach out to us directly if you'd like to discuss your experience further.";
    }
    
    return response;
}

function toggleManualReply(reviewId) {
    const manualReplyDiv = document.getElementById(`manual-reply-${reviewId}`);
    
    // Check if the element exists (it might not exist if the review was just replied to)
    if (!manualReplyDiv) {
        console.log(`ℹ️ Manual reply section for review ${reviewId} not found (likely already replied)`);
        return;
    }
    
    const isVisible = manualReplyDiv.style.display !== 'none';
    
    manualReplyDiv.style.display = isVisible ? 'none' : 'block';
    
    if (!isVisible) {
        // Focus on textarea when shown
        const textarea = document.getElementById(`reply-${reviewId}`);
        if (textarea) {
            setTimeout(() => textarea.focus(), 100);
        }
    } else {
        // Clear textarea when hidden
        const textarea = document.getElementById(`reply-${reviewId}`);
        if (textarea) {
            textarea.value = '';
        }
    }
}

// Debounce object to prevent rapid multiple calls
const postReplyDebounce = {};

function postReply(reviewName, textareaId, buttonElement) {
    // Prevent rapid multiple calls for the same review
    if (postReplyDebounce[reviewName]) {
        console.log('⏳ Post reply already in progress for this review, ignoring duplicate call');
        return;
    }
    
    const textarea = document.getElementById(textareaId);
    const replyText = textarea.value.trim();
    
    if (!replyText) {
        showError('Please enter a reply before posting');
        textarea.focus();
        return;
    }

    // Set debounce flag
    postReplyDebounce[reviewName] = true;
    console.log(`💬 Posting reply to review: ${reviewName}`);
    
    const originalText = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = '📤 Posting...';
    buttonElement.style.opacity = '0.7';

    // Use the full review name for the API call by encoding it
    const encodedReviewName = encodeURIComponent(reviewName);
    
    fetch(`/api/gmb/reviews/${encodedReviewName}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ replyText })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // Log successful reply for tracking
                const replyLog = {
                    reviewId: reviewName.split('/').pop(),
                    reviewName: reviewName,
                    replyText: replyText,
                    timestamp: new Date().toISOString(),
                    success: true
                };
                console.log('✅ REPLY SUCCESS LOGGED:', replyLog);
                
                // Store in sessionStorage for tracking
                const replyHistory = JSON.parse(sessionStorage.getItem('replyHistory') || '[]');
                replyHistory.push(replyLog);
                sessionStorage.setItem('replyHistory', JSON.stringify(replyHistory));
                
                showSuccess('Reply posted successfully!');
                
                // Always clear cache after successful reply to ensure fresh data
                // Clear both unanswered and all reviews cache for this location
                const locationId = AppState.currentLocationId;
                if (locationId) {
                    const unansweredKey = `${locationId}:true`;
                    const allKey = `${locationId}:false`;
                    delete AppState.reviewsData[unansweredKey];
                    delete AppState.reviewsData[allKey];
                    console.log('🗑️ Cleared both unanswered and all reviews cache after successful reply');
                    
                    // Also clear pagination data
                    if (AppState.reviewsPagination) {
                        delete AppState.reviewsPagination[unansweredKey];
                        delete AppState.reviewsPagination[allKey];
                    }
                    
                    // Clear server-side pagination cache for this location
                    clearPaginationCache(locationId);
                } else {
                    // Fallback: clear all review cache
                    AppState.reviewsData = {};
                    AppState.reviewsPagination = {};
                    clearPaginationCache(); // Clear all pagination cache
                    console.log('🗑️ Cleared all review cache (no locationId available)');
                }
                
                // Always reload reviews after successful reply to ensure we see the updated data
                console.log('🔄 Reloading reviews after successful reply to show updated status');
                
                try {
                    // Update the review in place for immediate feedback
                    updateReviewWithReply(reviewName, replyText);
                    
                    // Hide the manual reply section
                    const reviewId = reviewName.split('/').pop();
                    toggleManualReply(reviewId);
                    
                    // Wait a moment for Google API to process, then refresh
                    setTimeout(() => {
                        console.log('🔄 Refreshing reviews to show latest reply status');
                        loadReviews();
                    }, 1500);
                } catch (domError) {
                    console.error('❌ Error updating DOM after successful reply:', domError);
                    console.log('🔄 Falling back to full review reload with delay');
                    
                    // Wait 2 seconds for Google API to process the reply before reloading
                    setTimeout(() => {
                        console.log('🔄 Reloading reviews after API processing delay');
                        loadReviews();
                    }, 2000);
                }
                
                // Clear debounce flag on success
                setTimeout(() => {
                    delete postReplyDebounce[reviewName];
                }, 1000); // Clear after 1 second to allow DOM updates to complete
                
            } else {
                // Check if this is a session expiration error
                if (isAuthenticationError(data)) {
                    handleSessionExpired();
                    return;
                }
                
                showError(`Failed to post reply: ${data.message}`);
                buttonElement.disabled = false;
                buttonElement.innerHTML = originalText;
                buttonElement.style.opacity = '1';
                
                // Clear debounce flag on error
                delete postReplyDebounce[reviewName];
            }
        })
        .catch(error => {
            console.error('❌ Error posting reply:', error);
            
            // Check if this is a session expiration error
            if (isAuthenticationError(error)) {
                handleSessionExpired();
                return;
            }
            
            showError('Network error posting reply. Please try again.');
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalText;
            buttonElement.style.opacity = '1';
            
            // Clear debounce flag on network error
            delete postReplyDebounce[reviewName];
        });
}

function updateReviewWithReply(reviewName, replyText) {
    const reviewId = reviewName.split('/').pop();
    
    // Check if this review has already been updated (prevent duplicate updates)
    const existingReplySection = document.getElementById(`reply-section-${reviewId}`);
    if (existingReplySection) {
        return; // Already updated, skip silently
    }
    
    // Update the cached review data
                    const cacheKey = `${AppState.currentLocationId}:${AppState.showUnansweredOnly || false}`;
    if (AppState.reviewsData[cacheKey] && AppState.reviewsData[cacheKey].reviews) {
        const reviewIndex = AppState.reviewsData[cacheKey].reviews.findIndex(r => r.name === reviewName);
        if (reviewIndex !== -1) {
            AppState.reviewsData[cacheKey].reviews[reviewIndex].reviewReply = {
                comment: replyText,
                updateTime: new Date().toISOString()
            };
            console.log('✅ updateReviewWithReply: Updated cached review data');
        } else {
            console.log('⚠️ updateReviewWithReply: Review not found in cache');
        }
    } else {
        console.log('⚠️ updateReviewWithReply: No cached review data found');
    }
    
    // Update the DOM directly without full reload
    console.log('🔍 Looking for review element with ID:', reviewId);
    
    // Try multiple selectors to find the review element
    let reviewCard = null;
    
    // Try finding by data-review-id attribute
    const reviewElement = document.querySelector(`[data-review-id="${reviewId}"]`);
    if (reviewElement) {
        reviewCard = reviewElement.closest('.review-card');
        console.log('✅ Found review card via data-review-id');
    }
    
    // If not found, try finding by button with data-review-name attribute
    if (!reviewCard) {
        const buttonElement = document.querySelector(`[data-review-name="${reviewName}"]`);
        if (buttonElement) {
            reviewCard = buttonElement.closest('.review-card');
            console.log('✅ Found review card via data-review-name');
        }
    }
    
    // If still not found, try finding by manual-reply ID
    if (!reviewCard) {
        const manualReplyElement = document.getElementById(`manual-reply-${reviewId}`);
        if (manualReplyElement) {
            reviewCard = manualReplyElement.closest('.review-card');
            console.log('✅ Found review card via manual-reply ID');
        }
    }
    
    if (reviewCard) {
        console.log('✅ Found review card, updating with reply');
        // Find the response section and replace it with the reply section
        // Try multiple selectors to find the response section
        let responseSection = reviewCard.querySelector('[style*="border-top: 1px solid #e9ecef"]');
        
        // If not found, try finding any div that contains response buttons
        if (!responseSection) {
            responseSection = reviewCard.querySelector('button[data-action="generate-response"]')?.closest('div');
            console.log('🔍 Found response section via generate-response button');
        }
        
        // If still not found, try finding the manual reply section's parent
        if (!responseSection) {
            const manualReplyDiv = reviewCard.querySelector(`[id^="manual-reply-"]`);
            if (manualReplyDiv) {
                responseSection = manualReplyDiv.parentElement;
                console.log('🔍 Found response section via manual-reply parent');
            }
        }
        
        if (responseSection) {
            const replyHtml = `
                <div id="reply-section-${reviewId}" style="background: #d4edda; padding: 15px; border-radius: 8px; border: 1px solid #c3e6cb;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: #155724; font-weight: bold;">✅ Your Response:</span>
                            <span style="font-size: 0.8rem; color: #6c757d;">${new Date().toLocaleDateString()}</span>
                        </div>
                        <button data-action="edit-reply" data-review-id="${reviewId}" data-review-name="${reviewName}" data-current-reply="${replyText.replace(/"/g, '&quot;')}"
                                style="padding: 5px 10px; background: #ffc107; color: #212529; border: none; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: 500;">
                            ✏️ Edit Reply
                        </button>
                    </div>
                    <p id="reply-text-${reviewId}" style="margin: 0; color: #155724; line-height: 1.4;">${replyText}</p>
                    
                    <!-- Edit Reply Section (initially hidden) -->
                    <div id="edit-reply-${reviewId}" style="display: none; margin-top: 15px; border-top: 1px solid #c3e6cb; padding-top: 15px;">
                        <textarea id="edit-reply-text-${reviewId}" 
                                 style="width: 100%; padding: 12px; border: 1px solid #c3e6cb; border-radius: 6px; resize: vertical; min-height: 80px; font-family: inherit; font-size: 0.9rem;"
                                 placeholder="Edit your reply...">${replyText}</textarea>
                        <div style="display: flex; gap: 10px; margin-top: 10px;">
                            <button data-action="update-reply" data-review-name="${reviewName}" data-textarea-id="edit-reply-text-${reviewId}"
                                    style="flex: 1; padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">
                                💾 Update Reply
                            </button>
                            <button data-action="cancel-edit-reply" data-review-id="${reviewId}"
                                    style="padding: 8px 15px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            `;
            responseSection.outerHTML = replyHtml;
            
            // Re-setup event listeners for the new elements
            setupEventListeners();
        } else {
            console.log('⚠️ Could not find response section, will reload reviews instead');
            // Clear cache and reload reviews after delay to ensure fresh data
                            const cacheKey = `${AppState.currentLocationId}:${AppState.showUnansweredOnly || false}`;
            delete AppState.reviewsData[cacheKey];
            console.log('🗑️ Cleared review cache to fetch fresh data');
            
            // Wait 2 seconds for Google API to process the reply before reloading
            setTimeout(() => {
                console.log('🔄 Reloading reviews after API processing delay');
                loadReviews();
            }, 2000);
        }
    } else {
        console.log('⚠️ Could not find review card, will reload reviews instead');
        // Clear cache and reload reviews after delay to ensure fresh data
                        const cacheKey = `${AppState.currentLocationId}:${AppState.showUnansweredOnly || false}`;
        delete AppState.reviewsData[cacheKey];
        console.log('🗑️ Cleared review cache to fetch fresh data');
        
        // Wait 2 seconds for Google API to process the reply before reloading
        setTimeout(() => {
            console.log('🔄 Reloading reviews after API processing delay');
            loadReviews();
        }, 2000);
    }
}

function editReply(reviewId, reviewName, currentReply) {
    const editSection = document.getElementById(`edit-reply-${reviewId}`);
    const replyText = document.getElementById(`reply-text-${reviewId}`);
    
    if (editSection && replyText) {
        // Show edit section and hide the reply text
        editSection.style.display = 'block';
        replyText.style.display = 'none';
        
        // Focus on the textarea
        const textarea = document.getElementById(`edit-reply-text-${reviewId}`);
        if (textarea) {
            setTimeout(() => textarea.focus(), 100);
        }
    }
}

function cancelEditReply(reviewId) {
    const editSection = document.getElementById(`edit-reply-${reviewId}`);
    const replyText = document.getElementById(`reply-text-${reviewId}`);
    
    if (editSection && replyText) {
        // Hide edit section and show the reply text
        editSection.style.display = 'none';
        replyText.style.display = 'block';
    }
}

function updateReply(reviewName, textareaId, buttonElement) {
    const textarea = document.getElementById(textareaId);
    const newReplyText = textarea.value.trim();
    
    if (!newReplyText) {
        showError('Please enter a reply before updating');
        textarea.focus();
        return;
    }
    
    console.log(`💬 Updating reply for review: ${reviewName}`);
    
    const originalText = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = '💾 Updating...';
    buttonElement.style.opacity = '0.7';
    
    // Use the same endpoint as posting a new reply
    const encodedReviewName = encodeURIComponent(reviewName);
    
    fetch(`/api/gmb/reviews/${encodedReviewName}/reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ replyText: newReplyText })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showSuccess('Reply updated successfully!');
                
                // Update the reply text in the DOM
                const reviewId = reviewName.split('/').pop();
                const replyTextElement = document.getElementById(`reply-text-${reviewId}`);
                if (replyTextElement) {
                    replyTextElement.textContent = newReplyText;
                }
                
                // Update cached data
                updateReviewWithReply(reviewName, newReplyText);
                
                // Hide the edit section
                cancelEditReply(reviewId);
                
            } else {
                showError(`Failed to update reply: ${data.message}`);
                buttonElement.disabled = false;
                buttonElement.innerHTML = originalText;
                buttonElement.style.opacity = '1';
            }
        })
        .catch(error => {
            console.error('❌ Error updating reply:', error);
            showError('Network error updating reply. Please try again.');
            buttonElement.disabled = false;
            buttonElement.innerHTML = originalText;
            buttonElement.style.opacity = '1';
        });
}

// OpenAI Secure Storage Functions
function encryptData(data, key = 'gmb-app-key') {
    let encrypted = '';
    for (let i = 0; i < data.length; i++) {
        encrypted += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return btoa(encrypted);
}

function decryptData(encryptedData, key = 'gmb-app-key') {
    try {
        const encrypted = atob(encryptedData);
        let decrypted = '';
        for (let i = 0; i < encrypted.length; i++) {
            decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return decrypted;
    } catch (error) {
        console.error('❌ Error decrypting data:', error);
        return null;
    }
}

function saveOpenAIKeySecurely(apiKey) {
    try {
        // Check for user data in AppState.userData.user or AppState.user
        const user = AppState.userData?.user || AppState.user;
        if (!user || !user.id) {
            console.warn('⚠️ No user ID available for secure storage. AppState:', {
                userData: !!AppState.userData,
                userDataUser: !!AppState.userData?.user,
                user: !!AppState.user
            });
            return false;
        }
        
        const userKey = `gmb_openai_${user.id}`;
        const encryptedKey = encryptData(apiKey);
        localStorage.setItem(userKey, encryptedKey);
        console.log('🔐 OpenAI API key saved securely to localStorage for user:', user.id);
        return true;
    } catch (error) {
        console.error('❌ Error saving OpenAI key securely:', error);
        return false;
    }
}

function loadOpenAIKeySecurely() {
    try {
        // Check for user data in AppState.userData.user or AppState.user
        const user = AppState.userData?.user || AppState.user;
        if (!user || !user.id) {
            return null;
        }
        
        const userKey = `gmb_openai_${user.id}`;
        const encryptedKey = localStorage.getItem(userKey);
        
        if (!encryptedKey) {
            return null;
        }
        
        const decryptedKey = decryptData(encryptedKey);
        console.log('🔓 OpenAI API key loaded securely from localStorage for user:', user.id);
        return decryptedKey;
    } catch (error) {
        console.error('❌ Error loading OpenAI key securely:', error);
        return null;
    }
}

function removeOpenAIKeySecurely() {
    try {
        // Check for user data in AppState.userData.user or AppState.user
        const user = AppState.userData?.user || AppState.user;
        if (!user || !user.id) {
            return false;
        }
        
        const userKey = `gmb_openai_${user.id}`;
        localStorage.removeItem(userKey);
        console.log('🗑️ OpenAI API key removed from secure storage for user:', user.id);
        return true;
    } catch (error) {
        console.error('❌ Error removing OpenAI key securely:', error);
        return false;
    }
}

// OpenAI Functions
async function loadOpenAIStatus() {
    try {
        const response = await fetch('/api/openai/status');
        const data = await response.json();
        
        if (data.success && data.configured) {
            document.getElementById('openai-features').style.display = 'block';
            showOpenAIStatus('✅ OpenAI API is configured and ready!', 'success');
            
            // Load saved API key into the input field (masked)
            const savedKey = loadOpenAIKeySecurely();
            if (savedKey) {
                const apiKeyInput = document.getElementById('openai-api-key');
                if (apiKeyInput) {
                    // Show masked version of the key
                    apiKeyInput.value = 'sk-' + '•'.repeat(20) + savedKey.slice(-8);
                    apiKeyInput.setAttribute('data-has-saved-key', 'true');
                }
            }
        } else {
            // Server doesn't have the key, but check if we have it locally
            const savedKey = loadOpenAIKeySecurely();
            if (savedKey) {
                console.log('🔄 Found saved OpenAI key, auto-configuring server...');
                
                // Auto-configure the server with the saved key
                try {
                    const configResponse = await fetch('/api/openai/configure', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ apiKey: savedKey })
                    });
                    
                    const configData = await configResponse.json();
                    if (configData.success) {
                        document.getElementById('openai-features').style.display = 'block';
                        showOpenAIStatus('✅ OpenAI API restored from secure storage!', 'success');
                        
                        // Show masked key in input
                        const apiKeyInput = document.getElementById('openai-api-key');
                        if (apiKeyInput) {
                            apiKeyInput.value = 'sk-' + '•'.repeat(20) + savedKey.slice(-8);
                            apiKeyInput.setAttribute('data-has-saved-key', 'true');
                        }
                        
                        // Update review buttons
                        updateReviewResponseButtons();
                    } else {
                        document.getElementById('openai-features').style.display = 'none';
                    }
                } catch (configError) {
                    console.error('❌ Error auto-configuring OpenAI:', configError);
                    document.getElementById('openai-features').style.display = 'none';
                }
            } else {
                document.getElementById('openai-features').style.display = 'none';
            }
        }
    } catch (error) {
        console.error('❌ Error checking OpenAI status:', error);
        // Still try to load from localStorage if server is unreachable
        const savedKey = loadOpenAIKeySecurely();
        if (savedKey) {
            const apiKeyInput = document.getElementById('openai-api-key');
            if (apiKeyInput) {
                apiKeyInput.value = 'sk-' + '•'.repeat(20) + savedKey.slice(-8);
                apiKeyInput.setAttribute('data-has-saved-key', 'true');
            }
            showOpenAIStatus('⚠️ Server unreachable, but API key found in secure storage', 'warning');
        }
    }
}

function showOpenAIStatus(message, type = 'info') {
    const statusDiv = document.getElementById('openai-status');
    statusDiv.style.display = 'block';
    
    let bgColor, textColor;
    switch (type) {
        case 'success':
            bgColor = '#d4edda';
            textColor = '#155724';
            break;
        case 'error':
            bgColor = '#f8d7da';
            textColor = '#721c24';
            break;
        case 'warning':
            bgColor = '#fff3cd';
            textColor = '#856404';
            break;
        default:
            bgColor = '#d1ecf1';
            textColor = '#0c5460';
    }
    
    statusDiv.style.background = bgColor;
    statusDiv.style.color = textColor;
    statusDiv.style.border = `1px solid ${bgColor}`;
    statusDiv.textContent = message;
}

async function saveOpenAIKey() {
    const apiKeyInput = document.getElementById('openai-api-key');
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
        showOpenAIStatus('Please enter your OpenAI API key', 'error');
        return;
    }
    
    if (!apiKey.startsWith('sk-')) {
        showOpenAIStatus('Invalid API key format. OpenAI keys start with "sk-"', 'error');
        return;
    }
    
    const saveBtn = document.getElementById('save-openai-btn');
    const originalText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '💾 Saving...';
    
    try {
        const response = await fetch('/api/openai/configure', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ apiKey })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Save to server successful, now save securely to localStorage
            const localSaved = saveOpenAIKeySecurely(apiKey);
            if (localSaved) {
                showOpenAIStatus('✅ API key saved successfully!', 'success');
            } else {
                showOpenAIStatus('✅ API key saved to server (localStorage failed)', 'success');
            }
            
            document.getElementById('openai-features').style.display = 'block';
            
            // Update all review cards to show AI button if they're showing template buttons
            updateReviewResponseButtons();
            
        } else {
            showOpenAIStatus(`❌ Failed to save API key: ${data.message}`, 'error');
        }
        
    } catch (error) {
        console.error('❌ Error saving OpenAI key:', error);
        showOpenAIStatus('❌ Network error saving API key', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
    }
}

async function testOpenAI() {
    const testBtn = document.getElementById('test-openai-btn');
    const originalText = testBtn.innerHTML;
    testBtn.disabled = true;
    testBtn.innerHTML = '🧪 Testing...';
    
    try {
        const response = await fetch('/api/openai/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showOpenAIStatus(`✅ API test successful! Response: "${data.testResponse}"`, 'success');
            document.getElementById('openai-features').style.display = 'block';
        } else {
            showOpenAIStatus(`❌ API test failed: ${data.message}`, 'error');
            document.getElementById('openai-features').style.display = 'none';
        }
        
    } catch (error) {
        console.error('❌ Error testing OpenAI API:', error);
        showOpenAIStatus('❌ Network error testing API', 'error');
        document.getElementById('openai-features').style.display = 'none';
    } finally {
        testBtn.disabled = false;
        testBtn.innerHTML = originalText;
    }
}

// Debounce object for AI generation
const aiGenerationDebounce = {};

async function generateAIResponse(reviewId, starRating, reviewComment, reviewerName, buttonElement) {
    // Prevent rapid multiple calls for the same review
    if (aiGenerationDebounce[reviewId]) {
        console.log('⏳ AI generation already in progress for this review, ignoring duplicate call');
        return;
    }
    
    // Set debounce flag
    aiGenerationDebounce[reviewId] = true;
    
    const originalText = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = '🤖 Generating AI Response...';
    buttonElement.style.opacity = '0.7';
    
    try {
        const response = await fetch('/api/deepseek/generate-review-response', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reviewerName,
                starRating,
                reviewComment: reviewComment || '',
                businessType: 'business' // You can make this configurable later
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Pre-fill the manual reply textarea with AI response
            const textarea = document.getElementById(`reply-${reviewId}`);
            if (textarea) {
                textarea.value = data.response;
                
                // Show the manual reply section
                const manualReplyDiv = document.getElementById(`manual-reply-${reviewId}`);
                if (manualReplyDiv) {
                    manualReplyDiv.style.display = 'block';
                    textarea.focus();
                }
                
                // Create success message with additional info
                const cacheInfo = data.cached ? ' (cached response)' : ' (fresh response)';
                const categoryInfo = data.category ? ` - ${data.category} review` : '';
                showSuccess(`🤖 DeepSeek response generated${cacheInfo}${categoryInfo}! You can edit it before posting.`);
                
                // Log additional details for debugging
                console.log('🤖 DeepSeek response details:', {
                    category: data.category,
                    sentiment: data.sentiment,
                    cached: data.cached,
                    model: data.model,
                    responseLength: data.response?.length
                });
            }
        } else {
            const errorMsg = data.error === 'RATE_LIMIT_EXCEEDED' ? 
                'Rate limit exceeded. Please try again in a moment.' : 
                `Failed to generate response: ${data.message}`;
            showError(`❌ ${errorMsg}`);
        }
        
    } catch (error) {
        console.error('❌ Error generating AI response:', error);
        showError('❌ Network error generating AI response');
    } finally {
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalText;
        buttonElement.style.opacity = '1';
        
        // Clear debounce flag
        delete aiGenerationDebounce[reviewId];
    }
}

function updateReviewResponseButtons() {
    // This function will be called when OpenAI is configured to update existing review cards
    console.log('🔄 Updating review response buttons to show AI option');
    // Trigger the AI button check
    checkAndShowAIButtons();
}

async function checkAndShowAIButtons() {
    try {
        const response = await fetch('/api/deepseek/status');
        const data = await response.json();
        
        if (data.success && data.configured) {
            // Show all AI response buttons
            const aiButtons = document.querySelectorAll('.ai-response-btn');
            aiButtons.forEach(button => {
                button.style.display = 'flex';
                // Update button text to reflect DeepSeek
                if (button.innerHTML.includes('🤖')) {
                    button.innerHTML = button.innerHTML.replace('AI Response', 'DeepSeek AI');
                }
            });
            console.log('✅ DeepSeek configured - AI response buttons enabled');
            
            // Show cache stats if available
            if (data.cache) {
                console.log(`📊 DeepSeek Cache: ${data.cache.totalEntries} entries, ${(data.cache.cacheHitRate * 100).toFixed(1)}% hit rate`);
            }
        } else {
            console.log('ℹ️ DeepSeek not configured - AI response buttons hidden');
        }
    } catch (error) {
        console.log('ℹ️ Could not check DeepSeek status:', error.message);
    }
}

// Utility Functions
function getStarRating(rating) {
    const stars = {
        'ONE': '⭐',
        'TWO': '⭐⭐',
        'THREE': '⭐⭐⭐',
        'FOUR': '⭐⭐⭐⭐',
        'FIVE': '⭐⭐⭐⭐⭐'
    };
    return stars[rating] || '⭐';
}

function getStarRatingKey(numericRating) {
    if (numericRating >= 4.5) return 'FIVE';
    if (numericRating >= 3.5) return 'FOUR';
    if (numericRating >= 2.5) return 'THREE';
    if (numericRating >= 1.5) return 'TWO';
    return 'ONE';
}

function parseReviewDate(dateString) {
    // Handle various date formats that Google might return
    if (!dateString) {
        console.warn('⚠️ Empty date string provided');
        return new Date(); // Fallback to current date
    }
    
    try {
        // Always log the original date string for debugging
        console.log('🔍 Google date string:', dateString);
        
        // First try standard Date parsing
        let date = new Date(dateString);
        
        // Log the parsed result for debugging
        console.log('🔍 Parsed date result:', {
            original: dateString,
            parsed: date.toISOString(),
            valid: !isNaN(date.getTime()),
            local: date.toLocaleDateString(),
            timeAgo: getTimeAgoDebug(date)
        });
        
        // Validate the parsed date
        if (!isNaN(date.getTime())) {
            // Check if the date seems reasonable (not too far in the past/future)
            const now = new Date();
            const diffYears = Math.abs(now.getFullYear() - date.getFullYear());
            
            if (diffYears > 10) {
                console.warn('⚠️ Date seems unreasonable, trying alternative parsing:', {
                    parsed: date.toISOString(),
                    yearsOff: diffYears
                });
            } else {
                return date;
            }
        }
        
        console.warn('⚠️ Standard Date parsing failed or unreasonable, trying manual parsing for:', dateString);
        
        // Try parsing RFC3339/ISO 8601 format manually
        const isoRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3,6}))?(?:Z|([+-]\d{2}):?(\d{2}))$/;
        const match = dateString.match(isoRegex);
        
        if (match) {
            console.log('🔍 Manual parsing components:', match);
            const [, year, month, day, hour, minute, second, microseconds, tzHour, tzMinute] = match;
            
            // Convert microseconds to milliseconds (take first 3 digits)
            const millisecond = microseconds ? parseInt(microseconds.substring(0, 3).padEnd(3, '0')) : 0;
            
            // Create date in local timezone first
            date = new Date(
                parseInt(year),
                parseInt(month) - 1, // Month is 0-indexed
                parseInt(day),
                parseInt(hour),
                parseInt(minute),
                parseInt(second),
                millisecond
            );
            
            console.log('🔍 Manual parsing result before timezone adjustment:', date.toISOString());
            
            // Handle timezone offset
            if (tzHour !== undefined && tzMinute !== undefined) {
                const tzSign = tzHour.startsWith('-') ? -1 : 1;
                const tzOffsetMinutes = tzSign * (Math.abs(parseInt(tzHour)) * 60 + parseInt(tzMinute));
                console.log('🔍 Timezone offset minutes:', tzOffsetMinutes);
                
                // Adjust for timezone - convert to UTC then to local
                const utcTime = date.getTime() - (tzOffsetMinutes * 60000);
                date = new Date(utcTime);
            }
            
            console.log('🔍 Final manual parsing result:', date.toISOString());
        } else {
            console.warn('⚠️ Could not parse date string with regex:', dateString);
            date = new Date(); // Fallback to current date
        }
        
        // Final validation
        if (isNaN(date.getTime())) {
            console.warn('⚠️ Final date is invalid, using current date');
            date = new Date();
        }
        
        return date;
    } catch (error) {
        console.error('❌ Error parsing date:', dateString, error);
        return new Date(); // Fallback to current date
    }
}

// Debug version of getTimeAgo for troubleshooting
function getTimeAgoDebug(date) {
    if (!date || isNaN(date.getTime())) {
        return 'Invalid date';
    }
    
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
}

function getTimeAgo(date) {
    // Validate the input date
    if (!date || isNaN(date.getTime())) {
        console.warn('⚠️ Invalid date passed to getTimeAgo:', date);
        return 'Unknown date';
    }
    
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffTime / (1000 * 60));
    
    // Only debug log for unusual time differences
    if (diffDays > 365 * 2) { // Only log if more than 2 years old
        console.log('⏰ Unusual date detected:', {
            reviewDate: date.toISOString(),
            diffDays: diffDays
        });
    }
    
    if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
}

// Toast Notification Functions
function showError(message, title = null) {
    // Create a toast notification for errors
    const toast = document.createElement('div');
    const titleHtml = title ? `<div style="font-weight: bold; margin-bottom: 5px;">${title}</div>` : '';
    toast.innerHTML = `
        <div style="position: fixed; top: 20px; right: 20px; background: #dc3545; color: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; max-width: 400px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span>❌</span>
                <div style="flex: 1;">
                    ${titleHtml}
                    <span>${message}</span>
                </div>
                <button data-action="close-toast" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; padding: 0;">×</button>
            </div>
        </div>
    `;
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 5000);
}

function showSuccess(message) {
    // Create a toast notification for success
    const toast = document.createElement('div');
    toast.innerHTML = `
        <div style="position: fixed; top: 20px; right: 20px; background: #28a745; color: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; max-width: 400px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span>✅</span>
                <span style="flex: 1;">${message}</span>
                <button data-action="close-toast" style="background: none; border: none; color: white; cursor: pointer; font-size: 1.2rem; padding: 0;">×</button>
            </div>
        </div>
    `;
    document.body.appendChild(toast);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3000);
}

// GMB Service Testing Functions
function testGMBService() {
    console.log('🔍 Testing GMB service access...');
    const resultsDiv = document.getElementById('api-test-results');
    const outputPre = document.getElementById('test-output');
    
    resultsDiv.style.display = 'block';
    outputPre.textContent = 'Testing Google My Business service access...\n';

    fetch('/api/gmb/verify')
        .then(response => response.json())
        .then(data => {
            const timestamp = new Date().toISOString();
            let output = `[${timestamp}] GMB Access Test Results:\n`;
            output += `Status: ${data.success ? '✅ SUCCESS' : '❌ FAILED'}\n`;
            output += `Message: ${data.message}\n`;
            
            if (data.data) {
                output += `Verified: ${data.data.verified}\n`;
            }
            
            outputPre.textContent = output;
            
            // Update status indicator
            const statusDiv = document.getElementById('gmb-status');
            if (data.success) {
                statusDiv.innerHTML = '<p style="color: #28a745;">✅ Google My Business service is accessible</p>';
            } else {
                statusDiv.innerHTML = '<p style="color: #dc3545;">❌ Google My Business service access failed</p>';
            }
        })
        .catch(error => {
            console.error('❌ Error testing GMB service:', error);
            outputPre.textContent = `Error testing GMB service: ${error.message}`;
            
            const statusDiv = document.getElementById('gmb-status');
            statusDiv.innerHTML = '<p style="color: #dc3545;">❌ Error testing GMB service</p>';
        });
}

function checkGMBStatus() {
    // Check if already loaded or loading
    if (AppState.gmbStatusLoaded && AppState.gmbStatusData) {
        console.log('✅ GMB status already loaded, using cache');
        displayGMBStatus(AppState.gmbStatusData);
        return;
    }
    
    if (AppState.isLoadingGMBStatus) {
        console.log('⏳ GMB status already loading, skipping duplicate call');
        return;
    }

    console.log('🔍 Checking GMB service status...');
    AppState.setLoading('GMBStatus', true);
    
    const resultsDiv = document.getElementById('api-test-results');
    const outputPre = document.getElementById('test-output');
    
    resultsDiv.style.display = 'block';
    outputPre.textContent = 'Checking GMB service status...\n';

    fetch('/api/gmb/status')
        .then(response => response.json())
        .then(data => {
            // Cache the GMB status data
            AppState.gmbStatusData = data;
            AppState.gmbStatusLoaded = true;
            
            displayGMBStatus(data);
            console.log('✅ GMB status loaded and cached');
        })
        .catch(error => {
            console.error('❌ Error checking GMB status:', error);
            const outputPre = document.getElementById('test-output');
            outputPre.textContent = `Error checking GMB status: ${error.message}`;
            
            const statusDiv = document.getElementById('gmb-status');
            statusDiv.innerHTML = '<p style="color: #dc3545;">❌ Error checking service status</p>';
        })
        .finally(() => {
            AppState.setLoading('GMBStatus', false);
        });
}

function displayGMBStatus(data) {
    const outputPre = document.getElementById('test-output');
    const statusDiv = document.getElementById('gmb-status');
    
    const timestamp = new Date().toISOString();
    let output = `[${timestamp}] GMB Service Status:\n`;
    output += `Success: ${data.success ? '✅ YES' : '❌ NO'}\n`;
    output += `Message: ${data.message}\n`;
    
    if (data.data) {
        output += `\nService Details:\n`;
        output += `- Authenticated: ${data.data.authenticated ? '✅' : '❌'}\n`;
        output += `- Has Access Token: ${data.data.hasAccessToken ? '✅' : '❌'}\n`;
        output += `- User Name: ${data.data.userName}\n`;
        output += `- User Email: ${data.data.userEmail}\n`;
        output += `- Scopes: ${JSON.stringify(data.data.scopes, null, 2)}\n`;
    }
    
    outputPre.textContent = output;
    
    // Update status indicator
    if (data.success && data.data.authenticated && data.data.hasAccessToken) {
        statusDiv.innerHTML = '<p style="color: #28a745;">✅ All systems operational</p>';
    } else {
        statusDiv.innerHTML = '<p style="color: #ffc107;">⚠️ Service status warning - check test results</p>';
    }
}

// Debug function for locations
function debugLocations() {
    console.log('🔍 Starting location debug...');
    const resultsDiv = document.getElementById('api-test-results');
    const outputPre = document.getElementById('test-output');
    
    resultsDiv.style.display = 'block';
    outputPre.textContent = 'Debugging business locations step by step...\n';
    
    // Step 1: Test basic authentication
    fetch('/auth/profile')
        .then(response => response.json())
        .then(userData => {
            outputPre.textContent += `\n✅ STEP 1: Authentication\n`;
            outputPre.textContent += `- User: ${userData.user?.displayName || 'Unknown'}\n`;
            outputPre.textContent += `- Email: ${userData.user?.emails?.[0]?.value || 'Unknown'}\n`;
            outputPre.textContent += `- Has Access Token: ${userData.user?.accessToken ? 'Yes' : 'No'}\n`;
            
            // Step 2: Test GMB service
            outputPre.textContent += `\n🔍 STEP 2: Testing GMB Service...\n`;
            return fetch('/api/gmb/verify');
        })
        .then(response => response.json())
        .then(gmbData => {
            outputPre.textContent += `- GMB Access: ${gmbData.success ? '✅ Working' : '❌ Failed'}\n`;
            if (!gmbData.success) {
                outputPre.textContent += `- Error: ${gmbData.message}\n`;
            }
            
            // Step 3: Try to fetch locations with detailed logging
            outputPre.textContent += `\n🔍 STEP 3: Fetching Locations...\n`;
            return fetch('/api/reviews/locations');
        })
        .then(response => {
            outputPre.textContent += `- API Response Status: ${response.status} (${response.statusText})\n`;
            return response.json();
        })
        .then(locationData => {
            outputPre.textContent += `- API Success: ${locationData.success ? '✅ Yes' : '❌ No'}\n`;
            
            if (locationData.success) {
                const locations = locationData.data?.locations || [];
                outputPre.textContent += `- Found Locations: ${locations.length}\n`;
                
                if (locations.length === 0) {
                    outputPre.textContent += `\n⚠️ DIAGNOSIS: No business locations found!\n`;
                    outputPre.textContent += `\nThis means:\n`;
                    outputPre.textContent += `1. Your Google account might not have a Google Business Profile\n`;
                    outputPre.textContent += `2. Or your business profile has no locations added\n`;
                    outputPre.textContent += `\n🛠️ SOLUTION:\n`;
                    outputPre.textContent += `1. Go to business.google.com\n`;
                    outputPre.textContent += `2. Create a Google Business Profile\n`;
                    outputPre.textContent += `3. Add your business location\n`;
                    outputPre.textContent += `4. Verify your business\n`;
                    outputPre.textContent += `5. Then try loading locations again\n`;
                } else {
                    outputPre.textContent += `\n✅ DIAGNOSIS: Found ${locations.length} locations!\n`;
                    locations.forEach((loc, index) => {
                        outputPre.textContent += `${index + 1}. ${loc.displayName || loc.name}\n`;
                    });
                }
            } else {
                outputPre.textContent += `- Error: ${locationData.message || 'Unknown error'}\n`;
                outputPre.textContent += `\n❌ DIAGNOSIS: API call failed!\n`;
                
                if (locationData.message?.includes('401') || locationData.message?.includes('Unauthorized')) {
                    outputPre.textContent += `\n🛠️ SOLUTION: Authentication issue\n`;
                    outputPre.textContent += `1. Log out and log back in with Google\n`;
                    outputPre.textContent += `2. Make sure to grant all requested permissions\n`;
                } else if (locationData.message?.includes('403') || locationData.message?.includes('Forbidden')) {
                    outputPre.textContent += `\n🛠️ SOLUTION: Permission issue\n`;
                    outputPre.textContent += `1. Make sure your Google account owns or manages a business\n`;
                    outputPre.textContent += `2. Check that you granted business management permissions\n`;
                } else {
                    outputPre.textContent += `\n🛠️ SOLUTION: Server or API issue\n`;
                    outputPre.textContent += `1. Check server logs for more details\n`;
                    outputPre.textContent += `2. Verify Google API credentials are correct\n`;
                }
            }
        })
        .catch(error => {
            console.error('❌ Debug locations error:', error);
            outputPre.textContent += `\n❌ DEBUG ERROR: ${error.message}\n`;
            
            if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
                outputPre.textContent += `\n🛠️ SOLUTION: Network issue\n`;
                outputPre.textContent += `1. Check your internet connection\n`;
                outputPre.textContent += `2. Make sure the server is running\n`;
                outputPre.textContent += `3. Check for firewall/proxy issues\n`;
            }
        });
}

// Cache Management Functions
function getCacheStats() {
    // Check if already loaded or loading
    if (AppState.cacheStatsLoaded && AppState.cacheStatsData) {
        console.log('✅ Cache stats already loaded, using cache');
        displayCacheStats(AppState.cacheStatsData);
        return;
    }
    
    if (AppState.isLoadingCacheStats) {
        console.log('⏳ Cache stats already loading, skipping duplicate call');
        return;
    }

    console.log('📊 Getting cache statistics...');
    AppState.setLoading('CacheStats', true);
    
    const outputDiv = document.getElementById('cache-stats-output');
    const resultsDiv = document.getElementById('cache-stats-results');
    
    // Show loading state
    resultsDiv.style.display = 'block';
    outputDiv.innerHTML = '<p style="color: #666;">Loading cache statistics...</p>';
    
    fetch('/api/gmb/cache/stats')
        .then(response => response.json())
        .then(data => {
            console.log('✅ Cache stats retrieved:', data);
            
            // Cache the data (short cache since cache stats change frequently)
            AppState.cacheStatsData = data;
            AppState.cacheStatsLoaded = true;
            
            displayCacheStats(data);
            console.log('✅ Cache stats loaded and cached');
        })
        .catch(error => {
            console.error('❌ Error getting cache stats:', error);
            const outputDiv = document.getElementById('cache-stats-output');
            outputDiv.innerHTML = `<p style="color: #dc3545;">❌ Network error: ${error.message}</p>`;
        })
        .finally(() => {
            AppState.setLoading('CacheStats', false);
        });
}

function displayCacheStats(data) {
    const outputDiv = document.getElementById('cache-stats-output');
    
    if (data.success) {
        let output = '';
        output += `<p><strong>Cache Size:</strong> ${data.data.size} entries</p>`;
        output += `<p><strong>Cache Keys:</strong></p>`;
        
        if (data.data.entries.length > 0) {
            output += '<ul style="margin: 10px 0; padding-left: 20px;">';
            data.data.entries.forEach(key => {
                output += `<li style="margin: 5px 0; font-family: monospace;">${key}</li>`;
            });
            output += '</ul>';
        } else {
            output += '<p style="color: #666; font-style: italic;">No cached entries</p>';
        }
        
        output += `<p style="margin-top: 15px;"><em>Cache helps reduce API calls and avoid rate limits!</em></p>`;
        
        outputDiv.innerHTML = output;
    } else {
        outputDiv.innerHTML = `<p style="color: #dc3545;">❌ Error: ${data.message}</p>`;
    }
}

function clearCache() {
    console.log('🗑️ Clearing cache...');
    
    const outputDiv = document.getElementById('cache-stats-output');
    const resultsDiv = document.getElementById('cache-stats-results');
    
    if (!confirm('Are you sure you want to clear the cache? This will force fresh API calls for all requests.')) {
        return;
    }
    
    // Show loading state
    resultsDiv.style.display = 'block';
    outputDiv.innerHTML = '<p style="color: #666;">Clearing cache...</p>';
    
    fetch('/api/gmb/cache/clear', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
        .then(response => response.json())
        .then(data => {
            console.log('✅ Cache clear result:', data);
            
                                if (data.success) {
                        outputDiv.innerHTML = `
                            <p style="color: #28a745;">✅ ${data.message}</p>
                            <p style="margin-top: 10px;"><em>Next API calls will fetch fresh data from Google.</em></p>
                        `;
                        
                        // Clear JavaScript cache as well since server cache is cleared
                        console.log('🔄 Clearing JavaScript cache after server cache clear...');
                        AppState.reviewsData = {}; // Clear reviews cache
                        AppState.gmbStatusLoaded = false;
                        AppState.gmbStatusData = null;
                        AppState.cacheStatsLoaded = false;
                        AppState.cacheStatsData = null;
                        // Keep user and location data as they don't change often
                        
                        // Show success toast
                        showSuccess('Cache cleared successfully!');
                        
                        // Auto-refresh cache stats after 1 second
                        setTimeout(() => {
                            getCacheStats();
                        }, 1000);
                    } else {
                outputDiv.innerHTML = `<p style="color: #dc3545;">❌ Error: ${data.message}</p>`;
                showError('Failed to clear cache: ' + data.message);
            }
        })
        .catch(error => {
            console.error('❌ Error clearing cache:', error);
            outputDiv.innerHTML = `<p style="color: #dc3545;">❌ Network error: ${error.message}</p>`;
            showError('Network error clearing cache');
        });
}

// Utility Functions
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 10000;
        max-width: 300px;
        word-wrap: break-word;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    // Set background color based on type
    switch (type) {
        case 'success':
            toast.style.background = '#28a745';
            break;
        case 'error':
            toast.style.background = '#dc3545';
            break;
        case 'warning':
            toast.style.background = '#ffc107';
            toast.style.color = '#333';
            break;
        default:
            toast.style.background = '#17a2b8';
    }
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 4000);
}

// Clear server cache
async function clearServerCache() {
    try {
        console.log('🗑️ Clearing server cache...');
        const response = await fetch('/api/gmb/cache/clear', { method: 'POST' });
        
        if (response.ok) {
            console.log('✅ Server cache cleared successfully');
        } else {
            console.warn('⚠️ Failed to clear server cache');
        }
    } catch (error) {
        console.error('❌ Error clearing server cache:', error);
    }
}

// Clear pagination cache
async function clearPaginationCache(locationId = null) {
    try {
        const body = locationId ? { locationName: locationId } : {};
        const response = await fetch('/api/reviews/cache/clear', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        // Only log errors, not success
        if (!response.ok) {
            console.warn('⚠️ Failed to clear pagination cache');
        }
    } catch (error) {
        console.error('❌ Error clearing pagination cache:', error);
    }
}

// Check reply history and show missing replies
function checkReplyHistory() {
    const replyHistory = JSON.parse(sessionStorage.getItem('replyHistory') || '[]');
    
    if (replyHistory.length === 0) {
        console.log('📝 No reply history found');
        return;
    }
    
    console.log(`📝 Reply History: ${replyHistory.length} replies posted this session`);
    
    // Show recent replies
    const recentReplies = replyHistory.slice(-10); // Last 10 replies
    recentReplies.forEach(reply => {
        const timeAgo = Math.round((new Date() - new Date(reply.timestamp)) / 1000 / 60);
        console.log(`📝 ${reply.reviewId.substring(0, 8)}... replied ${timeAgo}min ago: "${reply.replyText.substring(0, 50)}..."`);
    });
}

// Clear reply history
function clearReplyHistory() {
    sessionStorage.removeItem('replyHistory');
    console.log('🗑️ Reply history cleared');
    showSuccess('Reply history cleared');
}

// Get cache statistics
async function getCacheStats() {
    try {
        console.log('📊 Getting cache statistics...');
        
        const outputDiv = document.getElementById('cache-stats-output');
        const resultsDiv = document.getElementById('cache-stats-results');
        
        if (!outputDiv || !resultsDiv) {
            console.error('❌ Cache stats elements not found');
            return;
        }
        
        // Show results section
        resultsDiv.style.display = 'block';
        
        // Get frontend cache stats
        const frontendStats = {
            reviewsDataKeys: Object.keys(AppState.reviewsData),
            reviewsDataSize: Object.keys(AppState.reviewsData).length,
            reviewsPaginationKeys: Object.keys(AppState.reviewsPagination || {}),
            reviewsPaginationSize: Object.keys(AppState.reviewsPagination || {}).length,
            bypassCacheUntil: AppState.bypassCacheUntil,
            currentLocationId: AppState.currentLocationId,
            currentFilter: AppState.currentFilter
        };
        
        // Get backend cache stats
        let backendStats = {};
        try {
            const response = await fetch('/api/gmb/cache/stats');
            if (response.ok) {
                backendStats = await response.json();
            }
        } catch (error) {
            console.warn('⚠️ Could not fetch backend cache stats:', error);
            backendStats = { error: 'Could not fetch backend stats' };
        }
        
        // Display stats
        outputDiv.innerHTML = `
            <div style="margin-bottom: 20px;">
                <h6 style="color: #495057; margin-bottom: 10px;">Frontend Cache:</h6>
                <pre style="background: #ffffff; padding: 10px; border-radius: 5px; font-size: 0.8rem; overflow-x: auto;">${JSON.stringify(frontendStats, null, 2)}</pre>
            </div>
            <div>
                <h6 style="color: #495057; margin-bottom: 10px;">Backend Cache:</h6>
                <pre style="background: #ffffff; padding: 10px; border-radius: 5px; font-size: 0.8rem; overflow-x: auto;">${JSON.stringify(backendStats, null, 2)}</pre>
            </div>
        `;
        
        console.log('✅ Cache statistics displayed');
        
    } catch (error) {
        console.error('❌ Error getting cache statistics:', error);
        showToast('Error getting cache statistics', 'error');
    }
}

// Debug pagination state
function debugPagination() {
    const locationId = AppState.currentLocationId;
    const filter = AppState.currentFilter;
    const cacheKey = locationId ? `${locationId}:${filter}` : null;
    
    console.log('🔍 Pagination Debug Information:');
    console.log('📍 Current Location ID:', locationId);
    console.log('🔍 Current Filter:', filter);
    console.log('🔑 Cache Key:', cacheKey);
    
    if (cacheKey) {
        const reviewsData = AppState.reviewsData[cacheKey];
        const paginationData = AppState.reviewsPagination[cacheKey];
        
        console.log('📊 Reviews Data:', {
            exists: !!reviewsData,
            reviewCount: reviewsData?.reviews?.length || 0,
            keys: reviewsData ? Object.keys(reviewsData) : []
        });
        
        console.log('📄 Pagination Data:', {
            exists: !!paginationData,
            data: paginationData
        });
        
        // Show debug info in a toast
        const debugInfo = `
Location: ${locationId}
Filter: ${filter}
Cache Key: ${cacheKey}
Reviews Count: ${reviewsData?.reviews?.length || 0}
Has Next Page: ${paginationData?.hasNextPage || false}
Next Page Token: ${paginationData?.nextPageToken || 'none'}
        `.trim();
        
        showToast(`🔍 Pagination Debug:\n${debugInfo}`, 'info');
        
        // Also log to console for detailed inspection
        console.log('📋 Full Debug Info:', debugInfo);
    } else {
        console.log('❌ No location selected or cache key available');
        showToast('No location selected. Please select a location first.', 'warning');
    }
}
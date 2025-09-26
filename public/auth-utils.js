// Authentication utilities for dual authentication system
// Handles both app authentication (Supabase) and Google OAuth

class AuthManager {
    constructor() {
        this.appToken = localStorage.getItem('appAuthToken');
        this.appUser = null;
        this.googleUser = null;
        this.isAppAuthenticated = false;
        this.isGoogleAuthenticated = false;
        this.subscriptionStatus = 'free';
    }

    // App Authentication Methods
    async checkAppAuth() {
        if (!this.appToken) {
            // Don't set isAppAuthenticated to false if we don't have a token
            // Let the dashboard handle the initial authentication check
            return false;
        }

        try {
            const response = await fetch('/app-auth/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: this.appToken })
            });

            const result = await response.json();
            
            if (result.success) {
                this.appUser = result.user;
                this.isAppAuthenticated = true;
                this.subscriptionStatus = result.user.subscription_status;
                return true;
            } else {
                this.clearAppAuth();
                return false;
            }
        } catch (error) {
            console.error('App auth check error:', error);
            this.clearAppAuth();
            return false;
        }
    }

    async checkGoogleAuth() {
        try {
            const response = await fetch('/api/user');
            const result = await response.json();
            
            if (result.user) {
                this.googleUser = result.user;
                this.isGoogleAuthenticated = true;
                return true;
            } else {
                // Don't set isGoogleAuthenticated to false if the check fails
                // Let the dashboard handle the initial authentication check
                return false;
            }
        } catch (error) {
            console.error('Google auth check error:', error);
            // Don't set isGoogleAuthenticated to false if there's an error
            // Let the dashboard handle the initial authentication check
            return false;
        }
    }

    async checkBothAuth() {
        const [appAuth, googleAuth] = await Promise.all([
            this.checkAppAuth(),
            this.checkGoogleAuth()
        ]);

        // If both are connected, update the Google Business connection status in the backend
        if (appAuth && googleAuth && this.appUser && !this.appUser.google_business_connected) {
            this.updateGoogleBusinessConnection(true);
        }

        return {
            app: appAuth,
            google: googleAuth,
            both: appAuth && googleAuth
        };
    }

    clearAppAuth() {
        this.appToken = null;
        this.appUser = null;
        this.isAppAuthenticated = false;
        this.subscriptionStatus = 'free';
        localStorage.removeItem('appAuthToken');
    }

    async logoutApp() {
        try {
            if (this.appToken) {
                await fetch('/app-auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.appToken}`
                    }
                });
            }
        } catch (error) {
            console.error('App logout error:', error);
        } finally {
            this.clearAppAuth();
        }
    }

    async logoutGoogle() {
        try {
            await fetch('/auth/logout');
            this.googleUser = null;
            this.isGoogleAuthenticated = false;
        } catch (error) {
            console.error('Google logout error:', error);
        }
    }

    async logoutBoth() {
        await Promise.all([
            this.logoutApp(),
            this.logoutGoogle()
        ]);
        
        // Redirect to login page
        window.location.href = '/';
    }

    // Update Google Business connection status in backend
    async updateGoogleBusinessConnection(connected) {
        try {
            if (!this.appToken) return false;

            await fetch('/app-auth/update-google-connection', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.appToken}`
                },
                body: JSON.stringify({
                    connected: connected,
                    google_email: this.googleUser?.emails?.[0]?.value
                })
            });

            // Update local app user object
            if (this.appUser) {
                this.appUser.google_business_connected = connected;
            }

            return true;
        } catch (error) {
            console.error('Failed to update Google Business connection:', error);
            return false;
        }
    }

    // Utility methods
    getAuthHeaders() {
        const headers = {};
        if (this.appToken) {
            headers['Authorization'] = `Bearer ${this.appToken}`;
        }
        return headers;
    }

    hasSubscription(requiredPlans = ['premium', 'enterprise']) {
        return requiredPlans.includes(this.subscriptionStatus);
    }

    isSubscriptionActive() {
        if (this.subscriptionStatus === 'free') return true; // Free is always "active"
        
        if (this.appUser && this.appUser.subscription_expires_at) {
            const expiresAt = new Date(this.appUser.subscription_expires_at);
            const now = new Date();
            return expiresAt > now;
        }
        
        return true; // Assume active if no expiration date
    }

    getSubscriptionInfo() {
        return {
            status: this.subscriptionStatus,
            expiresAt: this.appUser?.subscription_expires_at,
            isActive: this.isSubscriptionActive(),
            hasGoogleBusiness: this.isGoogleAuthenticated // Show as connected if Google auth is active
        };
    }

    // UI Helper methods
    updateAuthUI() {
        const authStatus = document.getElementById('auth-status');
        const userInfo = document.getElementById('user-info');
        const subscriptionInfo = document.getElementById('subscription-info');

        if (authStatus) {
            if (this.isAppAuthenticated && this.isGoogleAuthenticated) {
                authStatus.innerHTML = `
                    <div class="auth-success">
                        <span class="status-icon">✅</span>
                        <span>Fully Connected</span>
                    </div>
                `;
            } else if (this.isAppAuthenticated) {
                authStatus.innerHTML = `
                    <div class="auth-partial">
                        <span class="status-icon">⚠️</span>
                        <span>App Connected - <a href="/auth/google">Connect Google Business</a></span>
                    </div>
                `;
            } else {
                authStatus.innerHTML = `
                    <div class="auth-error">
                        <span class="status-icon">❌</span>
                        <span>Not Connected - <a href="/">Login</a></span>
                    </div>
                `;
            }
        }

        if (userInfo && this.appUser) {
            userInfo.innerHTML = `
                <div class="user-details">
                    <div class="user-email">${this.appUser.email}</div>
                    <div class="user-plan">${this.subscriptionStatus.toUpperCase()} Plan</div>
                </div>
            `;
        }

        if (subscriptionInfo) {
            const subInfo = this.getSubscriptionInfo();
            subscriptionInfo.innerHTML = `
                <div class="subscription-details">
                    <div class="plan-status ${subInfo.status}">${subInfo.status.toUpperCase()}</div>
                    ${subInfo.expiresAt ? `<div class="expires">Expires: ${new Date(subInfo.expiresAt).toLocaleDateString()}</div>` : ''}
                    <div class="google-status ${subInfo.hasGoogleBusiness ? 'connected' : 'disconnected'}">
                        Google Business: ${subInfo.hasGoogleBusiness ? 'Connected' : 'Not Connected'}
                    </div>
                </div>
            `;
        }
    }

    showSubscriptionModal(requiredPlan = 'premium') {
        const modal = document.createElement('div');
        modal.className = 'subscription-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Subscription Required</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p>This feature requires a ${requiredPlan} subscription.</p>
                    <p>Your current plan: <strong>${this.subscriptionStatus}</strong></p>
                    <div class="modal-actions">
                        <button class="btn btn-primary" onclick="window.location.href='/subscription'">
                            Upgrade Now
                        </button>
                        <button class="btn btn-secondary modal-close">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close modal handlers
        modal.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                document.body.removeChild(modal);
            });
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });
    }

    // API request wrapper with authentication
    async apiRequest(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...this.getAuthHeaders(),
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (response.status === 401) {
            // Handle authentication errors
            const result = await response.json();
            if (result.error === 'SUBSCRIPTION_REQUIRED' || result.error === 'SUBSCRIPTION_EXPIRED') {
                this.showSubscriptionModal();
                throw new Error('Subscription required');
            } else {
                // Redirect to login
                window.location.href = '/';
                throw new Error('Authentication required');
            }
        }

        return response;
    }
}

// Global auth manager instance
const authManager = new AuthManager();

// Initialize authentication on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔐 Initializing authentication...');
    
    const authStatus = await authManager.checkBothAuth();
    console.log('Auth status:', authStatus);
    
    authManager.updateAuthUI();
    
    // Redirect to login if not authenticated (except on login page)
        if (!window.location.pathname.includes('index.html') && !authStatus.app) {
        console.log('Redirecting to login...');
        window.location.href = '/';
        return;
    }
    
    // Show warning if only partially authenticated
    if (authStatus.app && !authStatus.google && !window.location.pathname.includes('index.html')) {
        console.log('⚠️ Partial authentication - Google Business not connected');
        // Could show a banner or notification here
    }
});

// Export for use in other scripts
window.authManager = authManager;
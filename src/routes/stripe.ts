import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { requireAppAuth } from '../middleware/appAuth';

const router = express.Router();

// Initialize Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY environment variable is not set');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Create checkout session (no auth required)
 * POST /api/stripe/create-checkout-session
 */
router.post('/create-checkout-session', express.json(), async (req, res) => {
  try {
    const { plan } = req.body;
    
    if (!plan) {
      return res.status(400).json({ 
        success: false, 
        error: 'MISSING_FIELDS', 
        message: 'Plan is required' 
      });
    }

    if (!['monthly', 'yearly'].includes(plan)) {
      return res.status(400).json({ 
        success: false, 
        error: 'INVALID_PLAN', 
        message: 'Plan must be monthly or yearly' 
      });
    }

    const priceId = plan === 'yearly' 
      ? process.env.STRIPE_YEARLY_PRICE_ID 
      : process.env.STRIPE_MONTHLY_PRICE_ID;

    if (!priceId) {
      return res.status(500).json({ 
        success: false, 
        error: 'MISSING_PRICE_ID', 
        message: 'Price ID not configured' 
      });
    }
    
    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price: priceId,
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/set-password?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?cancelled=true`,
      metadata: {
        plan: plan
      }
    });
    
    res.json({ 
      success: true, 
      sessionId: session.id 
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'CHECKOUT_ERROR', 
      message: 'Failed to create checkout session' 
    });
  }
});

/**
 * Get session details for password setup
 * GET /api/stripe/session-details?session_id=xxx
 */
router.get('/session-details', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'MISSING_SESSION_ID', 
        message: 'Session ID is required' 
      });
    }
    
    const session = await stripe.checkout.sessions.retrieve(session_id as string);
    
    console.log('Session details for', session_id, ':', {
      customer_email: session.customer_email,
      customer: session.customer,
      metadata: session.metadata,
      payment_status: session.payment_status
    });
    
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ 
        success: false, 
        error: 'PAYMENT_NOT_COMPLETED', 
        message: 'Payment not completed' 
      });
    }
    
    // Get email from customer object if not in session
    let email = session.customer_email;
    if (!email && session.customer) {
      try {
        const customer = await stripe.customers.retrieve(session.customer as string);
        email = (customer as any).email;
        console.log('Retrieved email from customer:', email);
      } catch (error) {
        console.error('Error retrieving customer:', error);
      }
    }
    
    res.json({
      success: true,
      email: email,
      plan: session.metadata?.plan
    });
  } catch (error) {
    console.error('Session details error:', error);
    res.status(400).json({ 
      success: false, 
      error: 'INVALID_SESSION', 
      message: 'Invalid session' 
    });
  }
});

/**
 * Get subscription details for authenticated user
 * GET /api/stripe/subscription
 */
router.get('/subscription', requireAppAuth, async (req, res) => {
  try {
    console.log('🔍 Getting subscription for user...');
    const userId = (req as any).appUserId;
    console.log('👤 User ID:', userId);
    
    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('❌ Database error:', userError);
      return res.status(500).json({ 
        success: false, 
        error: 'DATABASE_ERROR', 
        message: 'Database error: ' + userError.message 
      });
    }

    if (!user) {
      console.error('❌ User not found for ID:', userId);
      return res.status(404).json({ 
        success: false, 
        error: 'USER_NOT_FOUND', 
        message: 'User not found' 
      });
    }

    console.log('👤 User found:', { 
      id: user.id, 
      email: user.email, 
      subscription_status: user.subscription_status,
      stripe_subscription_id: user.stripe_subscription_id 
    });

    if (!user.stripe_subscription_id) {
      return res.json({
        success: true,
        subscription: null,
        message: 'No active subscription found'
      });
    }

    // Get subscription details from Stripe with expanded data
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id, {
        expand: ['latest_invoice', 'schedule', 'items.data']
      });
      console.log('📊 Raw Stripe subscription data:', JSON.stringify(subscription, null, 2));
    } catch (stripeError: any) {
      console.error('Stripe subscription retrieve error:', stripeError);
      
      // If subscription doesn't exist, return null
      if (stripeError.code === 'resource_missing') {
        return res.json({
          success: true,
          subscription: null,
          message: 'Subscription not found in Stripe'
        });
      }
      
      throw stripeError;
    }
    
    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Try to get the end date from multiple sources
    let endDate = null;
    
    // For cancel_at_period_end subscriptions, use current_period_end (when access ends)
    if (subscription.cancel_at_period_end) {
      // First try subscription items current_period_end
      if ((subscription as any).items && (subscription as any).items.data && (subscription as any).items.data.length > 0) {
        const firstItem = (subscription as any).items.data[0];
        if (firstItem.current_period_end) {
          endDate = safeToISOString(firstItem.current_period_end);
          console.log('📅 Got access end date from subscription item current_period_end:', endDate);
        }
      }
      
      // Fallback to subscription current_period_end
      if (!endDate && (subscription as any).current_period_end) {
        endDate = safeToISOString((subscription as any).current_period_end);
        console.log('📅 Got access end date from subscription current_period_end:', endDate);
      }
    } else {
      // For regular subscriptions, use current_period_end for next billing
      // First try subscription items current_period_end
      if ((subscription as any).items && (subscription as any).items.data && (subscription as any).items.data.length > 0) {
        const firstItem = (subscription as any).items.data[0];
        if (firstItem.current_period_end) {
          endDate = safeToISOString(firstItem.current_period_end);
          console.log('📅 Got next billing date from subscription item current_period_end:', endDate);
        }
      }
      
      // Fallback to subscription current_period_end
      if (!endDate && (subscription as any).current_period_end) {
        endDate = safeToISOString((subscription as any).current_period_end);
        console.log('📅 Got next billing date from subscription current_period_end:', endDate);
      }
    }
    
    console.log('📅 Final end date determined:', endDate);

    // Get the actual plan from Stripe subscription items
    let actualPlan = user.subscription_plan; // fallback to database value
    if ((subscription as any).items && (subscription as any).items.data && (subscription as any).items.data.length > 0) {
      const firstItem = (subscription as any).items.data[0];
      if (firstItem.price && firstItem.price.recurring) {
        const interval = firstItem.price.recurring.interval;
        actualPlan = interval; // 'month' or 'year'
        console.log('📊 Got plan from Stripe subscription item:', actualPlan);
      }
    }

    res.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        current_period_start: safeToISOString((subscription as any).current_period_start),
        current_period_end: endDate, // Use the calculated endDate (from subscription items)
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: safeToISOString(subscription.canceled_at),
        plan: actualPlan,
        customer_id: user.stripe_customer_id,
        end_date: endDate
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'SUBSCRIPTION_ERROR', 
      message: 'Failed to get subscription details' 
    });
  }
});

/**
 * Cancel subscription
 * POST /api/stripe/cancel-subscription
 */
router.post('/cancel-subscription', requireAppAuth, async (req, res) => {
  try {
    console.log('🔍 Cancelling subscription for user...');
    const userId = (req as any).appUserId;
    console.log('👤 User ID:', userId);
    
    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) {
      console.error('❌ Database error:', userError);
      return res.status(500).json({ 
        success: false, 
        error: 'DATABASE_ERROR', 
        message: 'Database error: ' + userError.message 
      });
    }

    if (!user) {
      console.error('❌ User not found for ID:', userId);
      return res.status(404).json({ 
        success: false, 
        error: 'USER_NOT_FOUND', 
        message: 'User not found' 
      });
    }

    console.log('👤 User found:', { 
      id: user.id, 
      email: user.email, 
      subscription_status: user.subscription_status,
      stripe_subscription_id: user.stripe_subscription_id 
    });

    if (!user.stripe_subscription_id) {
      console.log('❌ No Stripe subscription ID found');
      return res.status(400).json({ 
        success: false, 
        error: 'NO_SUBSCRIPTION', 
        message: 'No active subscription to cancel' 
      });
    }

    // Cancel subscription at period end
    console.log('🔄 Cancelling Stripe subscription:', user.stripe_subscription_id);
    let subscription;
    try {
      subscription = await stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true
      });
      console.log('✅ Subscription cancelled successfully');
    } catch (stripeError: any) {
      console.error('❌ Stripe cancellation error:', stripeError);
      return res.status(500).json({ 
        success: false, 
        error: 'STRIPE_ERROR', 
        message: 'Failed to cancel subscription: ' + stripeError.message 
      });
    }

    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Update user status in database
    const expiresAt = safeToISOString((subscription as any).current_period_end);
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: 'cancelling',
        subscription_expires_at: expiresAt
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user subscription status:', updateError);
    }

    res.json({
      success: true,
      message: 'Subscription will be cancelled at the end of the current billing period',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        current_period_end: expiresAt
      }
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'CANCEL_ERROR', 
      message: 'Failed to cancel subscription' 
    });
  }
});

/**
 * Sync subscription status with Stripe
 * POST /api/stripe/sync-subscription
 */
router.post('/sync-subscription', requireAppAuth, async (req, res) => {
  try {
    console.log('🔄 Syncing subscription status with Stripe...');
    const userId = (req as any).appUserId;
    
    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ 
        success: false, 
        error: 'USER_NOT_FOUND', 
        message: 'User not found' 
      });
    }

    if (!user.stripe_subscription_id) {
      return res.json({
        success: true,
        message: 'No Stripe subscription to sync',
        subscription: null
      });
    }

    // Get current subscription status from Stripe
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      console.log('📊 Stripe subscription status:', subscription.status);
    } catch (stripeError: any) {
      console.error('❌ Stripe subscription retrieve error:', stripeError);
      
      if (stripeError.code === 'resource_missing') {
        // Subscription no longer exists in Stripe, update database
        const { error: updateError } = await supabase
          .from('app_users')
          .update({
            subscription_status: 'free',
            stripe_subscription_id: null,
            subscription_expires_at: null
          })
          .eq('id', userId);

        if (updateError) {
          console.error('Error updating user after subscription deletion:', updateError);
        }

        return res.json({
          success: true,
          message: 'Subscription no longer exists in Stripe, updated database',
          subscription: null
        });
      }
      
      throw stripeError;
    }

    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Update database with current Stripe status
    const newStatus = subscription.status === 'active' ? 'premium' : 'free';
    const expiresAt = safeToISOString((subscription as any).current_period_end);
    const createdAt = safeToISOString((subscription as any).created);

    console.log(`📅 Updating user ${user.email} with subscription dates:`, {
      status: newStatus,
      expires_at: expiresAt,
      created_at: createdAt
    });

    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: newStatus,
        subscription_expires_at: expiresAt,
        subscription_created_at: createdAt
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user subscription status:', updateError);
      return res.status(500).json({ 
        success: false, 
        error: 'UPDATE_ERROR', 
        message: 'Failed to update subscription status' 
      });
    }

    res.json({
      success: true,
      message: 'Subscription status synced successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        current_period_start: safeToISOString((subscription as any).current_period_start),
        current_period_end: safeToISOString((subscription as any).current_period_end),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: safeToISOString(subscription.canceled_at),
        plan: user.subscription_plan,
        customer_id: user.stripe_customer_id
      }
    });
  } catch (error) {
    console.error('Sync subscription error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'SYNC_ERROR', 
      message: 'Failed to sync subscription status' 
    });
  }
});

/**
 * Create customer portal session for subscription management
 * POST /api/stripe/create-portal-session
 */
router.post('/create-portal-session', requireAppAuth, async (req, res) => {
  try {
    const userId = (req as any).appUserId;
    console.log('🔍 Creating portal session for user ID:', userId);
    
    // Get user from database
    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({ 
        success: false, 
        error: 'USER_NOT_FOUND', 
        message: 'User not found' 
      });
    }

    console.log('👤 User found:', { 
      id: user.id, 
      email: user.email, 
      stripe_customer_id: user.stripe_customer_id 
    });

    if (!user.stripe_customer_id) {
      console.error('❌ No Stripe customer ID found for user:', user.email);
      return res.status(400).json({ 
        success: false, 
        error: 'NO_CUSTOMER', 
        message: 'No Stripe customer found' 
      });
    }

    console.log('🔧 Creating Stripe portal session for customer:', user.stripe_customer_id);
    console.log('🔧 Return URL:', `${process.env.FRONTEND_URL}/subscription.html`);

    // Create portal session
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: `${process.env.FRONTEND_URL}/subscription.html`,
      });

      console.log('✅ Portal session created successfully:', portalSession.id);
      res.json({
        success: true,
        url: portalSession.url
      });
    } catch (portalError: any) {
      console.error('❌ Stripe Customer Portal error:', {
        code: portalError.code,
        type: portalError.type,
        message: portalError.message,
        statusCode: portalError.statusCode
      });
      
      // If Customer Portal is not configured, provide fallback message
      if (portalError.code === 'billing_portal_configuration_inactive') {
        return res.status(400).json({ 
          success: false, 
          error: 'PORTAL_NOT_CONFIGURED', 
          message: 'Customer Portal is not configured. Please contact support to manage your subscription.' 
        });
      }
      
      throw portalError;
    }
  } catch (error: any) {
    console.error('❌ Create portal session error:', {
      message: error.message,
      code: error.code,
      type: error.type,
      statusCode: error.statusCode,
      stack: error.stack
    });
    res.status(500).json({ 
      success: false, 
      error: 'PORTAL_ERROR', 
      message: 'Failed to create customer portal session' 
    });
  }
});

/**
 * Set password for new user after payment
 * POST /api/stripe/set-password
 */
router.post('/set-password', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'MISSING_FIELDS', 
        message: 'Email and password are required' 
      });
    }

    // Check if user exists with active subscription but no password
    const { data: user, error: userError } = await supabase
      .from('app_users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError || !user) {
      return res.status(400).json({ 
        success: false, 
        error: 'USER_NOT_FOUND', 
        message: 'No subscription found for this email' 
      });
    }

    if (user.subscription_status !== 'active') {
      return res.status(400).json({ 
        success: false, 
        error: 'NO_ACTIVE_SUBSCRIPTION', 
        message: 'No active subscription found' 
      });
    }

    if (user.password_hash) {
      return res.status(400).json({ 
        success: false, 
        error: 'PASSWORD_ALREADY_SET', 
        message: 'Password already set for this account' 
      });
    }

    // Hash password and complete setup
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 12);
    
    const { error: updateError } = await supabase
      .from('app_users')
      .update({ 
        password_hash: passwordHash,
        signup_completed_at: new Date().toISOString()
      })
      .eq('email', email);

    if (updateError) {
      throw updateError;
    }
    
    res.json({ 
      success: true, 
      message: 'Password set successfully' 
    });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'SET_PASSWORD_ERROR', 
      message: 'Failed to set password' 
    });
  }
});

/**
 * Stripe webhook handler
 * POST /api/stripe/webhook
 */
router.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    // Ensure we have the raw body as a Buffer
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    event = stripe.webhooks.constructEvent(body, sig as string, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return res.status(400).send(`Webhook signature verification failed.`);
  }

  console.log('Received webhook event:', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;
    }
  } catch (error) {
    console.error('Webhook handler error:', error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
  
  res.json({received: true});
});

// Webhook handlers
async function handleCheckoutCompleted(session: any) {
  try {
    const { plan } = session.metadata;
    let email = session.customer_email; // Get email from Stripe session
    
    // If no email in session, get it from customer object
    if (!email && session.customer) {
      try {
        const customer = await stripe.customers.retrieve(session.customer);
        email = (customer as any).email;
        console.log('Webhook: Retrieved email from customer:', email);
      } catch (error) {
        console.error('Webhook: Error retrieving customer:', error);
      }
    }
    
    if (!email) {
      console.error('No email found in session or customer object');
      return;
    }
    
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    
    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Create user with subscription but no password yet
    const { error } = await supabase
      .from('app_users')
      .insert([{
        email: email,
        password_hash: null, // Will be set when user creates password
        subscription_status: 'active',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_plan: plan,
        subscription_expires_at: safeToISOString((subscription as any).current_period_end),
        subscription_created_at: safeToISOString((subscription as any).created),
        email_verified: true, // Mark as verified since they paid
        created_at: new Date().toISOString()
      }]);
    
    if (error) {
      console.error('Error creating user:', error);
      return;
    }
    
    console.log(`✅ User ${email} created with active subscription - password setup required`);
    
  } catch (error) {
    console.error('Error handling checkout completion:', error);
  }
}

async function handleSubscriptionUpdated(subscription: any) {
  try {
    console.log('🔄 Processing subscription update:', subscription.id, 'status:', subscription.status);
    
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (error || !user) {
      console.error('❌ User not found for subscription:', subscription.id);
      return;
    }
    
    console.log('👤 Found user for update:', user.email);
    
    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Determine the correct status based on subscription state
    let newStatus: string;
    if (subscription.status === 'active' && subscription.cancel_at_period_end) {
      // Subscription is active but will be cancelled at period end
      newStatus = 'cancelling';
    } else if (subscription.status === 'active') {
      newStatus = 'active';
    } else {
      newStatus = 'cancelled';
    }
    
    // Get the cancellation date (when the subscription will actually end)
    let endDate = null;
    
    // For cancel_at_period_end subscriptions, use current_period_end (when access ends)
    if (subscription.cancel_at_period_end) {
      // First try subscription items current_period_end
      if ((subscription as any).items && (subscription as any).items.data && (subscription as any).items.data.length > 0) {
        const firstItem = (subscription as any).items.data[0];
        if (firstItem.current_period_end) {
          endDate = safeToISOString(firstItem.current_period_end);
          console.log('📅 Got access end date from subscription item current_period_end:', endDate);
        }
      }
      
      // Fallback to subscription current_period_end
      if (!endDate && (subscription as any).current_period_end) {
        endDate = safeToISOString((subscription as any).current_period_end);
        console.log('📅 Got access end date from subscription current_period_end:', endDate);
      }
    } else {
      // For regular subscriptions, use cancel_at if it exists
      if ((subscription as any).cancel_at) {
        endDate = safeToISOString((subscription as any).cancel_at);
        console.log('📅 Got end date from cancel_at:', endDate);
      }
    }
    
    console.log('📅 Webhook: Final end date determined:', endDate);
    
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: newStatus,
        subscription_expires_at: endDate
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('❌ Error updating subscription:', updateError);
      return;
    }
    
    console.log(`✅ User ${user.email} subscription updated to ${newStatus}, expires: ${endDate}`);
  } catch (error) {
    console.error('❌ Error handling subscription update:', error);
  }
}

async function handleSubscriptionCancelled(subscription: any) {
  try {
    console.log('🔄 Processing subscription cancellation:', subscription.id);
    
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (error || !user) {
      console.error('❌ User not found for subscription:', subscription.id);
      return;
    }
    
    console.log('👤 Found user for cancellation:', user.email);
    
    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };

    // Get the actual end date from the subscription
    const endDate = safeToISOString(subscription.current_period_end);
    
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: 'cancelled',
        stripe_subscription_id: null,
        subscription_expires_at: endDate // Keep the actual end date for access control
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('❌ Error cancelling subscription:', updateError);
      return;
    }
    
    console.log(`✅ User ${user.email} subscription cancelled, access until: ${endDate}`);
  } catch (error) {
    console.error('❌ Error handling subscription cancellation:', error);
  }
}

async function handlePaymentFailed(invoice: any) {
  try {
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('stripe_customer_id', invoice.customer)
      .single();
    
    if (error || !user) {
      console.error('User not found for customer:', invoice.customer);
      return;
    }
    
    console.log(`⚠️ Payment failed for user ${user.email}`);
    // You might want to send an email notification here
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

/**
 * Bulk sync all users' subscription dates from Stripe
 * POST /api/stripe/bulk-sync-subscriptions
 * This is a one-time endpoint to fix existing users with missing subscription dates
 */
router.post('/bulk-sync-subscriptions', async (req, res) => {
  try {
    console.log('🔄 Starting bulk sync of subscription dates...');
    
    // Get all users with Stripe subscription IDs but missing dates
    const { data: users, error: usersError } = await supabase
      .from('app_users')
      .select('*')
      .not('stripe_subscription_id', 'is', null)
      .or('subscription_expires_at.is.null,subscription_created_at.is.null');
    
    if (usersError) {
      throw usersError;
    }
    
    if (!users || users.length === 0) {
      return res.json({
        success: true,
        message: 'No users found that need subscription date sync',
        synced: 0
      });
    }
    
    console.log(`📊 Found ${users.length} users to sync`);
    
    let syncedCount = 0;
    let errorCount = 0;
    
    // Helper function to safely convert timestamps to ISO strings
    const safeToISOString = (timestamp: number | null | undefined): string | null => {
      if (!timestamp || timestamp <= 0) return null;
      try {
        const date = new Date(timestamp * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
      } catch (error) {
        console.error('Date conversion error:', error, 'timestamp:', timestamp);
        return null;
      }
    };
    
    // Process each user
    for (const user of users) {
      try {
        console.log(`🔄 Syncing user: ${user.email}`);
        
        // Get subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
        
        const expiresAt = safeToISOString((subscription as any).current_period_end);
        const createdAt = safeToISOString((subscription as any).created);
        const newStatus = subscription.status === 'active' ? 'premium' : 'free';
        
        // Update user in Supabase
        const { error: updateError } = await supabase
          .from('app_users')
          .update({
            subscription_status: newStatus,
            subscription_expires_at: expiresAt,
            subscription_created_at: createdAt
          })
          .eq('id', user.id);
        
        if (updateError) {
          console.error(`❌ Error updating user ${user.email}:`, updateError);
          errorCount++;
        } else {
          console.log(`✅ Synced user ${user.email}: status=${newStatus}, expires=${expiresAt}`);
          syncedCount++;
        }
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error syncing user ${user.email}:`, error);
        errorCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Bulk sync completed. Synced: ${syncedCount}, Errors: ${errorCount}`,
      synced: syncedCount,
      errors: errorCount,
      total: users.length
    });
    
  } catch (error) {
    console.error('❌ Bulk sync error:', error);
    res.status(500).json({
      success: false,
      error: 'BULK_SYNC_ERROR',
      message: 'Failed to perform bulk sync'
    });
  }
});

export default router;
import express from 'express';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

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

    if (user.subscription_status !== 'premium') {
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
    
    // Create user with subscription but no password yet
    const { error } = await supabase
      .from('app_users')
      .insert([{
        email: email,
        password_hash: null, // Will be set when user creates password
        subscription_status: 'premium',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
        subscription_plan: plan,
        subscription_expires_at: (subscription as any).current_period_end 
          ? new Date((subscription as any).current_period_end * 1000).toISOString()
          : null,
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
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (error || !user) {
      console.error('User not found for subscription:', subscription.id);
      return;
    }
    
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: subscription.status === 'active' ? 'premium' : 'free',
        subscription_expires_at: new Date((subscription as any).current_period_end * 1000).toISOString()
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('Error updating subscription:', updateError);
      return;
    }
    
    console.log(`✅ User ${user.email} subscription updated to ${subscription.status}`);
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

async function handleSubscriptionCancelled(subscription: any) {
  try {
    const { data: user, error } = await supabase
      .from('app_users')
      .select('*')
      .eq('stripe_subscription_id', subscription.id)
      .single();
    
    if (error || !user) {
      console.error('User not found for subscription:', subscription.id);
      return;
    }
    
    const { error: updateError } = await supabase
      .from('app_users')
      .update({
        subscription_status: 'free',
        stripe_subscription_id: null,
        subscription_expires_at: null
      })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('Error cancelling subscription:', updateError);
      return;
    }
    
    console.log(`✅ User ${user.email} subscription cancelled`);
  } catch (error) {
    console.error('Error handling subscription cancellation:', error);
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

export default router;
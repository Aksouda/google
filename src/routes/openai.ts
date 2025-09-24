import express from 'express';

const router = express.Router();

// In-memory storage for API key (in production, use a secure database)
let openaiApiKey: string | null = null;
let openaiConfiguration: any = null;

/**
 * POST /api/openai/configure - Save OpenAI API key
 */
router.post('/configure', async (req: express.Request, res: express.Response) => {
  try {
    const { apiKey } = req.body;

    if (!apiKey || !apiKey.startsWith('sk-')) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_API_KEY',
        message: 'Please provide a valid OpenAI API key starting with sk-'
      });
    }

    // Store the API key and create configuration
    openaiApiKey = apiKey;
    
    // OpenAI v3 uses Configuration and OpenAIApi
    const { Configuration, OpenAIApi } = require('openai');
    openaiConfiguration = new OpenAIApi(new Configuration({
      apiKey: apiKey
    }));

    console.log('🤖 OpenAI API key configured successfully');

    res.json({
      success: true,
      message: 'OpenAI API key saved successfully'
    });

  } catch (error: any) {
    console.error('❌ Error configuring OpenAI:', error);
    res.status(500).json({
      success: false,
      error: 'CONFIGURATION_ERROR',
      message: 'Failed to configure OpenAI API'
    });
  }
});

/**
 * POST /api/openai/test - Test OpenAI API connection
 */
router.post('/test', async (req: express.Request, res: express.Response) => {
  try {
    console.log('🧪 OpenAI Test endpoint called');
    console.log('🔍 Request body:', req.body);
    console.log('🔍 OpenAI configuration exists:', !!openaiConfiguration);
    console.log('🔍 OpenAI API key exists:', !!openaiApiKey);
    
    if (!openaiConfiguration) {
      console.log('❌ OpenAI configuration not found');
      return res.status(400).json({
        success: false,
        error: 'API_KEY_NOT_CONFIGURED',
        message: 'OpenAI API key not configured. Please save your API key first.'
      });
    }

    console.log('🧪 Testing OpenAI API connection...');
    console.log('🔍 OpenAI client methods available:', typeof openaiConfiguration.createChatCompletion === 'function');

    // Test the API with a simple request using chat completion (more reliable)
    console.log('📡 Making OpenAI API call...');
    const apiParams = {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: "Say 'API test successful' if you can read this message."
        }
      ],
      max_tokens: 10,
      temperature: 0.1
    };
    console.log('🔍 API parameters:', apiParams);
    
    const completion = await openaiConfiguration.createChatCompletion(apiParams);
    
    console.log('📡 OpenAI API response received');
    console.log('🔍 Response status:', completion.status);
    console.log('🔍 Response data structure:', {
      hasData: !!completion.data,
      hasChoices: !!completion.data?.choices,
      choicesLength: completion.data?.choices?.length,
      hasFirstChoice: !!completion.data?.choices?.[0],
      hasMessage: !!completion.data?.choices?.[0]?.message,
      hasContent: !!completion.data?.choices?.[0]?.message?.content
    });

    const response = completion.data.choices[0]?.message?.content?.trim();

    console.log('✅ OpenAI API test successful:', response);

    res.json({
      success: true,
      message: 'OpenAI API connection successful!',
      testResponse: response,
      model: completion.data.model,
      usage: completion.data.usage
    });

  } catch (error: any) {
    console.error('❌ OpenAI API test failed:', error);
    console.error('❌ Error details:', {
      status: error.status,
      message: error.message,
      response: error.response?.data,
      stack: error.stack
    });
    
    let errorMessage = 'Failed to connect to OpenAI API';
    if (error.status === 401 || error.response?.status === 401) {
      errorMessage = 'Invalid API key. Please check your OpenAI API key.';
    } else if (error.status === 429 || error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please check your OpenAI account credits.';
    } else if (error.status === 400 || error.response?.status === 400) {
      errorMessage = `Bad request: ${error.response?.data?.error?.message || error.message || 'Invalid request parameters'}`;
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      error: 'API_TEST_FAILED',
      message: errorMessage,
      details: error.status || error.response?.status ? `HTTP ${error.status || error.response?.status}` : undefined
    });
  }
});

/**
 * GET /api/openai/status - Check if OpenAI is configured
 */
router.get('/status', (req: express.Request, res: express.Response) => {
  res.json({
    success: true,
    configured: !!openaiConfiguration,
    hasApiKey: !!openaiApiKey
  });
});

/**
 * POST /api/openai/generate-review-response - Generate AI-powered review response
 */
router.post('/generate-review-response', async (req: express.Request, res: express.Response) => {
  try {
    if (!openaiConfiguration) {
      return res.status(400).json({
        success: false,
        error: 'API_KEY_NOT_CONFIGURED',
        message: 'OpenAI API key not configured. Please configure it in Settings first.'
      });
    }

    const { reviewerName, starRating, reviewComment, businessType = 'business' } = req.body;

    if (!starRating) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Star rating is required'
      });
    }

    console.log('🤖 Generating AI review response...');
    console.log('📝 Review details:', { reviewerName, starRating, hasComment: !!reviewComment });

    // Create an intelligent prompt that follows the user's guidelines
    const ratingNumber = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'].indexOf(starRating) + 1;
    const hasReviewerName = reviewerName && reviewerName.trim() && reviewerName !== 'Anonymous' && !reviewerName.includes('Google user');
    
    const prompt = `You are helping to reply to a customer review for a ${businessType}. Please follow these guidelines strictly:

GUIDELINES:
- Make the response short, compassionate, and personalized
- NEVER make any promises about future improvements or specific actions
- NEVER mention staff names - only say "team" instead
- Use the reviewer's name if provided (but only if it's a real name, not "Anonymous" or "Google user")
- Be professional but warm and human
- Acknowledge specific points mentioned in the review
- Thank them for their feedback

REVIEW DETAILS:
- Reviewer: ${hasReviewerName ? reviewerName : 'Customer (anonymous)'}
- Rating: ${ratingNumber}/5 stars
- Review comment: ${reviewComment || 'No written comment provided'}

Write a response that feels genuine and follows the guidelines above. Keep it under 150 words.`;

    // OpenAI v3 syntax - using createChatCompletion for more reliable results
    const completion = await openaiConfiguration.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that writes professional, compassionate business review responses. Always follow the provided guidelines exactly."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    const aiResponse = completion.data.choices[0]?.message?.content?.trim();

    if (!aiResponse) {
      throw new Error('No response generated from OpenAI');
    }

    console.log('✅ AI response generated successfully');

    res.json({
      success: true,
      response: aiResponse,
      usage: completion.data.usage,
      model: completion.data.model
    });

  } catch (error: any) {
    console.error('❌ Error generating AI response:', error);
    
    let errorMessage = 'Failed to generate AI response';
    if (error.status === 401) {
      errorMessage = 'Invalid API key. Please check your OpenAI configuration.';
    } else if (error.status === 429) {
      errorMessage = 'Rate limit exceeded. Please check your OpenAI account credits.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      error: 'AI_GENERATION_FAILED',
      message: errorMessage
    });
  }
});

export default router;
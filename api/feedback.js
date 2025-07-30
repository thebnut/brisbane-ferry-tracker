export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if environment variables are set
  if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_AUTH_TOKEN) {
    console.error('Missing environment variables: N8N_WEBHOOK_URL or N8N_AUTH_TOKEN');
    return res.status(500).json({ 
      error: 'Server configuration error. Please contact support.' 
    });
  }

  try {
    const { feedback, email, name } = req.body;

    // Basic validation
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 10) {
      return res.status(400).json({ error: 'Feedback must be at least 10 characters long' });
    }

    if (feedback.length > 1000) {
      return res.status(400).json({ error: 'Feedback must be less than 1000 characters' });
    }

    // Validate email if provided
    if (email && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Prepare data for n8n
    const webhookData = {
      feedback: feedback.trim(),
      email: email || null,
      name: name || null,
      timestamp: new Date().toISOString(),
      source: 'brisbane-ferry-tracker',
      url: req.headers.referer || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown'
    };

    // Send to n8n webhook
    console.log('Sending feedback to n8n webhook...');
    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'bris-ferry-prod': process.env.N8N_AUTH_TOKEN,
      },
      body: JSON.stringify(webhookData),
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error('n8n webhook error:', {
        status: response.status,
        statusText: response.statusText,
        body: responseText
      });
      throw new Error(`Webhook responded with ${response.status}: ${responseText || response.statusText}`);
    }

    // Return success
    return res.status(200).json({ 
      success: true, 
      message: 'Thank you for your feedback!' 
    });

  } catch (error) {
    console.error('Feedback submission error:', {
      message: error.message,
      stack: error.stack,
      webhookUrl: process.env.N8N_WEBHOOK_URL ? 'Set' : 'Not set',
      authToken: process.env.N8N_AUTH_TOKEN ? 'Set' : 'Not set'
    });
    return res.status(500).json({ 
      error: 'Failed to submit feedback. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
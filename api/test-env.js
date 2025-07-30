export default function handler(req, res) {
  res.status(200).json({
    N8N_WEBHOOK_URL: process.env.N8N_WEBHOOK_URL ? 'Set' : 'Not set',
    N8N_AUTH_TOKEN: process.env.N8N_AUTH_TOKEN ? 'Set' : 'Not set',
    NODE_ENV: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
}
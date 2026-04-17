import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  // BRI-20: CORS via shared allowlist helper (was wildcard *).
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { endpoint } = req.query;
  
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint parameter is required' });
  }

  try {
    const baseUrl = 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ/';
    const url = `${baseUrl}${endpoint}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    
    // Set appropriate content type for protobuf
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Failed to fetch data from TransLink API' });
  }
}
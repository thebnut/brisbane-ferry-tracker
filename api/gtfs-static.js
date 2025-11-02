export const config = {
  maxDuration: 60, // Allow up to 60 seconds for large file download
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // TransLink static GTFS URL
    const gtfsUrl = 'https://gtfsrt.api.translink.com.au/GTFS/SEQ_GTFS.zip';

    const response = await fetch(gtfsUrl);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Stream the response instead of buffering it all
    // Set appropriate headers
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    if (response.body) {
      // Stream directly to response (Node.js 18+ with Web Streams API)
      const reader = response.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          // Write chunk to response
          res.write(Buffer.from(value));
        }

        res.end();
      } catch (streamError) {
        console.error('Stream error:', streamError);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream interrupted' });
        }
      }
    } else {
      // Fallback for environments without streaming support
      const buffer = await response.arrayBuffer();
      res.status(200).send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error('Static GTFS proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch static GTFS data' });
    }
  }
}
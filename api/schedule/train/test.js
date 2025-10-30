/**
 * Simple test endpoint to verify Vercel function works
 */

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req) {
  const startTime = Date.now();

  console.log('[TEST] Function started');

  // Test a simple fetch
  try {
    const testUrl = 'https://qbd1awgw2y6szl69.public.blob.vercel-storage.com/train-600016-600029.json';
    console.log('[TEST] Fetching:', testUrl);

    const response = await fetch(testUrl);
    console.log('[TEST] Fetch completed, status:', response.status);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const responseTime = Date.now() - startTime;

    console.log('[TEST] Success in', responseTime, 'ms');

    return new Response(JSON.stringify({
      success: true,
      responseTime: `${responseTime}ms`,
      dataSize: JSON.stringify(data).length,
      departureCount: data.departures?.length || 0
    }, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('[TEST] Error:', error);

    return new Response(JSON.stringify({
      error: error.message,
      responseTime: `${responseTime}ms`
    }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

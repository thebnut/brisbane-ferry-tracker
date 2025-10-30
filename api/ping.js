/**
 * Absolute minimal ping endpoint - no imports, no logic
 */

export const config = {
  runtime: 'nodejs',
  maxDuration: 10,
};

export default async function handler(req) {
  return new Response(JSON.stringify({
    ping: 'pong',
    timestamp: Date.now()
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

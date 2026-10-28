import autocannon from 'autocannon';

const BASE = process.env.BASE_URL ?? 'http://localhost:5000';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);
const DURATION = Number(process.env.DURATION ?? 10);

async function post(path, body, token) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
}

const email = `load${Date.now()}@example.com`;
const auth = await post('/auth/register', { name: 'Load Tester', email, password: 'StrongPass123!' });
const token = auth.accessToken;
const group = await post('/conversations', { type: 'group', name: `Load ${Date.now()}`, memberIds: [] }, token);

console.log(`POST /conversations/${group.conversation.id}/messages | ${CONNECTIONS} connections | ${DURATION}s`);

const result = await autocannon({
  url: `${BASE}/api/v1/conversations/${group.conversation.id}/messages`,
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ content: 'load test message' }),
  connections: CONNECTIONS,
  duration: DURATION,
});

console.log({
  reqPerSecAvg: result.requests.average,
  latencyMs: { p50: result.latency.p50, p97_5: result.latency.p97_5, p99: result.latency.p99, max: result.latency.max },
  total2xx: result['2xx'],
  non2xx: result.non2xx,
  statusCodes: result.statusCodeStats,
  errors: result.errors,
  timeouts: result.timeouts,
});
console.log('Note: non2xx mein 429 aaye to messageLimiter (REST rate limit) trigger hua hai, bug nahi.');
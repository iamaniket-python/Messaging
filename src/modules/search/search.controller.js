import * as service from './search.service.js';
import { toSearchResult } from './search.mapper.js';
import { consumeRateLimit } from '../../utils/rateLimit.js';
import { AppError } from '../../utils/AppError.js';

export async function searchMessages(req, res) {
  const rate = await consumeRateLimit(`search:${req.user.id}`, { limit: 60, windowSeconds: 60 });
  if (!rate.allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many searches, try again in a minute');
  }

  const { q, conversationId, senderId, from, to, limit, cursor } = req.validated.query;

  const result = await service.searchMessages({
    userId: req.user.id,
    q,
    conversationId,
    senderId,
    from,
    to,
    limit,
    cursor,
  });

  res.json({
    success: true,
    data: {
      results: result.results.map(toSearchResult),
      pageInfo: { hasMore: result.hasMore, nextCursor: result.nextCursor },
    },
  });
}
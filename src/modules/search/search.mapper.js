import { toMessage } from '../messages/message.mapper.js';

// snippet mein match [[...]] se wrap hota hai (HTML nahi), taaki client XSS-safe render kare.
export const toSearchResult = (row) => ({
  ...toMessage(row),
  snippet: row.snippet,
});
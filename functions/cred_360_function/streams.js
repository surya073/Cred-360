'use strict';

// Optional Catalyst Data Streams layer.
//
// SECURITY MODEL: one channel is shared by everyone, and a subscriber receives every
// message published on it. So we NEVER publish chat content here — only a tiny
// "something new in team X" ping. Clients react to a ping by fetching the real messages
// through the authenticated REST API, where team membership is enforced.
//
// This module degrades silently: if the SDK is missing / unsupported on this runtime
// (it needs Node >= 22), or no channel is configured, enabled() is false and the client
// falls back to polling. A chat message is never lost because a ping failed.

const { CHAT_CHANNEL } = require('./chat-config');

let DataStreamsAdmin = null;
let loadError = null;
try {
  ({ DataStreamsAdmin } = require('@zcatalyst/datastreams'));
} catch (e) {
  loadError = e.message;
}

const enabled = () => !!(DataStreamsAdmin && CHAT_CHANNEL);

const status = () => ({ enabled: enabled(), reason: enabled() ? null : (loadError || 'no channel configured') });

// Fire-and-forget. Resolves true/false, never throws.
async function publishPing(catalystApp, payload) {
  if (!enabled()) return false;
  try {
    const ds = new DataStreamsAdmin(catalystApp);
    await ds.publishData(String(CHAT_CHANNEL), JSON.stringify(payload));
    return true;
  } catch (e) {
    console.log('streams.publishPing failed:', e.message);
    return false;
  }
}

// Token pair for the browser WebSocket client. Returns null when unavailable.
async function tokenPairFor(catalystApp, userId) {
  if (!enabled()) return null;
  try {
    const ds = new DataStreamsAdmin(catalystApp);
    return await ds.getTokenPair(String(CHAT_CHANNEL), { userId: String(userId) });
  } catch (e) {
    console.log('streams.tokenPairFor failed:', e.message);
    return null;
  }
}

module.exports = { enabled, status, publishPing, tokenPairFor };

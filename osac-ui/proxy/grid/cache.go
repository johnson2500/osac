package grid

import (
	"sync"
	"time"
)

// cacheKey identifies a cached hub token: one token per OSAC user per grid.
type cacheKey struct {
	user   string
	gridID string
}

type tokenEntry struct {
	token     string
	expiresAt time.Time
}

// TokenCache is an in-memory (user, grid) → hub-token cache.
//
// Hub tokens are opaque with a 24 h lifetime and no refresh grant, so entries
// carry a conservative TTL and are also invalidated on any upstream 401 —
// wall-clock expiry alone is never trusted (see OSAC-8173 spike notes).
type TokenCache struct {
	mu      sync.RWMutex
	entries map[cacheKey]tokenEntry
	now     func() time.Time
}

// NewTokenCache returns an empty token cache.
func NewTokenCache() *TokenCache {
	return &TokenCache{
		entries: map[cacheKey]tokenEntry{},
		now:     time.Now,
	}
}

// Get returns the cached token for (user, gridID) if present and not expired.
func (c *TokenCache) Get(user, gridID string) (string, bool) {
	c.mu.RLock()
	e, ok := c.entries[cacheKey{user, gridID}]
	c.mu.RUnlock()
	if !ok || !c.now().Before(e.expiresAt) {
		return "", false
	}
	return e.token, true
}

// Set stores a token for (user, gridID) with the given TTL.
func (c *TokenCache) Set(user, gridID, token string, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	c.mu.Lock()
	c.entries[cacheKey{user, gridID}] = tokenEntry{token: token, expiresAt: c.now().Add(ttl)}
	c.mu.Unlock()
}

// Invalidate drops the cached token for (user, gridID), e.g. after a 401.
func (c *TokenCache) Invalidate(user, gridID string) {
	c.mu.Lock()
	delete(c.entries, cacheKey{user, gridID})
	c.mu.Unlock()
}

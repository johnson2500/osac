package grid

import (
	"testing"
	"time"
)

func TestTokenCache_SetGet(t *testing.T) {
	c := NewTokenCache()
	c.Set("alice", "grid1", "sha256~token", time.Hour)

	token, ok := c.Get("alice", "grid1")
	if !ok || token != "sha256~token" {
		t.Fatalf("expected cached token, got %q ok=%v", token, ok)
	}

	// Per-user, per-grid isolation.
	if _, ok := c.Get("bob", "grid1"); ok {
		t.Error("expected no token for another user")
	}
	if _, ok := c.Get("alice", "grid2"); ok {
		t.Error("expected no token for another grid")
	}
}

func TestTokenCache_Expiry(t *testing.T) {
	c := NewTokenCache()
	now := time.Now()
	c.now = func() time.Time { return now }

	c.Set("alice", "grid1", "t", time.Minute)
	if _, ok := c.Get("alice", "grid1"); !ok {
		t.Fatal("expected token before expiry")
	}

	c.now = func() time.Time { return now.Add(2 * time.Minute) }
	if _, ok := c.Get("alice", "grid1"); ok {
		t.Error("expected no token after expiry")
	}
}

func TestTokenCache_Invalidate(t *testing.T) {
	c := NewTokenCache()
	c.Set("alice", "grid1", "t", time.Hour)
	c.Invalidate("alice", "grid1")
	if _, ok := c.Get("alice", "grid1"); ok {
		t.Error("expected token to be invalidated")
	}
}

func TestTokenCache_NonPositiveTTLIgnored(t *testing.T) {
	c := NewTokenCache()
	c.Set("alice", "grid1", "t", 0)
	if _, ok := c.Get("alice", "grid1"); ok {
		t.Error("expected zero TTL to be ignored")
	}
}

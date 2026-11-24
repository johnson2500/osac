package grid

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// The helpers below mirror the unexported ones in auth/pkce.go. They are
// duplicated (rather than exported from auth) to keep this package
// self-contained and the diff to the existing auth surface at zero.

// generateCodeVerifier creates a random PKCE code verifier (RFC 7636 §4.1).
func generateCodeVerifier() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// codeChallenge computes the S256 code challenge for a verifier (RFC 7636 §4.2).
func codeChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// generateState creates a random opaque state string for CSRF protection.
func generateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

package grid

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Grid describes one AI Grid hub the proxy can exchange OSAC sessions for.
type Grid struct {
	// ID is the URL-safe grid identifier used in /api/grids/<id>/... routes.
	ID string `json:"id"`
	// HubURL is the base URL of the grid hub's console BFF (Connect + Perses relay).
	HubURL string `json:"hubURL"`
	// OAuthURL is the base URL of the hub's OpenShift OAuth server
	// (e.g. https://oauth-openshift.apps.example.com).
	OAuthURL string `json:"oauthURL"`
	// ClientID is the OAuthClient registered on the hub for this proxy.
	ClientID string `json:"clientID"`
	// ClientSecret is the OAuthClient secret, if the client is confidential.
	// Supplied via the mounted grids config file, never in source.
	ClientSecret string `json:"clientSecret,omitempty"`
	// IdP is the hub OAuth identity-provider name federated to the OSAC
	// Keycloak. When empty, the hub default login is used.
	IdP string `json:"idp,omitempty"`
}

// AuthorizeEndpoint returns the hub OAuth authorization endpoint.
func (g Grid) AuthorizeEndpoint() string {
	return strings.TrimSuffix(g.OAuthURL, "/") + "/oauth/authorize"
}

// TokenEndpoint returns the hub OAuth token endpoint.
func (g Grid) TokenEndpoint() string {
	return strings.TrimSuffix(g.OAuthURL, "/") + "/oauth/token"
}

// validate checks that a grid entry has all required, well-formed fields.
func (g Grid) validate() error {
	if g.ID == "" {
		return fmt.Errorf("grid id is required")
	}
	if strings.ContainsAny(g.ID, "/ ") {
		return fmt.Errorf("grid id %q must not contain spaces or slashes", g.ID)
	}
	for name, raw := range map[string]string{"hubURL": g.HubURL, "oauthURL": g.OAuthURL} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme == "" || u.Host == "" {
			return fmt.Errorf("grid %q: %s must be an absolute URL", g.ID, name)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return fmt.Errorf("grid %q: %s must use http or https", g.ID, name)
		}
	}
	if g.ClientID == "" {
		return fmt.Errorf("grid %q: clientID is required", g.ID)
	}
	return nil
}

// gridsFile is the on-disk shape of the grids configuration file.
type gridsFile struct {
	Grids []Grid `json:"grids"`
}

// LoadConfig reads and validates the grids configuration file. It returns a
// map keyed by grid ID. An empty path returns an empty map (feature disabled).
func LoadConfig(path string) (map[string]Grid, error) {
	if path == "" {
		return map[string]Grid{}, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read grids config: %w", err)
	}
	var gf gridsFile
	if err := json.Unmarshal(b, &gf); err != nil {
		return nil, fmt.Errorf("parse grids config: %w", err)
	}
	grids := make(map[string]Grid, len(gf.Grids))
	for _, g := range gf.Grids {
		if err := g.validate(); err != nil {
			return nil, err
		}
		if _, dup := grids[g.ID]; dup {
			return nil, fmt.Errorf("duplicate grid id %q", g.ID)
		}
		grids[g.ID] = g
	}
	return grids, nil
}

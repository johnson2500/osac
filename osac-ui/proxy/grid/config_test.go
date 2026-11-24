package grid

import (
	"os"
	"path/filepath"
	"testing"
)

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "grids.json")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

func TestLoadConfig_EmptyPathDisablesFeature(t *testing.T) {
	grids, err := LoadConfig("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(grids) != 0 {
		t.Fatalf("expected no grids, got %d", len(grids))
	}
}

func TestLoadConfig_Valid(t *testing.T) {
	path := writeTemp(t, `{"grids":[
		{"id":"grid1","hubURL":"https://console.apps.example.com",
		 "oauthURL":"https://oauth-openshift.apps.example.com",
		 "clientID":"ai-grid-proxy","idp":"osac"},
		{"id":"grid2","hubURL":"http://console2.apps.example.com",
		 "oauthURL":"http://oauth-openshift2.apps.example.com",
		 "clientID":"other"}
	]}`)
	grids, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(grids) != 2 {
		t.Fatalf("expected 2 grids, got %d", len(grids))
	}
	g := grids["grid1"]
	if g.AuthorizeEndpoint() != "https://oauth-openshift.apps.example.com/oauth/authorize" {
		t.Errorf("unexpected authorize endpoint: %s", g.AuthorizeEndpoint())
	}
	if g.TokenEndpoint() != "https://oauth-openshift.apps.example.com/oauth/token" {
		t.Errorf("unexpected token endpoint: %s", g.TokenEndpoint())
	}
}

func TestLoadConfig_RejectsInvalidEntries(t *testing.T) {
	cases := map[string]string{
		"missing id":       `{"grids":[{"hubURL":"https://h","oauthURL":"https://o","clientID":"c"}]}`,
		"bad id":           `{"grids":[{"id":"a b","hubURL":"https://h","oauthURL":"https://o","clientID":"c"}]}`,
		"relative URL":     `{"grids":[{"id":"g","hubURL":"h","oauthURL":"https://o","clientID":"c"}]}`,
		"missing clientID": `{"grids":[{"id":"g","hubURL":"https://h","oauthURL":"https://o"}]}`,
		"duplicate id": `{"grids":[{"id":"g","hubURL":"https://h","oauthURL":"https://o","clientID":"c"},
			{"id":"g","hubURL":"https://h2","oauthURL":"https://o2","clientID":"c2"}]}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := LoadConfig(writeTemp(t, content)); err == nil {
				t.Fatalf("expected error for %s", name)
			}
		})
	}
}

func TestLoadConfig_MissingFile(t *testing.T) {
	if _, err := LoadConfig(filepath.Join(t.TempDir(), "nope.json")); err == nil {
		t.Fatal("expected error for missing file")
	}
}

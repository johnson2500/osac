package grid

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// testJWT builds an unsigned JWT whose payload carries preferred_username.
// UsernameFromToken only decodes claims (our own session cookie), so no
// signature is needed.
func testJWT(username string) string {
	payload, _ := json.Marshal(map[string]string{"preferred_username": username})
	b64 := base64.RawURLEncoding.EncodeToString(payload)
	return fmt.Sprintf("header.%s.signature", b64)
}

// sessionCookie returns the cookie header value for a logged-in OSAC user.
// The cookie name mirrors auth's unexported osac-access cookie.
func sessionCookie(username string) string {
	return "osac-access=" + url.QueryEscape(testJWT(username))
}

type testEnv struct {
	router   *chi.Mux
	handler  *Handler
	cache    *TokenCache
	tokenSrv *httptest.Server // hub OAuth token endpoint
	upstream *httptest.Server // grid hub console BFF
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/perses/api/api/v1/dashboards" {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`[]`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/unauthorized") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("grant_type") != "authorization_code" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"sha256~hubtoken","expires_in":3600,"token_type":"Bearer"}`))
	}))
	t.Cleanup(tokenSrv.Close)

	grids := map[string]Grid{
		"grid1": {
			ID:       "grid1",
			HubURL:   upstream.URL,
			OAuthURL: tokenSrv.URL,
			ClientID: "ai-grid-proxy",
			IdP:      "osac",
		},
	}
	cache := NewTokenCache()
	handler := &Handler{Grids: grids, Cache: cache, BaseUIURL: "https://ui.example.com"}

	router := chi.NewRouter()
	router.Route("/api/grids", func(r chi.Router) {
		r.Get("/", handler.List)
		r.Get("/{gridID}/login", handler.Login)
		r.Get("/{gridID}/callback", handler.Callback)
		r.Handle("/{gridID}/*", http.HandlerFunc(handler.Proxy))
	})

	return &testEnv{router: router, handler: handler, cache: cache,
		tokenSrv: tokenSrv, upstream: upstream}
}

func (e *testEnv) do(t *testing.T, method, target, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, target, nil)
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	rec := httptest.NewRecorder()
	e.router.ServeHTTP(rec, req)
	return rec
}

func TestList_RequiresOSACSession(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet, "/api/grids", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d", rec.Code)
	}
}

func TestList_ReturnsSortedGridIDsOnly(t *testing.T) {
	env := newTestEnv(t)
	env.handler.Grids["zeta"] = Grid{ID: "zeta"}
	env.handler.Grids["alpha"] = Grid{ID: "alpha"}

	rec := env.do(t, http.MethodGet, "/api/grids", sessionCookie("provider-admin"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var got struct {
		Grids []gridSummary `json:"grids"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	ids := make([]string, 0, len(got.Grids))
	for _, g := range got.Grids {
		ids = append(ids, g.ID)
	}
	want := []string{"alpha", "grid1", "zeta"}
	if strings.Join(ids, ",") != strings.Join(want, ",") {
		t.Errorf("grid IDs = %v, want %v (sorted)", ids, want)
	}
	// Only IDs may cross to the browser: no hub URL, client ID or secret.
	if raw := rec.Body.String(); strings.Contains(raw, "hubURL") ||
		strings.Contains(raw, "clientID") || strings.Contains(raw, "clientSecret") {
		t.Errorf("grid list leaked non-ID fields: %s", raw)
	}
}

func TestLogin_RequiresOSACSession(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet, "/api/grids/grid1/login", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without session, got %d", rec.Code)
	}
}

func TestLogin_RedirectsToHubAuthorizeWithPKCE(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/login?redirect=/grids/grid1/dashboards",
		sessionCookie("provider-admin"))
	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", rec.Code)
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	if loc.Path != "/oauth/authorize" {
		t.Errorf("unexpected authorize path: %s", loc.Path)
	}
	q := loc.Query()
	if q.Get("client_id") != "ai-grid-proxy" {
		t.Errorf("unexpected client_id: %s", q.Get("client_id"))
	}
	if q.Get("code_challenge_method") != "S256" {
		t.Error("expected S256 code_challenge_method")
	}
	if q.Get("code_challenge") == "" {
		t.Error("expected non-empty code_challenge")
	}
	if q.Get("idp") != "osac" {
		t.Error("expected idp=osac")
	}
	if q.Get("redirect_uri") != "https://ui.example.com/api/grids/grid1/callback" {
		t.Errorf("unexpected redirect_uri: %s", q.Get("redirect_uri"))
	}
	if q.Get("state") == "" {
		t.Error("expected non-empty state")
	}
	// Flow cookie must be set for the state.
	found := false
	for _, c := range rec.Result().Cookies() {
		if c.Name == gridFlowCookiePrefix+q.Get("state") {
			found = true
		}
	}
	if !found {
		t.Error("expected grid flow cookie for the state")
	}
}

func TestCallback_ExchangesCodeCachesTokenAndRedirects(t *testing.T) {
	env := newTestEnv(t)

	// Start the flow to get state + flow cookie.
	login := env.do(t, http.MethodGet, "/api/grids/grid1/login?redirect=/grids/grid1",
		sessionCookie("provider-admin"))
	loc, _ := url.Parse(login.Header().Get("Location"))
	state := loc.Query().Get("state")

	// Complete the flow with the same session.
	var flowCookie string
	for _, c := range login.Result().Cookies() {
		if strings.HasPrefix(c.Name, gridFlowCookiePrefix) {
			flowCookie = c.Name + "=" + c.Value
		}
	}
	cookies := sessionCookie("provider-admin") + "; " + flowCookie
	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/callback?code=abc123&state="+url.QueryEscape(state), cookies)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d (body %s)", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != "/grids/grid1" {
		t.Errorf("unexpected redirect target: %s", loc)
	}
	token, ok := env.cache.Get("provider-admin", "grid1")
	if !ok || token != "sha256~hubtoken" {
		t.Errorf("expected cached hub token, got %q ok=%v", token, ok)
	}
}

func TestCallback_RejectsForeignRedirect(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/login?redirect=https://evil.example.com",
		sessionCookie("provider-admin"))
	loc, _ := url.Parse(rec.Header().Get("Location"))
	state := loc.Query().Get("state")

	var flowCookie string
	for _, c := range rec.Result().Cookies() {
		if strings.HasPrefix(c.Name, gridFlowCookiePrefix) {
			flowCookie = c.Name + "=" + c.Value
		}
	}
	rec = env.do(t, http.MethodGet,
		"/api/grids/grid1/callback?code=abc&state="+url.QueryEscape(state),
		sessionCookie("provider-admin")+"; "+flowCookie)
	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Errorf("expected open redirect to be neutralized to /, got %s", loc)
	}
}

func TestProxy_MissingTokenReturns401WithLoginHeader(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/perses/api/api/v1/dashboards",
		sessionCookie("provider-admin"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if got := rec.Header().Get(gridLoginHeader); got != "/api/grids/grid1/login" {
		t.Errorf("unexpected %s header: %s", gridLoginHeader, got)
	}
}

func TestProxy_MissingTokenRedirectsBrowserNavigation(t *testing.T) {
	env := newTestEnv(t)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/grids/grid1/perses/api/api/v1/dashboards?foo=bar", nil)
	req.Header.Set("Cookie", sessionCookie("provider-admin"))
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	rec := httptest.NewRecorder()
	env.router.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302 for navigation, got %d", rec.Code)
	}
	loc, err := url.Parse(rec.Header().Get("Location"))
	if err != nil {
		t.Fatalf("parse Location: %v", err)
	}
	if loc.Path != "/api/grids/grid1/login" {
		t.Errorf("unexpected login path: %s", loc.Path)
	}
	if loc.Query().Get("redirect") != "/api/grids/grid1/perses/api/api/v1/dashboards?foo=bar" {
		t.Errorf("unexpected redirect target: %s", loc.Query().Get("redirect"))
	}
}

func TestProxy_ForwardsWithStrippedPathAndBearer(t *testing.T) {
	env := newTestEnv(t)

	var gotPath, gotAuth string
	var gotCookie bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		if _, err := r.Cookie("osac-access"); err == nil {
			gotCookie = true
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	env.handler.Grids["grid1"] = Grid{
		ID: "grid1", HubURL: srv.URL, OAuthURL: env.tokenSrv.URL, ClientID: "c",
	}

	env.cache.Set("provider-admin", "grid1", "sha256~hubtoken", time.Hour)

	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/perses/api/api/v1/dashboards",
		sessionCookie("provider-admin"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if gotPath != "/perses/api/api/v1/dashboards" {
		t.Errorf("expected stripped path preserving double-api quirk, got %s", gotPath)
	}
	if gotAuth != "Bearer sha256~hubtoken" {
		t.Errorf("expected hub bearer token, got %q", gotAuth)
	}
	if gotCookie {
		t.Error("expected OSAC session cookie not to be forwarded upstream")
	}
}

func TestProxy_Upstream401InvalidatesAndSignalsLogin(t *testing.T) {
	env := newTestEnv(t)
	env.cache.Set("provider-admin", "grid1", "sha256~stale", time.Hour)

	rec := env.do(t, http.MethodGet,
		"/api/grids/grid1/unauthorized/path",
		sessionCookie("provider-admin"))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 passthrough, got %d", rec.Code)
	}
	if got := rec.Header().Get(gridLoginHeader); got != "/api/grids/grid1/login" {
		t.Errorf("expected %s header on 401, got %q", gridLoginHeader, got)
	}
	if _, ok := env.cache.Get("provider-admin", "grid1"); ok {
		t.Error("expected stale token to be invalidated after upstream 401")
	}
}

func TestProxy_Upstream401RedirectsBrowserNavigation(t *testing.T) {
	env := newTestEnv(t)
	env.cache.Set("provider-admin", "grid1", "sha256~stale", time.Hour)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet,
		"/api/grids/grid1/unauthorized/path", nil)
	req.Header.Set("Cookie", sessionCookie("provider-admin"))
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	rec := httptest.NewRecorder()
	env.router.ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("expected 302 for navigation, got %d", rec.Code)
	}
	if got := rec.Header().Get("Location"); !strings.HasPrefix(got, "/api/grids/grid1/login?") {
		t.Errorf("expected login redirect, got %q", got)
	}
	if _, ok := env.cache.Get("provider-admin", "grid1"); ok {
		t.Error("expected stale token to be invalidated after upstream 401")
	}
}

func TestProxy_UnknownGrid404(t *testing.T) {
	env := newTestEnv(t)
	rec := env.do(t, http.MethodGet, "/api/grids/nope/anything", sessionCookie("u"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

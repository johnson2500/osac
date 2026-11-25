// Package grid implements single-login access to AI Grid hubs from the OSAC
// UI: the proxy silently exchanges the browser's OSAC Keycloak session for a
// per-hub OAuth token (authorize-code + PKCE against the hub's OpenShift
// OAuth, which federates back to the same Keycloak) and forwards per-grid
// API calls with that token injected. See OSAC-8173.
package grid

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	log "github.com/sirupsen/logrus"

	"github.com/osac/proxy/auth"
)

const (
	// gridFlowCookiePrefix namespaces the short-lived OAuth flow cookies.
	gridFlowCookiePrefix = "osac-grid-auth-"
	// gridFlowCookieMaxAge bounds the login→callback round trip.
	gridFlowCookieMaxAge = 10 * 60 // 10 minutes

	// maxCacheTTL caps how long a hub token is reused. Hub tokens live 24 h
	// and cannot be refreshed; 401 responses always invalidate early.
	maxCacheTTL = 8 * time.Hour
	// defaultCacheTTL is used when the hub does not report expires_in.
	defaultCacheTTL = 1 * time.Hour

	// gridLoginHeader tells the SPA where to send the browser when a grid
	// token is missing or was rejected (401) upstream.
	gridLoginHeader = "X-Grid-Login-URL"
)

// gridFlowCookie holds the per-flow state, keyed by OAuth state (CSRF).
type gridFlowCookie struct {
	Verifier string `json:"verifier"`
	GridID   string `json:"gridID"`
	Username string `json:"username"`
	Redirect string `json:"redirect"`
}

// Handler implements the per-grid login, callback, and forwarding routes.
type Handler struct {
	// Grids is the registry of known AI Grid hubs, keyed by grid ID.
	Grids map[string]Grid
	// Cache holds per-(user, grid) hub tokens.
	Cache *TokenCache
	// BaseUIURL is the public base URL of the UI; used to compute the OAuth
	// callback URI. If empty, the request origin is used.
	BaseUIURL string
	// HTTPClient is used for hub OAuth token exchange. If nil,
	// http.DefaultClient is used.
	HTTPClient *http.Client
	// ProxyTransport is the http.RoundTripper for forwarded grid requests.
	// If nil, http.DefaultTransport is used.
	ProxyTransport http.RoundTripper
}

// Login handles GET /api/grids/{gridID}/login — starts the hub OAuth
// authorize-code + PKCE flow for the current OSAC session. Query params:
//   - redirect (optional): path to return to after the callback; must be
//     same-site relative.
//
// The browser is redirected to the hub OAuth authorize URL with idp set to
// the grid's federated IdP, so a browser holding OSAC Keycloak SSO cookies
// completes the chain silently (no login form).
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	grid, ok := h.Grids[chi.URLParam(r, "gridID")]
	if !ok {
		http.NotFound(w, r)
		return
	}

	username := h.sessionUsername(r)
	if username == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	redirect := sanitizeRedirect(r.URL.Query().Get("redirect"))
	redirectURI := h.callbackURI(r, grid.ID)

	verifier, err := generateCodeVerifier()
	if err != nil {
		log.WithError(err).Error("failed to generate PKCE verifier")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	state, err := generateState()
	if err != nil {
		log.WithError(err).Error("failed to generate state")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if err := setGridFlowCookie(w, r, state, gridFlowCookie{
		Verifier: verifier,
		GridID:   grid.ID,
		Username: username,
		Redirect: redirect,
	}); err != nil {
		log.WithError(err).Error("failed to set grid auth flow cookie")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	params := url.Values{}
	params.Set("response_type", "code")
	params.Set("client_id", grid.ClientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("state", state)
	params.Set("code_challenge", codeChallenge(verifier))
	params.Set("code_challenge_method", "S256")
	if grid.IdP != "" {
		params.Set("idp", grid.IdP)
	}

	http.Redirect(w, r, grid.AuthorizeEndpoint()+"?"+params.Encode(), http.StatusFound)
}

// Callback handles GET /api/grids/{gridID}/callback?code=<code>&state=<state> —
// exchanges the hub OAuth code for a hub token, caches it for the user who
// started the flow, and returns the browser to the saved redirect path.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	gridID := chi.URLParam(r, "gridID")
	grid, ok := h.Grids[gridID]
	if !ok {
		http.NotFound(w, r)
		return
	}

	state := r.URL.Query().Get("state")
	code := r.URL.Query().Get("code")
	if state == "" || code == "" {
		http.Error(w, "state and code are required", http.StatusBadRequest)
		return
	}

	flow, err := getAndClearGridFlowCookie(w, r, state)
	if err != nil {
		log.WithError(err).Warn("grid auth flow cookie missing or invalid")
		http.Error(w, "invalid or expired state", http.StatusBadRequest)
		return
	}
	if flow.GridID != gridID {
		log.Warnf("grid auth flow cookie grid %q does not match callback grid %q", flow.GridID, gridID)
		http.Error(w, "invalid or expired state", http.StatusBadRequest)
		return
	}

	// The callback must complete for the same OSAC user who started it.
	if h.sessionUsername(r) != flow.Username {
		log.Warn("grid auth callback OSAC user differs from the user who started the flow")
		http.Error(w, "session changed during login", http.StatusUnauthorized)
		return
	}

	tr, err := h.exchangeCode(grid, code, flow.Verifier, h.callbackURI(r, gridID))
	if err != nil {
		log.WithError(err).Error("hub token exchange failed")
		http.Error(w, "hub token exchange failed", http.StatusBadGateway)
		return
	}

	ttl := time.Duration(tr.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = defaultCacheTTL
	}
	if ttl > maxCacheTTL {
		ttl = maxCacheTTL
	}
	h.cache().Set(flow.Username, gridID, tr.AccessToken, ttl)

	http.Redirect(w, r, flow.Redirect, http.StatusFound)
}

// gridSummary is the one grid fact the browser may see: its ID. Hub URLs,
// client credentials and IdP names stay server-side.
type gridSummary struct {
	ID string `json:"id"`
}

// List handles GET /api/grids — the grids the UI can offer, sorted by ID so
// the list is stable across pod restarts. Requires an OSAC session like the
// other grid routes.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h.sessionUsername(r) == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}
	ids := make([]string, 0, len(h.Grids))
	for id := range h.Grids {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	summaries := make([]gridSummary, 0, len(ids))
	for _, id := range ids {
		summaries = append(summaries, gridSummary{ID: id})
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string][]gridSummary{"grids": summaries}); err != nil {
		log.WithError(err).Error("failed to encode grid list")
	}
}

// Proxy handles /api/grids/{gridID}/* — forwards the request to the grid
// hub's console BFF with the cached hub token as the Authorization header.
//
// Without a cached token (or after an upstream 401 invalidated one) it
// responds 401 with the X-Grid-Login-URL header so the SPA can send the
// browser through the silent login flow.
func (h *Handler) Proxy(w http.ResponseWriter, r *http.Request) {
	gridID := chi.URLParam(r, "gridID")
	grid, ok := h.Grids[gridID]
	if !ok {
		http.NotFound(w, r)
		return
	}

	username := h.sessionUsername(r)
	if username == "" {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	token, ok := h.cache().Get(username, gridID)
	if !ok {
		h.writeGridUnauthorized(w, r, gridID)
		return
	}

	hubURL, err := url.Parse(strings.TrimSuffix(grid.HubURL, "/"))
	if err != nil {
		log.WithError(err).Errorf("invalid hubURL for grid %q", gridID)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(hubURL)
	proxy.Transport = h.ProxyTransport
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.WithError(err).Warnf("grid %q upstream request failed", gridID)
		http.Error(w, "grid upstream unavailable", http.StatusBadGateway)
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		if resp.StatusCode == http.StatusUnauthorized {
			// Token rejected upstream: drop it so the next request goes
			// through the silent login flow again.
			h.cache().Invalidate(username, gridID)
			if isBrowserNavigation(r) {
				// Rewrite the response into a redirect to the silent login
				// so top-level navigations recover seamlessly.
				if body := resp.Body; body != nil {
					if err := body.Close(); err != nil {
						log.WithError(err).Warn("failed to close upstream 401 body")
					}
				}
				resp.Body = io.NopCloser(strings.NewReader(""))
				resp.ContentLength = 0
				resp.Header.Del("Content-Length")
				resp.StatusCode = http.StatusFound
				resp.Header.Set("Location", loginRedirectTarget(gridID, r))
			} else {
				resp.Header.Set(gridLoginHeader, gridLoginPath(gridID))
			}
		}
		// 403 (and every other status) passes through unchanged: a grid the
		// user cannot access is reported, not broken. The SPA can tell the
		// grid from the request URL and hide/report it accordingly.
		return nil
	}

	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		// Strip the /api/grids/<gridID> prefix; everything after it is
		// forwarded verbatim (this preserves the console BFF's paths,
		// including the /perses/api/api/... double-api quirk).
		prefix := "/api/grids/" + gridID
		req.URL.Path = singleLeadingSlash(strings.TrimPrefix(req.URL.Path, prefix))
		req.URL.RawPath = singleLeadingSlash(strings.TrimPrefix(req.URL.RawPath, prefix))
		req.Host = hubURL.Host
		req.Header.Del("Authorization")
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Del("Cookie")
		req.Header.Del("X-Forwarded-For")
	}
	proxy.ServeHTTP(w, r)
}

// exchangeCode trades the hub OAuth authorization code for a hub token.
func (h *Handler) exchangeCode(grid Grid, code, verifier, redirectURI string) (*auth.TokenResponse, error) {
	httpClient := h.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}

	params := url.Values{}
	params.Set("grant_type", "authorization_code")
	params.Set("client_id", grid.ClientID)
	params.Set("code", code)
	params.Set("code_verifier", verifier)
	params.Set("redirect_uri", redirectURI)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, grid.TokenEndpoint(),
		strings.NewReader(params.Encode()))
	if err != nil {
		return nil, fmt.Errorf("build hub token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if grid.ClientSecret != "" {
		req.SetBasicAuth(grid.ClientID, grid.ClientSecret)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hub token request: %w", err)
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			log.WithError(err).Warn("failed to close hub token response body")
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hub token endpoint returned HTTP %d", resp.StatusCode)
	}
	var tr auth.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, fmt.Errorf("decode hub token response: %w", err)
	}
	if tr.AccessToken == "" {
		return nil, fmt.Errorf("hub token response contained no access_token")
	}
	return &tr, nil
}

// sessionUsername returns the OSAC username for the browser's session, or ""
// when there is no session or the username cannot be determined.
func (h *Handler) sessionUsername(r *http.Request) string {
	tokenData := auth.LookupSessionCookies(r)
	if tokenData == nil {
		return ""
	}
	idToken := tokenData.IDToken
	if idToken == "" {
		idToken = tokenData.AccessToken
	}
	return auth.UsernameFromToken(idToken)
}

// callbackURI computes the OAuth callback URI for a grid, preferring the
// configured public base URL and falling back to the request origin.
func (h *Handler) callbackURI(r *http.Request, gridID string) string {
	base := h.BaseUIURL
	if base == "" {
		scheme := "http"
		if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") || r.TLS != nil {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return strings.TrimSuffix(base, "/") + "/api/grids/" + gridID + "/callback"
}

// cache returns the handler's token cache, lazily creating one so a zero
// value Handler with only Grids set still works.
func (h *Handler) cache() *TokenCache {
	if h.Cache == nil {
		h.Cache = NewTokenCache()
	}
	return h.Cache
}

// writeGridUnauthorized responds to a token-less request. Browser navigations
// are redirected straight into the silent login flow; API calls (fetch/XHR)
// get a 401 with the X-Grid-Login-URL header so the SPA can navigate.
func (h *Handler) writeGridUnauthorized(w http.ResponseWriter, r *http.Request, gridID string) {
	if isBrowserNavigation(r) {
		http.Redirect(w, r, loginRedirectTarget(gridID, r), http.StatusFound)
		return
	}
	w.Header().Set(gridLoginHeader, gridLoginPath(gridID))
	http.Error(w, "no grid token; start grid login", http.StatusUnauthorized)
}

// isBrowserNavigation reports whether the request is a top-level browser
// navigation rather than an API call. Uses the Fetch Metadata header when
// present and falls back to accepting HTML for older browsers.
func isBrowserNavigation(r *http.Request) bool {
	mode := r.Header.Get("Sec-Fetch-Mode")
	if mode == "navigate" {
		return true
	}
	return mode == "" && r.Method == http.MethodGet &&
		strings.Contains(r.Header.Get("Accept"), "text/html")
}

// loginRedirectTarget builds the silent-login URL for a grid, preserving the
// current path and query as the post-login redirect target.
func loginRedirectTarget(gridID string, r *http.Request) string {
	loginURL := &url.URL{Path: gridLoginPath(gridID)}
	q := loginURL.Query()
	q.Set("redirect", r.URL.RequestURI())
	loginURL.RawQuery = q.Encode()
	return loginURL.String()
}

// gridLoginPath is the route that starts the silent hub login for a grid.
func gridLoginPath(gridID string) string {
	return "/api/grids/" + gridID + "/login"
}

// sanitizeRedirect keeps the post-login redirect same-site: relative paths
// only, no protocol-relative URLs. Defaults to "/".
func sanitizeRedirect(redirect string) string {
	if redirect == "" || !strings.HasPrefix(redirect, "/") || strings.HasPrefix(redirect, "//") {
		return "/"
	}
	return redirect
}

// singleLeadingSlash normalizes a path that may be empty after prefix strip.
func singleLeadingSlash(p string) string {
	if p == "" {
		return "/"
	}
	return p
}

func setGridFlowCookie(w http.ResponseWriter, r *http.Request, state string, flow gridFlowCookie) error {
	b, err := json.Marshal(flow)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     gridFlowCookiePrefix + state,
		Value:    base64.StdEncoding.EncodeToString(b),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   auth.IsSecure(r, ""),
		MaxAge:   gridFlowCookieMaxAge,
	})
	return nil
}

func getAndClearGridFlowCookie(w http.ResponseWriter, r *http.Request, state string) (*gridFlowCookie, error) {
	name := gridFlowCookiePrefix + state
	cookie, err := r.Cookie(name)
	if err != nil {
		return nil, fmt.Errorf("grid auth flow cookie not found: %w", err)
	}
	// Clear immediately to prevent replay.
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: true, MaxAge: -1})

	b, err := base64.StdEncoding.DecodeString(cookie.Value)
	if err != nil {
		return nil, fmt.Errorf("decode grid auth flow cookie: %w", err)
	}
	var flow gridFlowCookie
	if err := json.Unmarshal(b, &flow); err != nil {
		return nil, fmt.Errorf("unmarshal grid auth flow cookie: %w", err)
	}
	return &flow, nil
}

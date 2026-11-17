//go:build unit

package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/servertiming"
)

// Keep the production transport settings and instrumentation. Only the dialer
// is replaced so these tests can reach a local httptest server.
func useLocalMonitorClient(t *testing.T, timeout time.Duration) {
	t.Helper()
	transport := newMonitorHTTPTransport()
	transport.DialContext = (&net.Dialer{}).DialContext
	original := monitorHTTPClient
	monitorHTTPClient = &http.Client{
		Timeout:   timeout,
		Transport: servertiming.WrapRoundTripper(transport),
	}
	t.Cleanup(func() {
		monitorHTTPClient = original
		transport.CloseIdleConnections()
	})
}

func TestMonitorProbe_ResponseAfterThirtySeconds(t *testing.T) {
	if testing.Short() {
		t.Skip("regression test waits past the former 30-second header timeout")
	}
	useLocalMonitorClient(t, monitorRequestTimeout)
	handler := &openAICaptureHandler{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		timer := time.NewTimer(31 * time.Second)
		defer timer.Stop()
		select {
		case <-timer.C:
			handler.ServeHTTP(w, r)
		case <-r.Context().Done():
		}
	}))
	defer srv.Close()

	result := runCheckForModel(context.Background(), MonitorProviderOpenAI, srv.URL, "test-key", "test-model", nil)
	if result.Status != MonitorStatusDegraded || !strings.HasPrefix(result.Message, "slow response:") {
		t.Fatalf("valid slow response should remain available, got status=%s message=%s", result.Status, result.Message)
	}
}

func TestMonitorProbe_TimeoutStage(t *testing.T) {
	for _, sendHeaders := range []bool{false, true} {
		name := "before_headers"
		want := "probe timeout (before response headers)"
		if sendHeaders {
			name = "reading_body"
			want = "probe timeout (reading response body, HTTP 200)"
		}
		t.Run(name, func(t *testing.T) {
			useLocalMonitorClient(t, 500*time.Millisecond)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if sendHeaders {
					w.WriteHeader(http.StatusOK)
					w.(http.Flusher).Flush()
				}
				<-r.Context().Done()
			}))
			defer srv.Close()
			result := runCheckForModel(context.Background(), MonitorProviderOpenAI, srv.URL, "test-key", "test-model", nil)
			if result.Status != MonitorStatusError || !strings.HasPrefix(result.Message, want) {
				t.Fatalf("expected %q, got status=%s message=%s", want, result.Status, result.Message)
			}
		})
	}
}

func TestMonitorProbe_UpstreamHTTPErrorPreserved(t *testing.T) {
	useLocalMonitorClient(t, monitorRequestTimeout)
	srv := httptest.NewServer(&openAICaptureHandler{
		status:      http.StatusServiceUnavailable,
		rawResponse: `{"error":{"message":"temporarily unavailable"}}`,
	})
	defer srv.Close()
	result := runCheckForModel(context.Background(), MonitorProviderOpenAI, srv.URL, "test-key", "test-model", nil)
	if result.Status != MonitorStatusError || !strings.HasPrefix(result.Message, "upstream HTTP 503:") {
		t.Fatalf("HTTP failure must remain an error, got status=%s message=%s", result.Status, result.Message)
	}
}

func TestMonitorProbe_ErrorCauseAndRedaction(t *testing.T) {
	for _, tc := range []struct {
		cause error
		want  string
	}{
		{context.Canceled, "probe canceled"},
		{context.DeadlineExceeded, "probe timeout"},
		{errors.New("connection reset"), "probe request failed"},
	} {
		t.Run(tc.want, func(t *testing.T) {
			err := wrapMonitorProbeError("before response headers", tc.cause)
			if !errors.Is(err, tc.cause) || !strings.HasPrefix(err.Error(), tc.want) {
				t.Fatalf("cause or category lost: %v", err)
			}
		})
	}
	err := wrapMonitorProbeError("before response headers", errors.New("https://example.com?api_key=secret-value"))
	if strings.Contains(sanitizeErrorMessage(err.Error()), "secret-value") {
		t.Fatal("wrapped errors must still redact credentials")
	}
}

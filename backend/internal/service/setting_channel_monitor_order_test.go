package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

// channelMonitorOrderSettingRepo 是渠道排序测试用的内存版 SettingRepository。
type channelMonitorOrderSettingRepo struct {
	mu     sync.Mutex
	values map[string]string
	getErr error
}

func newChannelMonitorOrderSettingRepo() *channelMonitorOrderSettingRepo {
	return &channelMonitorOrderSettingRepo{values: map[string]string{}}
}

func (r *channelMonitorOrderSettingRepo) Get(_ context.Context, key string) (*Setting, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.getErr != nil {
		return nil, r.getErr
	}
	value, ok := r.values[key]
	if !ok {
		return nil, ErrSettingNotFound
	}
	return &Setting{Key: key, Value: value}, nil
}

func (r *channelMonitorOrderSettingRepo) GetValue(ctx context.Context, key string) (string, error) {
	setting, err := r.Get(ctx, key)
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}

func (r *channelMonitorOrderSettingRepo) Set(_ context.Context, key, value string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.values[key] = value
	return nil
}

func (r *channelMonitorOrderSettingRepo) GetMultiple(_ context.Context, keys []string) (map[string]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]string, len(keys))
	for _, key := range keys {
		if value, ok := r.values[key]; ok {
			out[key] = value
		}
	}
	return out, nil
}

func (r *channelMonitorOrderSettingRepo) SetMultiple(_ context.Context, settings map[string]string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for key, value := range settings {
		r.values[key] = value
	}
	return nil
}

func (r *channelMonitorOrderSettingRepo) GetAll(_ context.Context) (map[string]string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make(map[string]string, len(r.values))
	for key, value := range r.values {
		out[key] = value
	}
	return out, nil
}

func (r *channelMonitorOrderSettingRepo) Delete(_ context.Context, key string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.values, key)
	return nil
}

var _ SettingRepository = (*channelMonitorOrderSettingRepo)(nil)

func TestChannelMonitorOrderRoundTrip(t *testing.T) {
	repo := newChannelMonitorOrderSettingRepo()
	svc := NewSettingService(repo, nil)

	// 未设置时返回空顺序，且集合非 nil，前端无需额外兜底。
	empty := svc.GetChannelMonitorOrder(context.Background())
	require.NotNil(t, empty.Providers)
	require.NotNil(t, empty.Channels)
	require.Empty(t, empty.Providers)
	require.Empty(t, empty.Channels)

	require.NoError(t, svc.SetChannelMonitorOrder(context.Background(), ChannelMonitorOrder{
		Providers: []string{"anthropic", "openai"},
		Channels:  map[string][]int64{"openai": {3, 1}},
	}))

	got := svc.GetChannelMonitorOrder(context.Background())
	require.Equal(t, []string{"anthropic", "openai"}, got.Providers)
	require.Equal(t, []int64{3, 1}, got.Channels["openai"])

	// 持久化契约：存进去的是 JSON 文本。
	raw, err := repo.GetValue(context.Background(), SettingKeyChannelMonitorOrder)
	require.NoError(t, err)
	require.JSONEq(t, `{"providers":["anthropic","openai"],"channels":{"openai":[3,1]}}`, raw)
}

func TestChannelMonitorOrderFallsBackToEmpty(t *testing.T) {
	cases := map[string]string{
		"malformed": "{not-json",
		"blank":     "   ",
		"null":      "null",
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			repo := newChannelMonitorOrderSettingRepo()
			repo.values[SettingKeyChannelMonitorOrder] = raw
			svc := NewSettingService(repo, nil)

			got := svc.GetChannelMonitorOrder(context.Background())
			require.NotNil(t, got.Providers)
			require.NotNil(t, got.Channels)
			require.Empty(t, got.Providers)
			require.Empty(t, got.Channels)
		})
	}
}

func TestChannelMonitorOrderReadErrorReturnsEmpty(t *testing.T) {
	repo := newChannelMonitorOrderSettingRepo()
	repo.getErr = errors.New("boom")
	svc := NewSettingService(repo, nil)

	got := svc.GetChannelMonitorOrder(context.Background())
	require.NotNil(t, got.Providers)
	require.NotNil(t, got.Channels)
}

func TestChannelMonitorOrderNilServiceIsSafe(t *testing.T) {
	var svc *SettingService

	got := svc.GetChannelMonitorOrder(context.Background())
	require.NotNil(t, got.Providers)
	require.NotNil(t, got.Channels)

	require.Error(t, svc.SetChannelMonitorOrder(context.Background(), ChannelMonitorOrder{}))
}

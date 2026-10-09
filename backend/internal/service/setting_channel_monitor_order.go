package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

// ChannelMonitorOrder 是渠道状态页（/monitor）的全站展示顺序：先供应商分组，
// 再是每个分组内的渠道。由管理员设置一次，所有用户读取同一份顺序。
// 持久化在系统设置 SettingKeyChannelMonitorOrder，值为 JSON。
type ChannelMonitorOrder struct {
	Providers []string           `json:"providers"`
	Channels  map[string][]int64 `json:"channels"`
}

// EmptyChannelMonitorOrder 表示"未自定义排序"的默认顺序。
func EmptyChannelMonitorOrder() ChannelMonitorOrder {
	return ChannelMonitorOrder{Providers: []string{}, Channels: map[string][]int64{}}
}

// normalize 复制一份并保证集合非 nil，让 JSON 与接口响应稳定（不出现 null）。
func (o ChannelMonitorOrder) normalize() ChannelMonitorOrder {
	if o.Providers == nil {
		o.Providers = []string{}
	}
	if o.Channels == nil {
		o.Channels = map[string][]int64{}
	}
	return o
}

// GetChannelMonitorOrder 读取全站渠道展示顺序。未设置/不可读/格式损坏时返回空顺序，
// 永不返回错误，避免读路径影响页面展示。
func (s *SettingService) GetChannelMonitorOrder(ctx context.Context) ChannelMonitorOrder {
	if s == nil || s.settingRepo == nil {
		return EmptyChannelMonitorOrder()
	}
	dbCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), gatewayForwardingDBTimeout)
	defer cancel()
	raw, err := s.settingRepo.GetValue(dbCtx, SettingKeyChannelMonitorOrder)
	if err != nil || strings.TrimSpace(raw) == "" {
		return EmptyChannelMonitorOrder()
	}
	var order ChannelMonitorOrder
	if err := json.Unmarshal([]byte(raw), &order); err != nil {
		return EmptyChannelMonitorOrder()
	}
	return order.normalize()
}

// SetChannelMonitorOrder 保存全站渠道展示顺序（仅管理员可调用）。
func (s *SettingService) SetChannelMonitorOrder(ctx context.Context, order ChannelMonitorOrder) error {
	payload, err := json.Marshal(order.normalize())
	if err != nil {
		return err
	}
	if s == nil || s.settingRepo == nil {
		return errors.New("setting service is not available")
	}
	return s.settingRepo.Set(ctx, SettingKeyChannelMonitorOrder, string(payload))
}

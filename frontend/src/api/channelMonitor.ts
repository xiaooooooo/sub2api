/**
 * User-facing Channel Monitor API endpoints
 * Read-only views for end users to inspect channel availability/status.
 */

import { apiClient } from './client'
import type { MonitorQuotaSnapshot, Provider, MonitorStatus } from './admin/channelMonitor'

export type { Provider, MonitorStatus } from './admin/channelMonitor'

export interface UserMonitorExtraModel {
  model: string
  status: MonitorStatus
  latency_ms: number | null
}

export interface MonitorTimelinePoint {
  status: MonitorStatus
  latency_ms: number | null
  ping_latency_ms: number | null
  checked_at: string
}

export interface UserMonitorView {
  id: number
  name: string
  provider: Provider
  group_name: string
  primary_model: string
  primary_status: MonitorStatus
  primary_latency_ms: number | null
  primary_ping_latency_ms: number | null
  availability_7d: number
  extra_models: UserMonitorExtraModel[]
  timeline: MonitorTimelinePoint[]
  /**
   * 主模型最近配额快照。仅当系统开启 channel_monitor_show_quota 时
   * 服务端才会下发（关闭时服务端已剥离，前端 flag 仅作纵深防御）。
   */
  latest_quota?: MonitorQuotaSnapshot | null
}

export interface UserMonitorListResponse {
  items: UserMonitorView[]
}

export interface UserMonitorModelDetail {
  model: string
  latest_status: MonitorStatus
  latest_latency_ms: number | null
  availability_7d: number
  availability_15d: number
  availability_30d: number
  avg_latency_7d_ms: number | null
}

export interface UserMonitorDetail {
  id: number
  name: string
  provider: Provider
  group_name: string
  models: UserMonitorModelDetail[]
}

/**
 * 渠道状态页（/monitor）的全站展示顺序：先供应商分组，再是分组内的渠道。
 * 由管理员保存一次，所有用户读取同一份顺序。
 */
export interface ChannelMonitorOrder {
  providers: string[]
  channels: Record<string, number[]>
}

/** 归一化服务端/本地的排序数据，丢弃非法项，避免脏数据破坏页面。 */
export function normalizeChannelMonitorOrder(order?: Partial<ChannelMonitorOrder> | null): ChannelMonitorOrder {
  const providers = Array.isArray(order?.providers)
    ? order.providers.filter((provider): provider is string => typeof provider === 'string')
    : []
  const channels: Record<string, number[]> = {}
  if (order?.channels && typeof order.channels === 'object') {
    for (const [provider, ids] of Object.entries(order.channels)) {
      channels[provider] = Array.isArray(ids)
        ? ids.filter((id): id is number => Number.isInteger(id))
        : []
    }
  }
  return { providers, channels }
}

/**
 * 旧版本把排序存在浏览器 localStorage 里。升级为"全站统一顺序"后，这个 key
 * 只用于管理员的一次性迁移：服务端还没有顺序时，把旧的本机顺序补写上去。
 */
export const CHANNEL_MONITOR_ORDER_STORAGE_KEY = 'sub2api:channel-monitor-order:v1'

/** 读取旧版本保存在浏览器本地的排序；不存在或已损坏时返回 null。 */
export function readLocalChannelMonitorOrder(): ChannelMonitorOrder | null {
  try {
    const raw = globalThis.localStorage?.getItem(CHANNEL_MONITOR_ORDER_STORAGE_KEY)
    if (!raw) return null
    return normalizeChannelMonitorOrder(JSON.parse(raw) as Partial<ChannelMonitorOrder>)
  } catch {
    return null
  }
}

/** 判断排序是否为空（没有指定任何分组或分组内顺序）。 */
export function isEmptyChannelMonitorOrder(order: ChannelMonitorOrder | null | undefined): boolean {
  if (!order) return true
  return order.providers.length === 0 && Object.keys(order.channels).length === 0
}

/**
 * List all monitor views available to the current user.
 */
export async function list(options?: { signal?: AbortSignal }): Promise<UserMonitorListResponse> {
  const { data } = await apiClient.get<UserMonitorListResponse>('/channel-monitors', {
    signal: options?.signal,
  })
  return data
}

/**
 * Get detailed status (multi-window availability + latency) for a single monitor.
 */
export async function status(id: number): Promise<UserMonitorDetail> {
  const { data } = await apiClient.get<UserMonitorDetail>(`/channel-monitors/${id}/status`)
  return data
}

/**
 * Read the site-wide channel monitor order (shared by every user).
 */
export async function getOrder(): Promise<ChannelMonitorOrder> {
  const { data } = await apiClient.get<{ order?: Partial<ChannelMonitorOrder> | null }>('/channel-monitors/order')
  return normalizeChannelMonitorOrder(data?.order)
}

/**
 * Persist the site-wide channel monitor order (admin only).
 */
export async function saveOrder(order: ChannelMonitorOrder): Promise<ChannelMonitorOrder> {
  const { data } = await apiClient.put<{ order?: Partial<ChannelMonitorOrder> | null }>(
    '/channel-monitors/order',
    normalizeChannelMonitorOrder(order),
  )
  return normalizeChannelMonitorOrder(data?.order)
}

export const channelMonitorUserAPI = {
  list,
  status,
  getOrder,
  saveOrder,
}

export default channelMonitorUserAPI

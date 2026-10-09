<template>
  <AppLayout>
    <MonitorHero
      :overall-status="overallStatus"
      :interval-seconds="DEFAULT_INTERVAL_SECONDS"
      :window="currentWindow"
      :loading="loading"
      :reordering="reordering"
      :can-reorder="canReorder"
      :auto-refresh="autoRefresh"
      @update:window="handleWindowChange"
      @toggle-reordering="toggleReordering"
      @refresh="manualReload"
    />

    <MonitorCardGrid
      :items="items"
      :window="currentWindow"
      :countdown-seconds="countdown"
      :loading="loading"
      :reordering="reordering"
      :can-reorder="canReorder"
      :order="monitorOrder"
      :detail-cache="detailCache"
      @card-click="openDetail"
      @order-change="handleOrderChange"
    />

    <MonitorDetailDialog
      :show="showDetail"
      :monitor-id="detailTarget?.id ?? null"
      :title="detailTitle"
      @close="closeDetail"
    />
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { extractApiErrorMessage } from '@/utils/apiError'
import {
  list as listChannelMonitorViews,
  status as fetchChannelMonitorDetail,
  getOrder as fetchChannelMonitorOrder,
  saveOrder as persistChannelMonitorOrder,
  readLocalChannelMonitorOrder,
  normalizeChannelMonitorOrder,
  isEmptyChannelMonitorOrder,
  type ChannelMonitorOrder,
  type UserMonitorView,
  type UserMonitorDetail,
} from '@/api/channelMonitor'
import AppLayout from '@/components/layout/AppLayout.vue'
import MonitorHero, {
  type MonitorWindow,
  type OverallStatus,
} from '@/components/user/monitor/MonitorHero.vue'
import MonitorCardGrid from '@/components/user/monitor/MonitorCardGrid.vue'
import MonitorDetailDialog from '@/components/user/MonitorDetailDialog.vue'
import { DEFAULT_INTERVAL_SECONDS, STATUS_OPERATIONAL } from '@/constants/channelMonitor'
import { useAutoRefresh } from '@/composables/useAutoRefresh'

const { t } = useI18n()
const appStore = useAppStore()
const authStore = useAuthStore()

// ── State ──
const items = ref<UserMonitorView[]>([])
const loading = ref(false)
const reordering = ref(false)
// 调整渠道/分组排序是管理员专属功能，普通用户只能查看默认顺序。
const canReorder = computed(() => authStore.isAdmin)
// 全站统一的展示顺序：管理员保存一次，所有用户共用服务端这一份。
const monitorOrder = ref<ChannelMonitorOrder>(normalizeChannelMonitorOrder(null))
const currentWindow = ref<MonitorWindow>('7d')
const detailCache = reactive<Record<number, UserMonitorDetail>>({})
const showDetail = ref(false)
const detailTarget = ref<UserMonitorView | null>(null)

let abortController: AbortController | null = null

const autoRefresh = useAutoRefresh({
  storageKey: 'channel-status-auto-refresh',
  intervals: [30, 60, 120] as const,
  defaultInterval: DEFAULT_INTERVAL_SECONDS,
  defaultEnabled: true,
  onRefresh: () => reload(true),
  shouldPause: () => document.hidden || loading.value,
})
const countdown = autoRefresh.countdown

// ── Computed ──
const overallStatus = computed<OverallStatus>(() => {
  if (items.value.length === 0) return 'operational'
  for (const it of items.value) {
    if (it.primary_status === 'failed' || it.primary_status === 'error') return 'degraded'
    if (it.primary_status !== STATUS_OPERATIONAL) return 'degraded'
  }
  return 'operational'
})

const detailTitle = computed(() => {
  return detailTarget.value?.name || t('channelStatus.detailTitle')
})

// ── Loaders ──
async function reload(silent = false) {
  if (abortController) abortController.abort()
  const ctrl = new AbortController()
  abortController = ctrl
  if (!silent) loading.value = true
  try {
    const res = await listChannelMonitorViews({ signal: ctrl.signal })
    if (ctrl.signal.aborted || abortController !== ctrl) return
    items.value = res.items || []
  } catch (err: unknown) {
    const e = err as { name?: string; code?: string }
    if (e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return
    appStore.showError(extractApiErrorMessage(err, t('channelStatus.loadError')))
  } finally {
    if (abortController === ctrl) {
      if (!silent) loading.value = false
      autoRefresh.resetCountdown()
      abortController = null
    }
  }
}

async function manualReload() {
  await reload(false)
  // After base reload, refresh any cached detail records so non-7d availability
  // values stay in sync without forcing the user to switch tabs again.
  if (currentWindow.value !== '7d') {
    await Promise.all(items.value.map(it => loadDetail(it.id, true)))
  }
}

// ── Channel monitor order (site-wide) ──
// 排序由管理员设置一次，服务端保存，所有用户读取同一份顺序。
let localOrderMigrationAttempted = false

async function loadMonitorOrder() {
  try {
    const order = await fetchChannelMonitorOrder()
    monitorOrder.value = order
    await maybeMigrateLocalOrder(order)
  } catch {
    // 读取失败时保持默认顺序，不阻塞渠道列表展示。
  }
}

// 一次性迁移：旧版本把顺序存在浏览器本地，服务端还没有顺序时把它补写上去。
async function maybeMigrateLocalOrder(serverOrder: ChannelMonitorOrder) {
  if (localOrderMigrationAttempted) return
  localOrderMigrationAttempted = true
  if (!canReorder.value || !isEmptyChannelMonitorOrder(serverOrder)) return
  const local = readLocalChannelMonitorOrder()
  if (!local || isEmptyChannelMonitorOrder(local)) return
  await handleOrderChange(local)
}

async function handleOrderChange(order: ChannelMonitorOrder) {
  // 先本地生效再异步保存，避免保存期间顺序回跳。
  monitorOrder.value = normalizeChannelMonitorOrder(order)
  try {
    monitorOrder.value = await persistChannelMonitorOrder(monitorOrder.value)
  } catch (err: unknown) {
    appStore.showError(extractApiErrorMessage(err, t('channelStatus.orderSaveError')))
    await loadMonitorOrder()
  }
}

async function loadDetail(id: number, force = false) {
  if (!force && detailCache[id]) return
  try {
    detailCache[id] = await fetchChannelMonitorDetail(id)
  } catch (err: unknown) {
    appStore.showError(extractApiErrorMessage(err, t('channelStatus.detailLoadError')))
  }
}

async function ensureDetailsForWindow() {
  if (currentWindow.value === '7d') return
  await Promise.all(items.value.map(it => loadDetail(it.id)))
}

// ── Handlers ──
async function handleWindowChange(value: MonitorWindow) {
  currentWindow.value = value
  await ensureDetailsForWindow()
}

function openDetail(row: UserMonitorView) {
  detailTarget.value = row
  showDetail.value = true
}

function toggleReordering() {
  if (!canReorder.value) return
  reordering.value = !reordering.value
}

function closeDetail() {
  showDetail.value = false
  detailTarget.value = null
}

watch(items, () => {
  void ensureDetailsForWindow()
})

// 管理员退出登录后立即退出排序模式。
watch(canReorder, (allowed) => {
  if (!allowed) reordering.value = false
})

watch(
  () => appStore.cachedPublicSettings?.channel_monitor_enabled,
  (enabled) => {
    if (enabled === false) autoRefresh.stop()
    else if (autoRefresh.enabled.value) autoRefresh.start()
  },
)

onMounted(() => {
  void reload(false)
  void loadMonitorOrder()
  if (appStore.cachedPublicSettings?.channel_monitor_enabled !== false) {
    autoRefresh.setEnabled(autoRefresh.enabled.value)
  }
})

onBeforeUnmount(() => {
  if (abortController) abortController.abort()
})
</script>

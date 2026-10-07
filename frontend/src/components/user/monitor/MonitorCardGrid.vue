<template>
  <div>
    <div
      v-if="loading && items.length === 0"
      class="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    >
      <div
        v-for="i in 6"
        :key="i"
        class="p-5 rounded-2xl min-h-[280px] bg-white/70 dark:bg-dark-800/60 border border-gray-200/80 dark:border-dark-700/70 animate-pulse"
      >
        <div class="flex items-start gap-3">
          <div class="w-9 h-9 rounded-xl bg-gray-200 dark:bg-dark-700"></div>
          <div class="flex-1 space-y-2">
            <div class="h-4 w-2/3 rounded bg-gray-200 dark:bg-dark-700"></div>
            <div class="h-3 w-1/2 rounded bg-gray-200 dark:bg-dark-700"></div>
          </div>
          <div class="h-6 w-16 rounded-full bg-gray-200 dark:bg-dark-700"></div>
        </div>
        <div class="mt-5 grid grid-cols-2 gap-2">
          <div class="h-16 rounded-xl bg-gray-100 dark:bg-dark-900/40"></div>
          <div class="h-16 rounded-xl bg-gray-100 dark:bg-dark-900/40"></div>
        </div>
        <div class="mt-6 h-5 w-full rounded bg-gray-100 dark:bg-dark-900/40"></div>
      </div>
    </div>

    <EmptyState
      v-else-if="items.length === 0"
      :title="t('channelStatus.empty.title')"
      :description="t('channelStatus.empty.description')"
    />

    <div v-else class="space-y-8">
      <VueDraggable
        v-model="providerGroups"
        item-key="provider"
        :animation="180"
        :disabled="!reordering"
        handle=".provider-drag-handle"
        class="space-y-8"
        @end="persistOrder"
      >
      <section
        v-for="group in providerGroups"
        :key="group.provider"
        class="space-y-3"
        :aria-label="providerLabel(group.provider)"
      >
        <h2 class="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          <button
            v-if="reordering"
            type="button"
            class="provider-drag-handle cursor-grab rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing dark:hover:bg-dark-700 dark:hover:text-gray-200"
            :title="t('channelStatus.dragProvider')"
            :aria-label="t('channelStatus.dragProvider')"
          >
            <Icon name="menu" size="sm" />
          </button>
          <ProviderIcon :provider="group.provider" :size="20" />
          {{ providerLabel(group.provider) }}
          <span class="text-sm font-normal text-gray-500 dark:text-gray-400">({{ group.items.length }})</span>
        </h2>
        <VueDraggable
          v-model="group.items"
          item-key="id"
          :animation="180"
          :disabled="!reordering"
          handle=".channel-drag-handle"
          class="grid gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          @end="persistOrder"
        >
          <div
            v-for="item in group.items"
            :key="item.id"
            class="relative"
          >
            <button
              v-if="reordering"
              type="button"
              class="channel-drag-handle absolute right-3 top-3 z-10 cursor-grab rounded p-1 text-gray-400 hover:bg-white/80 hover:text-gray-600 active:cursor-grabbing dark:hover:bg-dark-800/80 dark:hover:text-gray-200"
              :title="t('channelStatus.dragChannel')"
              :aria-label="t('channelStatus.dragChannel')"
            >
              <Icon name="menu" size="sm" />
            </button>
            <MonitorCard
              :item="item"
              :window="window"
              :availability-value="resolveAvailability(item)"
              :countdown-seconds="countdownSeconds"
              @click="handleCardClick(item)"
            />
          </div>
        </VueDraggable>
      </section>
      </VueDraggable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import type { UserMonitorView, UserMonitorDetail } from '@/api/channelMonitor'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import EmptyState from '@/components/common/EmptyState.vue'
import MonitorCard from './MonitorCard.vue'
import ProviderIcon from './ProviderIcon.vue'
import Icon from '@/components/icons/Icon.vue'

const MONITOR_ORDER_STORAGE_KEY = 'sub2api:channel-monitor-order:v1'

interface ProviderGroup {
  provider: string
  items: UserMonitorView[]
}

interface SavedOrder {
  providers: string[]
  channels: Record<string, number[]>
}

const props = defineProps<{
  items: UserMonitorView[]
  window: '7d' | '15d' | '30d'
  countdownSeconds: number
  loading: boolean
  reordering: boolean
  detailCache: Record<number, UserMonitorDetail>
}>()

const emit = defineEmits<{
  (e: 'cardClick', item: UserMonitorView): void
}>()

const { t } = useI18n()
const { providerLabel } = useChannelMonitorFormat()

const providerGroups = ref<ProviderGroup[]>([])
const savedOrder = ref<SavedOrder>(readSavedOrder())

function readSavedOrder(): SavedOrder {
  try {
    const raw = globalThis.localStorage?.getItem(MONITOR_ORDER_STORAGE_KEY)
    if (!raw) return { providers: [], channels: {} }
    const parsed = JSON.parse(raw) as Partial<SavedOrder>
    return {
      providers: Array.isArray(parsed.providers)
        ? parsed.providers.filter((provider): provider is string => typeof provider === 'string')
        : [],
      channels: parsed.channels && typeof parsed.channels === 'object'
        ? Object.fromEntries(Object.entries(parsed.channels).map(([provider, ids]) => [
          provider,
          Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [],
        ]))
        : {},
    }
  } catch {
    return { providers: [], channels: {} }
  }
}

function persistOrder() {
  const order: SavedOrder = {
    providers: providerGroups.value.map(group => group.provider),
    channels: Object.fromEntries(providerGroups.value.map(group => [
      group.provider,
      group.items.map(item => item.id),
    ])),
  }
  savedOrder.value = order
  try {
    globalThis.localStorage?.setItem(MONITOR_ORDER_STORAGE_KEY, JSON.stringify(order))
  } catch {
    // Storage can be unavailable in private browsing; ordering still works for this view.
  }
}

function reconcileGroups(items: UserMonitorView[]) {
  const groups = new Map<string, UserMonitorView[]>()
  for (const item of items) {
    const provider = item.provider || ''
    const group = groups.get(provider) || []
    group.push(item)
    groups.set(provider, group)
  }
  const incomingProviders = Array.from(groups.keys())
  const currentProviders = providerGroups.value.map(group => group.provider)
  const providerOrder = [...new Set([
    ...currentProviders,
    ...savedOrder.value.providers,
    ...incomingProviders,
  ])].filter(provider => groups.has(provider))

  providerGroups.value = providerOrder.map(provider => {
    const incoming = groups.get(provider) || []
    const incomingById = new Map(incoming.map(item => [item.id, item]))
    const currentIds = providerGroups.value.find(group => group.provider === provider)?.items.map(item => item.id) || []
    const savedIds = savedOrder.value.channels[provider] || []
    const itemOrder = [...new Set([...currentIds, ...savedIds, ...incoming.map(item => item.id)])]
    return {
      provider,
      items: itemOrder.map(id => incomingById.get(id)).filter((item): item is UserMonitorView => Boolean(item)),
    }
  })

  persistOrder()
}

function handleCardClick(item: UserMonitorView) {
  if (!props.reordering) emit('cardClick', item)
}

watch(() => props.items, reconcileGroups, { immediate: true })

function resolveAvailability(item: UserMonitorView): number | null {
  if (props.window === '7d') {
    return item.availability_7d ?? null
  }
  const detail = props.detailCache[item.id]
  if (!detail) return null
  const primary = detail.models.find(m => m.model === item.primary_model)
  if (!primary) return null
  return props.window === '15d' ? primary.availability_15d ?? null : primary.availability_30d ?? null
}
</script>

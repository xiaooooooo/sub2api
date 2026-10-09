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
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'
import {
  normalizeChannelMonitorOrder,
  type UserMonitorView,
  type UserMonitorDetail,
  type ChannelMonitorOrder,
} from '@/api/channelMonitor'
import { useChannelMonitorFormat } from '@/composables/useChannelMonitorFormat'
import EmptyState from '@/components/common/EmptyState.vue'
import MonitorCard from './MonitorCard.vue'
import ProviderIcon from './ProviderIcon.vue'
import Icon from '@/components/icons/Icon.vue'

interface ProviderGroup {
  provider: string
  items: UserMonitorView[]
}

const props = withDefaults(defineProps<{
  items: UserMonitorView[]
  window: '7d' | '15d' | '30d'
  countdownSeconds: number
  loading: boolean
  reordering: boolean
  canReorder?: boolean
  order?: ChannelMonitorOrder | null
  detailCache: Record<number, UserMonitorDetail>
}>(), {
  // 默认允许排序：只有显式传入 false（普通用户）时才禁用。
  canReorder: true,
  order: null,
})

const emit = defineEmits<{
  (e: 'cardClick', item: UserMonitorView): void
  (e: 'orderChange', order: ChannelMonitorOrder): void
}>()

const { t } = useI18n()
const { providerLabel } = useChannelMonitorFormat()

const canReorder = computed(() => props.canReorder !== false)
const providerGroups = ref<ProviderGroup[]>([])

// 全站统一顺序：以服务端下发的 order 为准，管理员排一次所有用户都按它展示。
function currentOrder(): ChannelMonitorOrder {
  return normalizeChannelMonitorOrder(props.order)
}

function persistOrder() {
  // 仅管理员可以调整顺序；普通用户只读服务端下发的顺序。
  if (!canReorder.value) return
  // 没有任何分组时不提交：组件首次挂载（items 还是空数组）以及监控被关闭
  // 时都会走到这里，若提交空顺序会把管理员已保存的全站顺序清空。
  if (providerGroups.value.length === 0) return
  emit('orderChange', {
    providers: providerGroups.value.map(group => group.provider),
    channels: Object.fromEntries(providerGroups.value.map(group => [
      group.provider,
      group.items.map(item => item.id),
    ])),
  })
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
  const order = currentOrder()
  // 服务端顺序优先，其次是当前渲染顺序，最后按首次出现的顺序追加新分组。
  const providerOrder = [...new Set([
    ...order.providers,
    ...currentProviders,
    ...incomingProviders,
  ])].filter(provider => groups.has(provider))

  providerGroups.value = providerOrder.map(provider => {
    const incoming = groups.get(provider) || []
    const incomingById = new Map(incoming.map(item => [item.id, item]))
    const currentIds = providerGroups.value.find(group => group.provider === provider)?.items.map(item => item.id) || []
    const savedIds = order.channels[provider] || []
    const itemOrder = [...new Set([...savedIds, ...currentIds, ...incoming.map(item => item.id)])]
    return {
      provider,
      items: itemOrder.map(id => incomingById.get(id)).filter((item): item is UserMonitorView => Boolean(item)),
    }
  })
}

function handleCardClick(item: UserMonitorView) {
  if (!props.reordering) emit('cardClick', item)
}

watch(() => props.items, reconcileGroups, { immediate: true })

// 服务端顺序变化（管理员保存成功、其他管理员更新）时立即套用。
watch(() => props.order, () => reconcileGroups(props.items))

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

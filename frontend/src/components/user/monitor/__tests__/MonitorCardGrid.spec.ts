import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MonitorCardGrid from '../MonitorCardGrid.vue'
import type { ChannelMonitorOrder, UserMonitorView } from '@/api/channelMonitor'

vi.mock('@/api/channelMonitor', () => ({
  normalizeChannelMonitorOrder: (order?: Partial<ChannelMonitorOrder> | null) => {
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
}))

vi.mock('vue-i18n', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue-i18n')>(),
  useI18n: () => ({ t: (key: string) => key })
}))

vi.mock('@/composables/useChannelMonitorFormat', () => ({
  useChannelMonitorFormat: () => ({ providerLabel: (provider: string) => provider || '-' })
}))

const MonitorCardStub = {
  props: ['item'],
  emits: ['click'],
  template: '<button class="monitor-card" @click="$emit(\'click\')">{{ item.name }}</button>'
}

// 模拟 vue-draggable-plus 的 v-model 契约：拖拽结束后 Sortable 会先同步
// modelValue（update:modelValue），再触发 end 事件。
const DraggableStub = {
  name: 'VueDraggable',
  props: ['modelValue', 'itemKey', 'animation', 'disabled', 'handle'],
  emits: ['update:modelValue', 'end'],
  template: '<div><slot /></div>'
}

function makeItem(id: number, provider: string, name: string): UserMonitorView {
  return {
    id,
    provider,
    name,
    group_name: '',
    primary_model: 'model',
    primary_status: 'operational',
    primary_latency_ms: null,
    primary_ping_latency_ms: null,
    availability_7d: 100,
    extra_models: [],
    timeline: []
  }
}

function emptyOrder(): ChannelMonitorOrder {
  return { providers: [], channels: {} }
}

function mountGrid(items: UserMonitorView[], extraProps: Record<string, unknown> = {}) {
  return mount(MonitorCardGrid, {
    props: {
      items,
      window: '7d',
      countdownSeconds: 0,
      loading: false,
      reordering: false,
      order: emptyOrder(),
      detailCache: {},
      ...extraProps
    },
    global: {
      stubs: {
        MonitorCard: MonitorCardStub,
        VueDraggable: DraggableStub,
        ProviderIcon: true,
        EmptyState: true
      }
    }
  })
}

describe('MonitorCardGrid', () => {
  it('groups cards by provider while keeping each provider section ordered by first occurrence', () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(3, 'openai', 'second OpenAI')
    ])

    const sections = wrapper.findAll('section')
    expect(sections).toHaveLength(2)
    expect(sections[0]?.attributes('aria-label')).toBe('openai')
    expect(sections[0]?.text()).toContain('(2)')
    expect(sections[0]?.text()).toContain('first OpenAI')
    expect(sections[0]?.text()).toContain('second OpenAI')
    expect(sections[1]?.attributes('aria-label')).toBe('anthropic')
    expect(sections[1]?.text()).toContain('(1)')

    wrapper.unmount()
  })

  it('shows the empty state when there are no monitor cards', () => {
    const wrapper = mountGrid([])

    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'EmptyState' }).exists()).toBe(true)

    wrapper.unmount()
  })

  it('forwards the clicked card item', async () => {
    const item = makeItem(1, 'openai', 'OpenAI channel')
    const wrapper = mountGrid([item])

    await wrapper.get('.monitor-card').trigger('click')

    expect(wrapper.emitted('cardClick')).toEqual([[item]])
    wrapper.unmount()
  })

  // 全站统一顺序：服务端下发的 order 决定分组顺序与分组内顺序。
  it('applies the order provided by the parent', () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(3, 'openai', 'second OpenAI')
    ], { order: { providers: ['anthropic', 'openai'], channels: { openai: [3, 1] } } })

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('anthropic')
    expect(sections[1]?.attributes('aria-label')).toBe('openai')
    expect(sections[1]?.text().indexOf('second OpenAI')).toBeLessThan(sections[1]?.text().indexOf('first OpenAI') ?? 0)
    wrapper.unmount()
  })

  // 普通用户不能排序，但必须按管理员保存的全站顺序展示。
  it('applies the site-wide order for users who cannot reorder', () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(3, 'openai', 'second OpenAI')
    ], { canReorder: false, order: { providers: ['anthropic', 'openai'], channels: { openai: [3, 1] } } })

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('anthropic')
    expect(sections[1]?.attributes('aria-label')).toBe('openai')
    expect(sections[1]?.text().indexOf('second OpenAI')).toBeLessThan(sections[1]?.text().indexOf('first OpenAI') ?? 0)
    wrapper.unmount()
  })

  it('appends new providers and channels without changing saved items', () => {
    const wrapper = mountGrid([
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(3, 'openai', 'New OpenAI')
    ], { order: { providers: ['openai'], channels: { openai: [1] } } })

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('openai')
    expect(sections[0]?.text().indexOf('OpenAI')).toBeLessThan(sections[0]?.text().indexOf('New OpenAI') ?? 0)
    expect(sections[1]?.attributes('aria-label')).toBe('anthropic')
    wrapper.unmount()
  })

  it('ignores malformed order data', () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ], { order: { providers: [123 as unknown as string], channels: { openai: ['x' as unknown as number] } } })

    expect(wrapper.findAll('section')[0]?.attributes('aria-label')).toBe('openai')
    wrapper.unmount()
  })

  it('re-applies the order when the parent updates it', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ])

    expect(wrapper.findAll('section')[0]?.attributes('aria-label')).toBe('openai')
    await wrapper.setProps({ order: { providers: ['anthropic', 'openai'], channels: {} } })
    expect(wrapper.findAll('section')[0]?.attributes('aria-label')).toBe('anthropic')
    wrapper.unmount()
  })

  // 回归：组件首次挂载时 props.items 还是空数组，随后才拿到数据，
  // 此时仍要按服务端顺序展示。
  it('keeps the parent order when it mounts before the items arrive', async () => {
    const wrapper = mountGrid([], { order: { providers: ['anthropic', 'openai'], channels: { openai: [3, 1] } } })

    await wrapper.setProps({
      items: [
        makeItem(1, 'openai', 'first OpenAI'),
        makeItem(2, 'anthropic', 'Anthropic'),
        makeItem(3, 'openai', 'second OpenAI')
      ]
    })

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('anthropic')
    expect(sections[1]?.attributes('aria-label')).toBe('openai')
    wrapper.unmount()
  })

  it('emits the dragged provider order so the parent can save it', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ])

    const outer = wrapper.findAllComponents({ name: 'VueDraggable' })[0]
    const groups = outer?.props('modelValue') as Array<{ provider: string }>
    outer?.vm.$emit('update:modelValue', [...groups].reverse())
    outer?.vm.$emit('end')
    await nextTick()

    expect(wrapper.emitted('orderChange')).toEqual([[
      { providers: ['anthropic', 'openai'], channels: { anthropic: [2], openai: [1] } }
    ]])
    wrapper.unmount()
  })

  it('emits the dragged channel order inside a provider group', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'openai', 'second OpenAI')
    ])

    const inner = wrapper.findAllComponents({ name: 'VueDraggable' })[1]
    const items = inner?.props('modelValue') as Array<{ id: number }>
    inner?.vm.$emit('update:modelValue', [...items].reverse())
    inner?.vm.$emit('end')
    await nextTick()

    expect(wrapper.emitted('orderChange')).toEqual([[
      { providers: ['openai'], channels: { openai: [2, 1] } }
    ]])
    wrapper.unmount()
  })

  // 普通用户不允许调整顺序：即使触发了拖拽结束事件也不能提交。
  it('does not emit orderChange for users who cannot reorder', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ], { canReorder: false })

    const outer = wrapper.findAllComponents({ name: 'VueDraggable' })[0]
    const groups = outer?.props('modelValue') as Array<{ provider: string }>
    outer?.vm.$emit('update:modelValue', [...groups].reverse())
    outer?.vm.$emit('end')
    await nextTick()

    expect(wrapper.emitted('orderChange')).toBeUndefined()
    wrapper.unmount()
  })
})

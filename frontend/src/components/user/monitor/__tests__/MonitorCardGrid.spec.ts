import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MonitorCardGrid from '../MonitorCardGrid.vue'
import type { UserMonitorView } from '@/api/channelMonitor'

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

const MONITOR_ORDER_STORAGE_KEY = 'sub2api:channel-monitor-order:v1'

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

function mountGrid(items: UserMonitorView[]) {
  return mount(MonitorCardGrid, {
    props: {
      items,
      window: '7d',
      countdownSeconds: 0,
      loading: false,
      reordering: false,
      detailCache: {}
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
  beforeEach(() => {
    localStorage.clear()
  })

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
    const wrapper = mount(MonitorCardGrid, {
      props: {
        items: [item],
        window: '7d',
        countdownSeconds: 0,
        loading: false,
        reordering: false,
        detailCache: {}
      },
      global: {
        stubs: {
          MonitorCard: MonitorCardStub,
          VueDraggable: DraggableStub,
          ProviderIcon: true
        }
      }
    })

    await wrapper.get('.monitor-card').trigger('click')

    expect(wrapper.emitted('cardClick')).toEqual([[item]])
    wrapper.unmount()
  })

  it('restores provider and channel order from localStorage', () => {
    localStorage.setItem(MONITOR_ORDER_STORAGE_KEY, JSON.stringify({
      providers: ['anthropic', 'openai'],
      channels: { openai: [3, 1] }
    }))

    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(3, 'openai', 'second OpenAI')
    ])

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('anthropic')
    expect(sections[1]?.attributes('aria-label')).toBe('openai')
    expect(sections[1]?.text().indexOf('second OpenAI')).toBeLessThan(sections[1]?.text().indexOf('first OpenAI') ?? 0)
    wrapper.unmount()
  })

  it('appends new providers and channels without changing saved items', () => {
    localStorage.setItem(MONITOR_ORDER_STORAGE_KEY, JSON.stringify({
      providers: ['openai'],
      channels: { openai: [1] }
    }))

    const wrapper = mountGrid([
      makeItem(2, 'anthropic', 'Anthropic'),
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(3, 'openai', 'New OpenAI')
    ])

    const sections = wrapper.findAll('section')
    expect(sections[0]?.attributes('aria-label')).toBe('openai')
    expect(sections[0]?.text().indexOf('OpenAI')).toBeLessThan(sections[0]?.text().indexOf('New OpenAI') ?? 0)
    expect(sections[1]?.attributes('aria-label')).toBe('anthropic')
    wrapper.unmount()
  })

  it('ignores malformed saved ordering data', () => {
    localStorage.setItem(MONITOR_ORDER_STORAGE_KEY, '{not-json')
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ])

    expect(wrapper.findAll('section')[0]?.attributes('aria-label')).toBe('openai')
    wrapper.unmount()
  })

  // 回归：组件首次挂载时 props.items 还是空数组，此时不能把已保存的排序写空，
  // 否则用户每次刷新页面都会丢失自定义顺序。
  it('keeps the saved order when it mounts before the items arrive', () => {
    localStorage.setItem(MONITOR_ORDER_STORAGE_KEY, JSON.stringify({
      providers: ['anthropic', 'openai'],
      channels: { openai: [3, 1] }
    }))

    const wrapper = mountGrid([])

    expect(JSON.parse(localStorage.getItem(MONITOR_ORDER_STORAGE_KEY) || '{}')).toEqual({
      providers: ['anthropic', 'openai'],
      channels: { openai: [3, 1] }
    })
    wrapper.unmount()
  })

  it('keeps the saved order when the item list becomes empty', async () => {
    localStorage.setItem(MONITOR_ORDER_STORAGE_KEY, JSON.stringify({
      providers: ['anthropic'],
      channels: { anthropic: [2] }
    }))

    const wrapper = mountGrid([makeItem(2, 'anthropic', 'Anthropic')])
    await wrapper.setProps({ items: [] })

    expect(JSON.parse(localStorage.getItem(MONITOR_ORDER_STORAGE_KEY) || '{}')).toEqual({
      providers: ['anthropic'],
      channels: { anthropic: [2] }
    })
    wrapper.unmount()
  })

  it('persists the dragged provider order so it survives a reload', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'OpenAI'),
      makeItem(2, 'anthropic', 'Anthropic')
    ])

    const outer = wrapper.findAllComponents({ name: 'VueDraggable' })[0]
    const groups = outer?.props('modelValue') as Array<{ provider: string }>
    outer?.vm.$emit('update:modelValue', [...groups].reverse())
    outer?.vm.$emit('end')
    await nextTick()

    const saved = JSON.parse(localStorage.getItem(MONITOR_ORDER_STORAGE_KEY) || '{}')
    expect(saved.providers).toEqual(['anthropic', 'openai'])
    wrapper.unmount()
  })

  it('persists the dragged channel order inside a provider group', async () => {
    const wrapper = mountGrid([
      makeItem(1, 'openai', 'first OpenAI'),
      makeItem(2, 'openai', 'second OpenAI')
    ])

    const inner = wrapper.findAllComponents({ name: 'VueDraggable' })[1]
    const items = inner?.props('modelValue') as Array<{ id: number }>
    inner?.vm.$emit('update:modelValue', [...items].reverse())
    inner?.vm.$emit('end')
    await nextTick()

    const saved = JSON.parse(localStorage.getItem(MONITOR_ORDER_STORAGE_KEY) || '{}')
    expect(saved.providers).toEqual(['openai'])
    expect(saved.channels.openai).toEqual([2, 1])
    wrapper.unmount()
  })
})

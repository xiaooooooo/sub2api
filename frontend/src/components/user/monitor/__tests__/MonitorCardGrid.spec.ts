import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
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
      detailCache: {}
    },
    global: {
      stubs: {
        MonitorCard: MonitorCardStub,
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
    const wrapper = mount(MonitorCardGrid, {
      props: {
        items: [item],
        window: '7d',
        countdownSeconds: 0,
        loading: false,
        detailCache: {}
      },
      global: { stubs: { MonitorCard: MonitorCardStub, ProviderIcon: true } }
    })

    await wrapper.get('.monitor-card').trigger('click')

    expect(wrapper.emitted('cardClick')).toEqual([[item]])
    wrapper.unmount()
  })
})

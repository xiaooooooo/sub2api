import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChannelStatusV1View from '../ChannelStatusV1View.vue'

const { list, getOrder, saveOrder, readLocalChannelMonitorOrder, authState, showError } = vi.hoisted(() => ({
  list: vi.fn(),
  getOrder: vi.fn(),
  saveOrder: vi.fn(),
  readLocalChannelMonitorOrder: vi.fn(),
  authState: { isAdmin: true },
  showError: vi.fn(),
}))

vi.mock('@/api/channelMonitor', () => ({
  list,
  status: vi.fn(),
  getOrder,
  saveOrder,
  readLocalChannelMonitorOrder,
  normalizeChannelMonitorOrder: (order?: { providers?: string[]; channels?: Record<string, number[]> } | null) => ({
    providers: Array.isArray(order?.providers) ? order.providers : [],
    channels: order?.channels && typeof order.channels === 'object' ? order.channels : {},
  }),
  isEmptyChannelMonitorOrder: (order?: { providers?: string[]; channels?: Record<string, number[]> } | null) =>
    (order?.providers?.length ?? 0) === 0 && Object.keys(order?.channels ?? {}).length === 0,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ cachedPublicSettings: { channel_monitor_enabled: true }, showError }),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => authState }))
vi.mock('vue-i18n', async () => ({
  ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'),
  useI18n: () => ({ t: (key: string) => key }),
}))

const SHARED_ORDER = { providers: ['anthropic', 'openai'], channels: { openai: [3, 1] } }

const GridStub = {
  name: 'MonitorCardGrid',
  props: ['order', 'items', 'canReorder'],
  emits: ['cardClick', 'orderChange'],
  template: '<div><button class="emit-order" @click="$emit(\'orderChange\', { providers: [\'anthropic\', \'openai\'], channels: { openai: [3, 1] } })">order</button></div>',
}

const mountView = () => shallowMount(ChannelStatusV1View, {
  global: {
    stubs: {
      AppLayout: { template: '<div><slot /></div>' },
      MonitorCardGrid: GridStub,
    },
  },
})

let wrapper: ReturnType<typeof mountView> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  authState.isAdmin = true
  list.mockReset().mockResolvedValue({ items: [] })
  getOrder.mockReset().mockResolvedValue({ providers: [], channels: {} })
  saveOrder.mockReset().mockImplementation(async (order: unknown) => order)
  readLocalChannelMonitorOrder.mockReset().mockReturnValue(null)
  showError.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.useRealTimers()
  localStorage.clear()
})

describe('channel monitor site-wide order', () => {
  it('loads the shared order from the server and passes it to the grid', async () => {
    getOrder.mockResolvedValue(SHARED_ORDER)
    wrapper = mountView()
    await flushPromises()

    expect(getOrder).toHaveBeenCalled()
    expect(wrapper.findComponent(GridStub).props('order')).toEqual(SHARED_ORDER)
  })

  it('persists an admin order change so every user sees the new order', async () => {
    wrapper = mountView()
    await flushPromises()

    await wrapper.get('.emit-order').trigger('click')
    await flushPromises()

    expect(saveOrder).toHaveBeenCalledWith(SHARED_ORDER)
    expect(wrapper.findComponent(GridStub).props('order')).toEqual(SHARED_ORDER)
  })

  it('migrates a legacy browser-local order to the server for admins', async () => {
    readLocalChannelMonitorOrder.mockReturnValue(SHARED_ORDER)
    wrapper = mountView()
    await flushPromises()

    expect(saveOrder).toHaveBeenCalledWith(SHARED_ORDER)
  })

  it('never migrates a legacy local order for normal users', async () => {
    authState.isAdmin = false
    readLocalChannelMonitorOrder.mockReturnValue(SHARED_ORDER)
    wrapper = mountView()
    await flushPromises()

    expect(saveOrder).not.toHaveBeenCalled()
  })

  it('keeps the server order when it is already set', async () => {
    getOrder.mockResolvedValue(SHARED_ORDER)
    readLocalChannelMonitorOrder.mockReturnValue({ providers: ['openai'], channels: {} })
    wrapper = mountView()
    await flushPromises()

    expect(saveOrder).not.toHaveBeenCalled()
    expect(wrapper.findComponent(GridStub).props('order')).toEqual(SHARED_ORDER)
  })

  it('reports a save failure and falls back to the server order', async () => {
    saveOrder.mockRejectedValue(new Error('boom'))
    wrapper = mountView()
    await flushPromises()

    await wrapper.get('.emit-order').trigger('click')
    await flushPromises()

    expect(showError).toHaveBeenCalled()
    expect(getOrder).toHaveBeenCalledTimes(2)
  })
})

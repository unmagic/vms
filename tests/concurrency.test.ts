import { describe, it, expect, vi, afterEach } from 'vitest'
import { batchProcess } from '../src/utils/concurrency'

/**
 * batchProcess 原先内联在 cli.ts 中且无任何测试覆盖。
 * 它是构建流程的核心调度器（文件处理、依赖打包均依赖它），
 * 这里补齐边界行为测试：并发上限、任务完整性、错误传播、错误后不再启动新任务。
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('batchProcess', () => {
  it('1.1 空数组直接返回，不调用处理器', async () => {
    const processor = vi.fn(async () => {})
    await batchProcess([], processor, 4)
    expect(processor).not.toHaveBeenCalled()
  })

  it('1.2 每个任务恰好处理一次，顺序与输入一致', async () => {
    const seen: number[] = []
    await batchProcess(
      [1, 2, 3, 4, 5],
      async (n) => {
        seen.push(n)
      },
      2,
    )

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('1.3 并发数不超过指定上限', async () => {
    let running = 0
    let peak = 0

    await batchProcess(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(5)
        running--
      },
      3,
    )

    expect(peak).toBe(3)
  })

  it('1.4 并发上限大于任务数时不会过度调度', async () => {
    let peak = 0
    let running = 0
    await batchProcess(
      [1, 2],
      async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(2)
        running--
      },
      10,
    )
    expect(peak).toBe(2)
  })

  it('1.5 单个任务失败时整体 reject，且已启动任务等待完成', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const finished: number[] = []

    await expect(
      batchProcess(
        [1, 2, 3, 4],
        async (n) => {
          if (n === 2) throw new Error('boom')
          await sleep(3)
          finished.push(n)
        },
        2,
      ),
    ).rejects.toThrow('部分任务处理失败')

    // 已启动的任务会跑完（1 与 2 同批启动）
    expect(finished).toContain(1)
  })

  it('1.6 失败后不再启动后续任务', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const started: number[] = []

    await expect(
      batchProcess(
        [1, 2, 3, 4, 5, 6],
        async (n) => {
          started.push(n)
          if (n === 1) throw new Error('boom')
          await sleep(2)
        },
        1,
      ),
    ).rejects.toThrow()

    // 并发为 1 时，第 1 个失败后不应再启动 2..6
    expect(started).toEqual([1])
  })

  it('1.7 并发上限为 0 或负数时按 1 处理，不会死锁', async () => {
    const seen: number[] = []
    await batchProcess(
      [1, 2],
      async (n) => {
        seen.push(n)
      },
      0,
    )

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('1.8 慢任务不会阻塞后续任务启动（非分批语义）', async () => {
    const startOrder: number[] = []
    await batchProcess(
      [1, 2, 3],
      async (n) => {
        startOrder.push(n)
        // 第 1 个任务很慢，第 2/3 个应当先启动并完成
        await sleep(n === 1 ? 30 : 1)
      },
      3,
    )

    expect(startOrder.slice(0, 3)).toEqual([1, 2, 3])
  })
})

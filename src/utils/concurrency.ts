/**
 * 并发池工具。
 *
 * 从 cli.ts 抽出的首个模块：该实现原先内联在构建流程中，
 * 既有文件处理逻辑也有并发控制逻辑，且完全没有单元测试。
 * 抽出后可以独立测试边界行为（错误传播、并发上限、任务不丢）。
 */

/**
 * 以固定并发上限处理一组任务。
 *
 * 与"分批 Promise.all"不同：任一批次结束后立刻补入新任务，
 * 不会因单个慢任务拖慢整批；一旦有任务失败则不再启动新任务，
 * 等待已在跑的任务结束后以统一错误 reject。
 *
 * @param items 待处理项
 * @param processor 单项处理函数
 * @param concurrency 并发上限（默认由调用方按 CPU 核数计算）
 */
export async function batchProcess<T>(
  items: T[],
  processor: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  if (items.length === 0) return

  const limit = Math.max(1, Math.floor(concurrency))
  let index = 0
  let running = 0
  const total = items.length
  let hasError = false

  return new Promise((resolve, reject) => {
    const runNext = () => {
      while (index < total && running < limit && !hasError) {
        const currentIndex = index++
        running++

        processor(items[currentIndex])
          .catch((error) => {
            console.error(`处理失败 [${items[currentIndex]}]:`, error)
            hasError = true
          })
          .finally(() => {
            running--

            // 判定结束条件：没有正在运行的任务，且（已出错 或 所有任务都已启动）。
            // 旧实现只看"完成数 === 总数"：任务提前失败后剩余任务不再启动，
            // 完成数永远到不了总数，Promise 永不 settle（构建挂死）。
            const allStartedSettled = running === 0 && (hasError || index === total)
            if (allStartedSettled) {
              if (hasError) {
                reject(new Error('部分任务处理失败'))
              } else {
                resolve()
              }
            } else if (!hasError) {
              runNext()
            }
          })
      }
    }

    runNext()
  })
}

// IPC 调用封装，提供类型安全的调用方式
export async function ipcInvoke<T>(
  channel: string,
  ...args: unknown[]
): Promise<{ success: boolean; data?: T; error?: string }> {
  return window.electronAPI.invoke(channel, ...args)
}

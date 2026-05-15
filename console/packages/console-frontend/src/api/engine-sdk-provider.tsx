import { type ISdk, registerWorker } from 'iii-browser-sdk'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { getEngineBridgeWs } from './config'

const EngineSdkContext = createContext<ISdk | null>(null)

export function useEngineSdk(): ISdk {
  const sdk = useContext(EngineSdkContext)
  if (!sdk) {
    throw new Error('useEngineSdk must be used within an EngineSdkProvider')
  }
  return sdk
}

interface EngineSdkProviderProps {
  children: ReactNode
  /**
   * Pre-built SDK to expose via context. When provided, the provider
   * skips bridge-URL resolution and the consumer owns the SDK lifecycle
   * (no implicit `shutdown()` on unmount). Useful for embedding the
   * traces feature in a different host app or for swapping in a mock
   * SDK in tests/Storybook.
   *
   * Must be stable across renders; toggling between provided/internal
   * SDK mid-mount is not supported.
   */
  sdk?: ISdk
  /**
   * Override the bridge WebSocket URL. Ignored when `sdk` is provided.
   * Defaults to `getEngineBridgeWs()`, which reads `engineHost` +
   * `bridgePort` from the runtime `ConfigProvider`. Pass this when you
   * want to use the iii-browser-sdk transport without depending on the
   * console's `ConfigProvider` chain.
   */
  bridgeUrl?: string
}

export function EngineSdkProvider({
  children,
  sdk: externalSdk,
  bridgeUrl,
}: EngineSdkProviderProps) {
  // When `externalSdk` is provided, the consumer owns lifecycle and we
  // skip `registerWorker` entirely. Otherwise we create our own SDK
  // exactly once per mount — `useState` with a lazy initializer is
  // invoked once even in React 18 StrictMode, so we don't open two
  // WebSockets in dev.
  const [internalSdk] = useState<ISdk | null>(() => {
    if (externalSdk) return null
    return registerWorker(bridgeUrl ?? getEngineBridgeWs(), {
      invocationTimeoutMs: 30_000,
    })
  })

  // Close the internally-owned WebSocket on unmount (HMR teardown or
  // conditional provider remount). When `externalSdk` is provided we
  // never created an SDK to shut down.
  useEffect(() => {
    if (!internalSdk) return
    return () => {
      void internalSdk.shutdown()
    }
  }, [internalSdk])

  const sdk = externalSdk ?? internalSdk
  if (!sdk) {
    // Unreachable: either `externalSdk` was provided or the initializer
    // built `internalSdk`. Kept as a defensive guard so the context
    // value is never `null` past this line.
    throw new Error(
      'EngineSdkProvider: no SDK available. Pass `sdk`, pass `bridgeUrl`, or mount under ConfigProvider.',
    )
  }

  return <EngineSdkContext.Provider value={sdk}>{children}</EngineSdkContext.Provider>
}

import { useState, useEffect } from 'react'
import { Spin } from 'antd'
import ChatPage from './pages/ChatPage'
import ApiKeyDrawer from './components/ApiKeyDrawer'
import { useProviderStore } from './stores/providerStore'

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const { providers, loadProviders } = useProviderStore()

  useEffect(() => {
    const init = async () => {
      try {
        await loadProviders()
      } catch (e) {
        console.error('初始化失败:', e)
      }
      setReady(true)
    }
    init()
  }, [])

  useEffect(() => {
    if (ready && providers.length === 0) {
      setDrawerOpen(true)
    }
  }, [ready, providers])

  if (!ready) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="app-container">
      <ChatPage onOpenSettings={() => setDrawerOpen(true)} />
      <ApiKeyDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  )
}

export default App

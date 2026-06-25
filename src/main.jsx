import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Catch render-time errors so a single thrown component doesn't leave the user
// staring at a blank white page with no way forward.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: 520, margin: '15vh auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif', color: '#1c3857', textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#556778', lineHeight: 1.5 }}>
            The app hit an unexpected error. Your saved data is safe. Try reloading the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '9px 18px', border: '1px solid #1c3857', background: '#1c3857', color: '#fff', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

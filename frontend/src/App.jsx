import { useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const STEP_ORDER = ['search', 'reader', 'writer', 'critic']
const STEP_LABELS = {
  search: 'Search',
  reader: 'Reader',
  writer: 'Writer',
  critic: 'Critic',
}
const STEP_TITLES = {
  search: 'Search results',
  reader: 'Scraped content',
  writer: 'Final report',
  critic: 'Critic feedback',
}

const INITIAL_SECTIONS = {
  search_results: '',
  scraped_content: '',
  report: '',
  feedback: '',
}

function App() {
  const [topic, setTopic] = useState('')
  const [sections, setSections] = useState(INITIAL_SECTIONS)
  const [statusMessage, setStatusMessage] = useState('Ready when you are.')
  const [activeStep, setActiveStep] = useState(null)
  const [completedSteps, setCompletedSteps] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [activePanel, setActivePanel] = useState('search')

  const resetRun = () => {
    setSections(INITIAL_SECTIONS)
    setCompletedSteps([])
    setActiveStep(null)
    setError('')
    setActivePanel('search')
  }

  const panelKeyByStep = {
    search: 'search_results',
    reader: 'scraped_content',
    writer: 'report',
    critic: 'feedback',
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const trimmedTopic = topic.trim()
    if (!trimmedTopic) {
      setError('Please enter a research topic.')
      return
    }

    resetRun()
    setLoading(true)
    setStatusMessage('Opening the research pipeline...')

    try {
      const response = await fetch(`${API_BASE}/research/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ topic: trimmedTopic }),
      })

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Unable to start the research stream.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          const payload = JSON.parse(line)

          if (payload.event === 'status') {
            setActiveStep(payload.step)
            setStatusMessage(payload.message)
          }

          if (payload.event === 'step_complete') {
            setCompletedSteps((prev) =>
              prev.includes(payload.step) ? prev : [...prev, payload.step]
            )
            setActiveStep(payload.step)

            setSections((prev) => {
              if (payload.step === 'search') {
                return { ...prev, search_results: payload.content }
              }
              if (payload.step === 'reader') {
                return { ...prev, scraped_content: payload.content }
              }
              if (payload.step === 'writer') {
                return { ...prev, report: payload.content }
              }
              if (payload.step === 'critic') {
                return { ...prev, feedback: payload.content }
              }
              return prev
            })
          }

          if (payload.event === 'done') {
            setSections(payload.result)
            setCompletedSteps(STEP_ORDER)
            setActiveStep(null)
            setStatusMessage('Research complete.')
            setLoading(false)
          }

          if (payload.event === 'error') {
            throw new Error(payload.message || 'The research pipeline failed.')
          }
        }
      }

      setLoading(false)
    } catch (requestError) {
      setError(requestError.message)
      setStatusMessage('Run stopped.')
      setActiveStep(null)
      setLoading(false)
    }
  }

  const stepState = (step) => {
    if (completedSteps.includes(step)) return 'done'
    if (activeStep === step && loading) return 'active'
    return 'idle'
  }

  const formatRichText = (value) => {
    const text = value || ''
    const lines = text.split('\n')

    return lines.map((line, index) => {
      const trimmed = line.trim()

      if (!trimmed) {
        return <div key={index} className="rich-spacer" />
      }

      const cleanLine = trimmed.replace(/\*\*/g, '')

      if (cleanLine.endsWith(':') && cleanLine.length < 80) {
        return (
          <h4 key={index} className="rich-heading">
            {cleanLine}
          </h4>
        )
      }

      if (cleanLine.startsWith('- ')) {
        return (
          <div key={index} className="rich-bullet">
            <span className="rich-bullet-mark"></span>
            <span>{cleanLine.slice(2)}</span>
          </div>
        )
      }

      if (/^https?:\/\//.test(cleanLine)) {
        return (
          <a
            key={index}
            className="rich-link"
            href={cleanLine}
            target="_blank"
            rel="noreferrer"
          >
            {cleanLine}
          </a>
        )
      }

      return (
        <p key={index} className="rich-paragraph">
          {cleanLine}
        </p>
      )
    })
  }

  const activeContent = sections[panelKeyByStep[activePanel]]
  const sourceLinks = Array.from(
    new Set(
      (sections.search_results.match(/https?:\/\/[^\s]+/g) || []).map((link) =>
        link.replace(/[),.;]+$/, '')
      )
    )
  )

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">InsightAI Research Console</p>
          <h1>Watch your research build itself, step by step.</h1>
          <p className="hero-text">
            Start with a topic, then follow the search, reading, drafting, and review
            stages live instead of waiting for one big final dump.
          </p>
        </div>
        <div className="hero-card">
          <div className="hero-stat">
            <span className="stat-label">Experience</span>
            <span className="stat-value">Live progressive research</span>
          </div>
          <div className="hero-stat">
            <span className="stat-label">Best for</span>
            <span className="stat-value">Faster review and iteration</span>
          </div>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel composer-panel">
          <div className="panel-heading">
            <h2>Start a run</h2>
            <p>Enter a topic and the agent will reveal each step as it completes.</p>
          </div>

          <form className="research-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="topic">
              Topic
            </label>
            <textarea
              id="topic"
              className="topic-input"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Example: How multi-agent research systems improve technical due diligence"
              rows={5}
            />

            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? 'Research in progress...' : 'Run research'}
              </button>
            </div>
          </form>

          <div className="status-strip">
            <span className={`status-dot${loading ? ' loading' : ''}`}></span>
            <p>{statusMessage}</p>
          </div>

          {error && <p className="error-message">{error}</p>}

          <div className="timeline">
            {STEP_ORDER.map((step, index) => (
              <div key={step} className={`timeline-item ${stepState(step)}`}>
                <div className="timeline-marker">{index + 1}</div>
                <div className="timeline-copy">
                  <p className="timeline-title">{STEP_LABELS[step]}</p>
                  <p className="timeline-state">
                    {stepState(step) === 'done'
                      ? 'Completed'
                      : stepState(step) === 'active'
                        ? 'Running now'
                        : 'Waiting'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel results-panel">
          <div className="panel-heading">
            <h2>Live output</h2>
            <p>Jump between each research stage without losing your place.</p>
          </div>

          <div className="carousel-tabs" role="tablist" aria-label="Research stages">
            {STEP_ORDER.map((step) => (
              <button
                key={step}
                type="button"
                className={`carousel-tab ${activePanel === step ? 'selected' : ''}`}
                onClick={() => setActivePanel(step)}
              >
                <span className={`tab-dot ${stepState(step)}`}></span>
                <span>{STEP_LABELS[step]}</span>
              </button>
            ))}
          </div>

          <article className={`result-card carousel-card ${activePanel === 'writer' ? 'featured' : ''}`}>
            <div className="carousel-card-header">
              <div>
                <h3>{STEP_TITLES[activePanel]}</h3>
                <p className="carousel-subtitle">
                  {stepState(activePanel) === 'done'
                    ? 'Completed'
                    : stepState(activePanel) === 'active'
                      ? 'Currently running'
                      : 'Waiting for this stage'}
                </p>
              </div>
            </div>

            {activePanel === 'reader' && sourceLinks.length > 0 && (
              <div className="source-links-panel">
                <p className="source-links-title">Source links</p>
                <div className="source-links-list">
                  {sourceLinks.map((link) => (
                    <a
                      key={link}
                      className="source-link-chip"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="rich-content">
              {activeContent
                ? formatRichText(activeContent)
                : (
                  <p className="rich-placeholder">
                    {STEP_TITLES[activePanel]} will appear here as soon as this stage finishes.
                  </p>
                )}
            </div>
          </article>

          <div className="quick-glance">
            {STEP_ORDER.map((step) => (
              <div key={step} className={`glance-card ${stepState(step)}`}>
                <p className="glance-label">{STEP_LABELS[step]}</p>
                <p className="glance-state">
                  {stepState(step) === 'done'
                    ? 'Ready'
                    : stepState(step) === 'active'
                      ? 'Running'
                      : 'Queued'}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App

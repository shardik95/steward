import { useState } from 'react'

function App(): JSX.Element {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)

  async function chooseFolder(): Promise<void> {
    const folder = await window.steward.pickFolder()
    if (folder) setSelectedFolder(folder)
  }

  return (
    <main className="app-shell">
      <section className="welcome" aria-labelledby="app-title">
        <p className="eyebrow">Steward</p>
        <h1 id="app-title">Your local AI file-organization agent.</h1>
        <p className="description">
          Select one folder you permit Steward to access. It will inspect that folder only, propose
          an organization plan, and wait for your approval before making any changes.
        </p>
        <button type="button" onClick={chooseFolder}>
          Choose a folder
        </button>
        {selectedFolder && (
          <p className="selection" aria-live="polite">
            Selected folder: <code>{selectedFolder}</code>
          </p>
        )}
      </section>
    </main>
  )
}

export default App

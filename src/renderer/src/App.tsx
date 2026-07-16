import { useState } from 'react'
import type { Inventory, SelectedFolder } from '../../shared/contracts'

function App(): JSX.Element {
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder | null>(null)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadInventory(): Promise<void> {
    setIsLoading(true)
    setError(null)
    try {
      setInventory(await window.steward.getInventory())
    } catch {
      setError('Steward could not read metadata from this folder. No files were changed.')
    } finally {
      setIsLoading(false)
    }
  }

  async function chooseFolder(): Promise<void> {
    setError(null)
    try {
      const folder = await window.steward.pickFolder()
      if (!folder) return
      setSelectedFolder(folder)
      setInventory(null)
      await loadInventory()
    } catch {
      setError('Steward could not approve this folder. Try choosing a different folder.')
    }
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
        <button type="button" onClick={chooseFolder} disabled={isLoading}>
          {isLoading ? 'Reading metadata…' : 'Choose a folder'}
        </button>
        {selectedFolder && (
          <p className="selection" aria-live="polite">
            Approved folder: <code>{selectedFolder.path}</code>
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        {inventory && (
          <section className="inventory" aria-labelledby="inventory-title">
            <div className="inventory-heading">
              <div>
                <p className="eyebrow">Metadata inventory</p>
                <h2 id="inventory-title">{inventory.files.length} files in {inventory.folders.length} folders</h2>
              </div>
              <button type="button" className="secondary" onClick={loadInventory} disabled={isLoading}>
                Refresh
              </button>
            </div>
            <p className="inventory-note">Only names, paths, sizes, and modification times were read.</p>
            {inventory.skippedSymlinks.length > 0 && (
              <p className="warning">Skipped {inventory.skippedSymlinks.length} symbolic link{inventory.skippedSymlinks.length === 1 ? '' : 's'}.</p>
            )}
            {inventory.files.length > 0 && (
              <div className="file-list" role="region" aria-label="Files found">
                {inventory.files.map((file) => (
                  <div className="file-row" key={file.relativePath}>
                    <code>{file.relativePath}</code>
                    <span>{file.sizeBytes.toLocaleString()} bytes</span>
                    <time dateTime={file.modifiedAt}>{new Date(file.modifiedAt).toLocaleString()}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  )
}

export default App

import type { GameRuntime } from '../runtime/GameRuntime.ts'
import type { SceneReviewProposal } from '../runtime/SpatialReview.ts'

/** The operator decision view. Agent tools can prepare this view, but cannot accept it. */
export class SpatialReviewPanel {
  private readonly dialog = document.createElement('dialog')
  private shown: SceneReviewProposal | null = null
  private refreshRevision = 0
  constructor(private readonly runtime: GameRuntime, private readonly download: (filename: string, source: string) => void) {
    this.dialog.className = 'config-dialog'
    this.dialog.id = 'scene-review-dialog'
    this.dialog.setAttribute('aria-labelledby', 'scene-review-title')
    this.dialog.innerHTML = `
      <header><div><p class="eyebrow">SAVED SHIP TRANSFORM</p><h2 id="scene-review-title">Review a change</h2></div><button id="close-scene-review" type="button">Close</button></header>
      <div class="config-scroll">
        <section class="config-section">
          <p id="scene-review-owner" class="inline-status"></p>
          <p>Changes affect the saved starting transform. Live flight pose is separate. Physical scale and correspondence are unknown; geometry checks are unavailable.</p>
          <form class="control-grid" id="scene-review-form">
            <label>Saved X<input id="review-x" type="number" min="-1000" max="1000" step="any" required /></label>
            <label>Saved Y<input id="review-y" type="number" min="-1000" max="1000" step="any" required /></label>
            <label>Saved Z<input id="review-z" type="number" min="-1000" max="1000" step="any" required /></label>
            <label>Saved scale<input id="review-scale" type="number" min="0.01" max="20" step="any" required /></label>
            <button class="primary-button wide-button" id="preview-scene-review" type="submit">Preview change</button>
          </form>
          <pre class="validation-output" id="scene-review-diff" aria-label="Reviewed transform difference">No pending proposal.</pre>
          <div class="manifest-actions"><button class="primary-button" id="accept-scene-review" type="button" disabled>Accept reviewed change</button><button id="cancel-scene-review" type="button">Cancel preview</button></div>
          <p class="inline-status" role="status" id="scene-review-status">Inspecting saved scene…</p>
        </section>
        <section class="config-section">
          <h3>Saved review history</h3><p class="inline-status" id="scene-review-history"></p>
          <label>Receipt to undo<select id="scene-review-receipt"></select></label>
          <div class="manifest-actions"><button id="undo-scene-review" type="button">Review undo</button><button id="export-scene-review" type="button">Export scene and history</button><button id="recover-scene-review" type="button">Recover saved scene</button></div>
          <p class="inline-status">Keeps the latest 32 receipts. Import an exported review file through Tune → Import JSON → Validate &amp; apply. Imported operator identity is unverified.</p>
          <details><summary>Source details</summary><pre class="validation-output" id="scene-review-identity"></pre></details>
        </section>
      </div>`
    document.body.append(this.dialog)
    this.get<HTMLButtonElement>('close-scene-review').addEventListener('click', () => this.dialog.close())
    this.dialog.addEventListener('close', () => { this.runtime.spatialReview.cancel(); this.shown = null })
    this.get<HTMLFormElement>('scene-review-form').addEventListener('submit', event => {
      event.preventDefault()
      void this.run(async () => {
        const review = await this.runtime.spatialReview.inspect()
        await this.runtime.spatialReview.preview({ position: ['x', 'y', 'z'].map(key => this.get<HTMLInputElement>(`review-${key}`).valueAsNumber), scale: this.get<HTMLInputElement>('review-scale').valueAsNumber },
          { sourceKind: review.source.sourceKind, schema: review.source.schema, sourceToken: review.source.token })
        this.status('Preview only. Saved source and live pose are unchanged. Accept this exact change or cancel.')
      })
    })
    this.get<HTMLButtonElement>('accept-scene-review').addEventListener('click', event => {
      if (!event.isTrusted) return
      const proposal = this.shown
      if (!proposal) return
      void this.run(async () => {
        const receipt = await this.runtime.spatialReview.accept(proposal.id, proposal.digest)
        this.status(`Saved ${receipt.kind} receipt ${receipt.id}. Reload preserves this scene and history.`)
        await this.refresh(true)
      })
    })
    this.get<HTMLButtonElement>('cancel-scene-review').addEventListener('click', () => { this.runtime.spatialReview.cancel(); this.status('Preview cancelled. Saved source is unchanged.') })
    this.get<HTMLButtonElement>('undo-scene-review').addEventListener('click', () => void this.run(async () => {
      await this.runtime.spatialReview.previewUndo(this.get<HTMLSelectElement>('scene-review-receipt').value)
      this.status('Inverse preview ready. Accept to undo only the unchanged affected values.')
    }))
    this.get<HTMLButtonElement>('export-scene-review').addEventListener('click', () => void this.run(async () => {
      this.download(`${this.runtime.manifest.id}.gamexr-review.json`, await this.runtime.spatialReview.exportBundle())
      this.status('Scene and review history exported. Local asset bytes are not embedded.')
    }))
    this.get<HTMLButtonElement>('recover-scene-review').addEventListener('click', () => void this.run(async () => {
      this.runtime.pause()
      await this.runtime.spatialReview.recover()
      this.status('Recovered the saved scene and history. Flight remains paused.')
      await this.refresh(true)
    }))
    this.runtime.spatialReview.addEventListener('change', this.changed)
  }
  open(): void { if (!this.dialog.open) this.dialog.showModal(); void this.refresh(true) }
  private get<T extends HTMLElement>(id: string): T { return this.dialog.querySelector<T>(`#${id}`)! }
  private status(message: string): void { this.get('scene-review-status').textContent = message }
  private async run(action: () => Promise<void>): Promise<void> {
    try { await action() } catch (error) { this.status(error instanceof Error ? error.message : 'Scene review failed.') }
    finally { await this.refresh() }
  }
  private readonly changed = () => { if (this.dialog.open) void this.refresh() }
  private async refresh(syncInputs = false): Promise<void> {
    const revision = ++this.refreshRevision
    const busy = this.runtime.spatialReview.busy
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy
    this.get<HTMLButtonElement>('accept-scene-review').disabled = true
    if (busy) { this.status('Saving the reviewed change…'); return }
    try {
      const view = await this.runtime.spatialReview.inspect()
      if (revision !== this.refreshRevision || !this.dialog.open) return
      this.shown = view.proposal
      this.get('scene-review-owner').textContent = `GameXR · ${view.source.documentId} · ${view.source.schema} · ${document.documentElement.dataset.gamexrWebmcp === 'native' ? 'host registered' : 'local controls available; native agent host unverified'}`
      this.get('scene-review-identity').textContent = JSON.stringify(view.source, null, 2)
      this.get('scene-review-diff').textContent = view.proposal
        ? view.proposal.diff.fields.map(key => `${key}: ${JSON.stringify(view.proposal!.diff.before[key])} → ${JSON.stringify(view.proposal!.diff.after[key])}`).join('\n')
        : 'No pending proposal.'
      this.get<HTMLButtonElement>('accept-scene-review').disabled = !view.proposal || Date.now() >= view.proposal.expiresAt || !['idle', 'paused'].includes(this.runtime.inspect().phase)
      this.get<HTMLButtonElement>('preview-scene-review').disabled = !view.capabilities.includes('preview')
      const receipts = view.review.receipts.filter(row => row.kind === 'apply' && !view.review.receipts.some(other => other.undoOf === row.id)).reverse()
      this.get<HTMLSelectElement>('scene-review-receipt').replaceChildren(...receipts.map(row => {
        const option = document.createElement('option'); option.value = row.id; option.textContent = `${row.id.slice(0, 8)} · ${row.diff.fields.join(', ')}`; return option
      }))
      this.get<HTMLButtonElement>('undo-scene-review').disabled = receipts.length === 0
      this.get('scene-review-history').textContent = `${view.review.receipts.length} saved receipt(s)${view.review.imported ? ' · imported operator identity unverified' : ''}`
      if (this.get('scene-review-status').textContent === 'Inspecting saved scene…') this.status('Ready. Preview a saved transform change or inspect its history.')
      if (syncInputs) {
        ;(['x', 'y', 'z'] as const).forEach((key, index) => { this.get<HTMLInputElement>(`review-${key}`).value = String(view.authored.position[index]) })
        this.get<HTMLInputElement>('review-scale').value = String(view.authored.scale)
      }
    } catch (error) {
      if (revision !== this.refreshRevision) return
      this.shown = null
      this.get<HTMLButtonElement>('preview-scene-review').disabled = true
      this.status(error instanceof Error ? error.message : 'Saved scene is unavailable.')
    }
  }
  dispose(): void {
    this.refreshRevision++
    this.runtime.spatialReview.removeEventListener('change', this.changed)
    this.runtime.spatialReview.cancel()
    this.dialog.remove()
  }
}

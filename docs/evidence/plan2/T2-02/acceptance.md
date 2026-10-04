# T2-02 Acceptance Evidence

Scope: this record verifies the AC2-02 basic node/member editing boundary. It does not claim AC2-03's single cross-category draft for geometry, sections, supports and loads; that scope remains in T2-03/T2-04.

## Shared manual and tool results

- Passed: the same node coordinate and member rotation inputs produce equal formal node/member objects through manual operations and a confirmed `propose_model_edits` proposal.
- Passed: a confirmed batch increments the project revision once and its receipt contains base/applied revisions, object before/after changes, created stable identities, affected members and a post-apply object readback at the new revision.

## Create, copy and delete

- Passed: node/member creation allocates the same labels and counters as manual editing.
- Passed: node copies keep coordinates with new identities; member copies keep endpoint, material, section and rotation references.
- Passed: deleting a node removes its connected members, supports, nodal loads and uniform member loads; the receipt reports every changed object.
- Passed: singular and plural public tool forms produce the same draft operation list.

## Confirmation and failure boundaries

- Passed: unconfirmed, discarded, stale-revision and malformed drafts leave the formal project unchanged.
- Passed: a failed middle operation does not consume an ID or leave a partial model.
- Passed: repeating the same confirmation returns the original receipt and does not create another object, including after the caller still holds the old confirmation.
- Passed: the applied edit is recorded as one history item and undo/redo restores the complete project snapshot.

## Public desktop path

- Passed: `e2e/t20-basic-edit-tools.spec.ts` creates a project, receives a deterministic agent edit draft, confirms the card, verifies the tree and saves the resulting node/member values.
- Passed: existing `e2e/t08-batch-history.spec.ts` continues to verify manual batch editing, undo and redo.

The deterministic provider fixture is a public-boundary replay. It does not claim a live DeepSeek agent evaluation; real AI联测 remains assigned to T2-11/T2-41.

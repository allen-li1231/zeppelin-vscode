# Notebook deletion and reload provenance

The extension propagates removal-only notebook edits to Zeppelin by captured
note/paragraph ID. Orphaned `NotebookCell` objects never authorize deletion.

## Reload ordering

Source inspection of VS Code establishes the ordering relied on here:

1. [`NotebookFileWorkingCopyModel.update`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/common/notebookEditorModel.ts)
   awaits serializer data, checks cancellation, then calls the model's `reset`.
2. [`NotebookTextModel.reset` and `applyEdits`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/common/model/notebookTextModel.ts)
   apply cell changes and document metadata together. The event emitter pauses
   during the edit and resumes after the batch. Transient metadata still emits
   a document-metadata event; it simply does not dirty the document.
3. [`MainThreadNotebookDocuments`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/mainThreadNotebookDocuments.ts)
   forwards the model changes and document metadata together.
   [`ExtHostNotebookDocument`](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostNotebookDocument.ts)
   exposes them as `contentChanges` (including `removedCells`) and `metadata`.

`ZeppelinSerializer` marks each successful deserialize with a monotonically
increasing generation before returning. Its returned metadata includes the
transient `__zeppelinReloadGeneration` token. Matching change batches settle
that specific generation but never delete paragraphs. Initial opens settle their
token in `onDidOpenNotebookDocument` and have no removals to propagate. Even a
reload with no cell changes settles through its metadata event. The token is
excluded from serialization and server imports.

## Conservative defaults

Until a load is accounted for, **all** removals are ambiguous globally because
the serializer receives no URI. An unrelated batch cannot consume its token.
Metadata-bearing batches, mixed additions/removals, programmatic edits under the
edit guard, missing IDs, closed notebooks, restored IDs, and structural conflicts
do not authorize deletion. Cancellation notifications settle their pending
signal; a late metadata-bearing batch is still suppressed. No timeout guesses
that a reload has finished. If VS Code abandons a deserialize without an open,
change, or cancellation notification, deletion stays suppressed for the session.
This intentionally trades a missed deletion for avoiding server data loss.

## Locking and stale snapshots

Deletion intent is recorded synchronously before waiting for `_updateMutex`.
The kernel rechecks identity, connection, reload generation, structural conflict,
and whether the paragraph has reappeared before issuing HTTP DELETE. A reload
while waiting invalidates intent even if that reload already settled. Pending
intent invalidates a sync snapshot fetched before the deletion. The successful
delete updates the structural base and notebook paragraph metadata under
`_updateMutex -> _editMutex` and `editWithoutParagraphUpdate`. Subsequent sync
fetches the server after DELETE completes.

Once an authorized DELETE is in flight, a later reload or undo cannot retract it;
Zeppelin has no conditional-delete/ETag support. Post-response guards avoid
applying metadata to a changed notebook. Live VS Code/Zeppelin integration was
not exercised; regression tests cover serializer tokens, event batches, and
controlled lock/network interleavings with the repository's VS Code mock.

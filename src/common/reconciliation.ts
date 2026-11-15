export type StructuralChange = 'unchanged' | 'remote-additions' | 'conflict';

/**
 * Classify ordered paragraph IDs, preserving the existing conservative policy.
 * Callers resolve positional ID-less creation matches before calling this helper.
 * `unchanged` means no structural reconciliation is required/proven, not that
 * all three lists are identical. Content reconciliation is handled separately.
 */
export function classifyStructuralChange(
    baseIds: readonly string[] | undefined,
    localIds: readonly (string | undefined)[],
    serverIds: readonly string[]
): StructuralChange {
    const same = (a: readonly (string | undefined)[], b: readonly (string | undefined)[]) =>
        a.length === b.length && a.every((id, index) => id === b[index]);

    // Without a base we cannot establish structural divergence. If both sides
    // already agree, even a removal/reorder relative to the base is resolved.
    if (baseIds === undefined || same(localIds, serverIds)) { return 'unchanged'; }

    // A base paragraph still on the server is missing locally: preserve the
    // local structure rather than silently re-inserting it. Deletion intent is
    // deliberately outside this classifier's remit.
    if (baseIds.some(id => serverIds.includes(id) && !localIds.includes(id))) {
        return 'conflict';
    }

    // Local additions/reorders alone do not constitute a remote change.
    if (same(baseIds, serverIds)) { return 'unchanged'; }

    // Only remote additions preserving every base ID in its original order
    // can fast-forward. A removal or reorder must preserve live cells instead.
    const retainedBaseIds = serverIds.filter(id => baseIds.includes(id));
    if (!same(retainedBaseIds, baseIds)) { return 'conflict'; }

    // Concurrent structural edits (including additions on both sides) need
    // reconciliation unless both sides already agree, handled above.
    if (!same(localIds, baseIds)) { return 'conflict'; }
    return 'remote-additions';
}

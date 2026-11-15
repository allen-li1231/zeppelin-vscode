import * as assert from 'assert';
import { classifyStructuralChange, StructuralChange } from '../../common/reconciliation';

describe('classifyStructuralChange', () => {
    const cases: [string, string[] | undefined, (string | undefined)[], string[], StructuralChange][] = [
        ['no change', ['a', 'b'], ['a', 'b'], ['a', 'b'], 'unchanged'],
        ['remote additions preserve order', ['a', 'b'], ['a', 'b'], ['x', 'a', 'y', 'b', 'z'], 'remote-additions'],
        ['remote removal', ['a', 'b'], ['a', 'b'], ['a'], 'conflict'],
        ['remote reorder', ['a', 'b'], ['a', 'b'], ['b', 'a'], 'conflict'],
        ['simultaneous additions', ['a'], ['a', 'local'], ['a', 'remote'], 'conflict'],
        ['simultaneous ID-less addition', ['a'], ['a', undefined], ['a', 'remote'], 'conflict'],
        ['already matching additions', ['a'], ['a', 'b'], ['a', 'b'], 'unchanged'],
        ['already matching removal', ['a', 'b'], ['a'], ['a'], 'unchanged'],
        ['already matching reorder', ['a', 'b'], ['b', 'a'], ['b', 'a'], 'unchanged'],
        ['local addition only', ['a'], ['a', undefined], ['a'], 'unchanged'],
        ['local removal must not be reinserted', ['a', 'b'], ['a'], ['a', 'b'], 'conflict'],
        ['empty base and remote additions', [], [], ['a'], 'remote-additions'],
        ['empty base and simultaneous additions', [], ['local'], ['remote'], 'conflict'],
        ['all empty', [], [], [], 'unchanged'],
        ['undefined base', undefined, ['local'], ['remote'], 'unchanged'],
    ];
    for (const [name, base, local, remote, expected] of cases) {
        it(name, () => assert.strictEqual(classifyStructuralChange(base, local, remote), expected));
    }
});

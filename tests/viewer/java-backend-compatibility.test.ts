import { describe, expect, it } from 'bun:test';
import { itemDeletedTarget, deleteFeedItem, removeLoadedRow } from '../../src/ui/viewer/utils/feed-deletion';
import { mergeAndDeduplicateByProject } from '../../src/ui/viewer/utils/data';
import { parseStoredStringList } from '../../src/ui/viewer/utils/stored-string-list';
import { sessionRefOf } from '../../src/ui/viewer/utils/sessions';
import { submitSettings } from '../../src/ui/viewer/hooks/useSettings';
import { DEFAULT_SETTINGS } from '../../src/ui/viewer/constants/settings';

const observationId = 'a42bf084-0eaa-446c-9d47-40b006d9ea5f';

describe('Java viewer compatibility without losing TypeScript IDs', () => {
  it('accepts UUID deletion events but not arbitrary string IDs', () => {
    expect(itemDeletedTarget({ type: 'item_deleted', itemType: 'observation', id: observationId }))
      .toEqual({ itemType: 'observation', id: observationId });
    for (const id of ['', '42', '../other', 'not-a-uuid']) {
      expect(itemDeletedTarget({ type: 'item_deleted', itemType: 'observation', id })).toBeNull();
    }
    expect(itemDeletedTarget({ type: 'item_deleted', itemType: 'observation', id: 42 }))
      .toEqual({ itemType: 'observation', id: 42 });
  });

  it('deduplicates and removes UUID rows', () => {
    const rows = [{ id: observationId }, { id: 42 }];
    expect(mergeAndDeduplicateByProject(rows, [{ id: observationId }])).toEqual(rows);
    expect(removeLoadedRow(rows, observationId)).toEqual({ rows: [{ id: 42 }], wasLoaded: true });
  });

  it('uses the content session ID when an imported summary has a distinct memory ID', () => {
    expect(sessionRefOf({ session_id: 'memory-123', content_session_id: 'content-456', platform_source: 'claude' }))
      .toEqual({ contentSessionId: 'content-456', platformSource: 'claude' });
  });

  it('uses UUIDs in the correct deletion endpoint', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (url, init) => {
      requestedUrl = String(url);
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await deleteFeedItem('observation', observationId, fetchImpl);
    expect(requestedUrl).toBe(`/api/observation/${observationId}`);
  });

  it('accepts metadata arrays as well as JSON-encoded arrays', () => {
    expect(parseStoredStringList(['fact', ' ', 'another fact'])).toEqual(['fact', 'another fact']);
    expect(parseStoredStringList('["fact", " ", "another fact"]')).toEqual(['fact', 'another fact']);
  });

  it('does not POST backend runtime metadata with writable settings', async () => {
    let saved: Record<string, unknown> = {};
    await submitSettings({ ...DEFAULT_SETTINGS, CLAUDE_MEM_BACKEND: 'java' }, {
      fetchImpl: (async (_url, init) => {
        saved = JSON.parse(String(init?.body));
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
      setSettings: () => {}, setSaveStatus: () => {}, setIsSaving: () => {},
    });
    expect(saved.CLAUDE_MEM_BACKEND).toBeUndefined();
    expect(saved.CLAUDE_MEM_CONTEXT_OBSERVATIONS).toBe(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS);
  });
});

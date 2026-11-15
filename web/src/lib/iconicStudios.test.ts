import { describe, expect, it } from 'vitest';
import { parseIconicStudios } from './iconicStudios';

describe('iconic studios', () => {
  it('keeps valid, named QIDs once and in Atlas order', () => {
    expect(
      parseIconicStudios({
        studios: [
          { id: 'Q159846', name: 'A24' },
          { id: 'Q159846', name: 'A24 duplicate' },
          { id: '159', name: 'No Q' },
          { id: 'Q2', name: '  ' },
          null,
        ],
      }),
    ).toEqual([{ id: 'Q159846', name: 'A24' }]);
    expect(parseIconicStudios({ studios: 'not a list' })).toEqual([]);
  });

  it('bounds the wire answer and omits unrepresentable names', () => {
    const studios = Array.from({ length: 140 }, (_, index) => ({
      id: `Q${index + 1}`,
      name: `Studio ${index + 1}`,
    }));
    studios.unshift({ id: 'Q999', name: 'x'.repeat(513) });
    expect(parseIconicStudios({ studios })).toHaveLength(128);
    expect(parseIconicStudios({ studios })[0]).toEqual({ id: 'Q1', name: 'Studio 1' });
  });
});

import { describe, expect, it } from 'vitest';
import { chipFor, NO_FACTS, parseTitleFacts, validTitleFacts } from './titleFacts';

const facts = parseTitleFacts({
  networks: [{ id: 'Q23589', name: 'Showtime', titles: 59 }],
  companies: [
    { id: 'Q16248298', name: 'A24', titles: 40 },
    { id: 'nope', name: 'Bad id' },
    { id: 'Q5', name: '  ' },
  ],
  subjects: [{ id: 'Q362', name: 'World War II', titles: 577 }],
  labels: { moods: ['Dark & Gritty', 7, ' ', 'Tense/Edge-of-seat'] },
  countries: ['ES', 'spain', 3],
});

describe('parseTitleFacts', () => {
  it('keeps well-formed values and drops the rest', () => {
    expect(facts.networks).toEqual([{ id: 'Q23589', name: 'Showtime', titles: 59 }]);
    expect(facts.companies).toEqual([{ id: 'Q16248298', name: 'A24', titles: 40 }]);
    expect(facts.subjects[0]?.name).toBe('World War II');
    expect(facts.places).toEqual([]);
    expect(facts.moods).toEqual(['Dark & Gritty', 'Tense/Edge-of-seat']);
    expect(facts.countries).toEqual(['ES']);
    expect(parseTitleFacts(null)).toEqual(NO_FACTS);
  });

  it('rejects values that cannot cross the bounded content-service wire', () => {
    expect(
      validTitleFacts({
        companies: [{ id: 'Q1', name: 'Studio', titles: -1 }],
      }),
    ).toBe(false);
    expect(validTitleFacts({ labels: { moods: Array(129).fill('Warm') } })).toBe(false);
    expect(validTitleFacts({ labels: { moods: ['x'.repeat(257)] } })).toBe(false);
    expect(validTitleFacts({ labels: { moods: [` ${'x'.repeat(255)} `] } })).toBe(false);
    expect(
      validTitleFacts({ companies: [{ id: `Q${'1'.repeat(64)}`, name: 'Studio', titles: 1 }] }),
    ).toBe(false);
    expect(
      validTitleFacts({
        companies: [{ id: 'Q1', name: 'Studio', titles: 1 }],
        labels: { moods: ['Warm'] },
        countries: ['SE'],
      }),
    ).toBe(true);
  });
});

describe('chipFor', () => {
  it('links TMDB’s name to atlas’s value by name, networks before companies', () => {
    expect(chipFor('Showtime', facts)).toBe('network-Q23589');
    expect(chipFor('a24', facts)).toBe('company-Q16248298');
    expect(chipFor('HBO', facts)).toBeUndefined();
  });
});

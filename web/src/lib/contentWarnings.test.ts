import { expect, it } from 'vitest';
import { parseWarnings } from './contentWarnings';

it('shows confirmed non-spoiler warnings, only the picked categories when any are picked', () => {
  const warning = (id: number, yes: number, no: number, extra = {}) => ({
    id,
    name: `Warning ${id}`,
    category: 'Animal Death',
    spoiler: false,
    yes,
    no,
    ...extra,
  });
  const body = {
    id: 10752,
    warnings: [
      warning(1, 5, 1),
      warning(2, 1, 0, { spoiler: true }),
      warning(3, 0, 0),
      warning(4, 1, 2),
      warning(5, 3, 0, { category: 'Sex' }),
    ],
  };
  expect(parseWarnings(body, ['Animal Death'])).toEqual([{ id: 1, label: 'Warning 1', votes: 5 }]);
  expect(parseWarnings(body, [])).toEqual([
    { id: 1, label: 'Warning 1', votes: 5 },
    { id: 5, label: 'Warning 5', votes: 3 },
  ]);
});

it('shows a repeated warning once, with its most yes votes', () => {
  const dog = (yes: number) => ({
    id: 153,
    name: 'a dog dies',
    category: 'Animal Death',
    yes,
    no: 1,
  });
  expect(parseWarnings({ id: 1, warnings: [dog(33), dog(34), dog(33)] }, [])).toEqual([
    { id: 153, label: 'a dog dies', votes: 34 },
  ]);
});

it('keeps the wire answer bounded and drops values it cannot represent', () => {
  const warnings = Array.from({ length: 140 }, (_, index) => ({
    id: index + 1,
    name: `Warning ${index + 1}`,
    yes: 200 - index,
    no: 0,
  }));
  warnings.unshift({ id: 999, name: 'x'.repeat(513), yes: 300, no: 0 });
  expect(parseWarnings({ warnings }, [])).toHaveLength(128);
  expect(parseWarnings({ warnings: [{ id: -1, name: 'Bad', yes: 2.5, no: 0 }] }, [])).toEqual([]);
  expect(parseWarnings({ warnings: [{ id: 1e20, name: 'Unsafe', yes: 2, no: 0 }] }, [])).toEqual(
    [],
  );
});

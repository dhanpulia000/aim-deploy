const { normalizePostImagePaths } = require('../issues.service');

describe('normalizePostImagePaths', () => {
  test('returns null for empty inputs', () => {
    expect(normalizePostImagePaths(null)).toBeNull();
    expect(normalizePostImagePaths(undefined)).toBeNull();
    expect(normalizePostImagePaths('')).toBeNull();
    expect(normalizePostImagePaths('   ')).toBeNull();
  });

  test('keeps non-empty string arrays', () => {
    expect(normalizePostImagePaths(['a.png', 'b.png'])).toEqual(['a.png', 'b.png']);
    expect(normalizePostImagePaths(['', '  ', 'a.png'])).toEqual(['a.png']);
  });

  test('parses JSON array string', () => {
    expect(normalizePostImagePaths('["a.png","b.png"]')).toEqual(['a.png', 'b.png']);
  });

  test('parses double-encoded JSON array string', () => {
    expect(normalizePostImagePaths('"[\\"a.png\\",\\"b.png\\"]"')).toEqual(['a.png', 'b.png']);
  });

  test('returns null for non-array JSON', () => {
    expect(normalizePostImagePaths('"nope"')).toBeNull();
    expect(normalizePostImagePaths('{"a":1}')).toBeNull();
  });
});


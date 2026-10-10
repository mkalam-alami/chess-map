import { describe, expect, it } from 'vitest';
import { ImportError } from '../../../src/application';
import { JsonMapFormat } from '../../../src/infrastructure/secondary/formats/JsonMapFormat';
import { pinnedOf } from '../../domain/fixtures';

describe('JsonMapFormat', () => {
  const format = new JsonMapFormat();
  const { session } = pinnedOf(['e4', 'e5']);

  it('describes the file it writes', () => {
    expect([format.id, format.extension, format.mimeType]).toEqual(['json', 'chessmap.json', 'application/json']);
  });

  it('reads back what it wrote, as a new map', () => {
    const [map, ...others] = format.read(format.write(session.repertoire));
    expect(others).toHaveLength(0);
    expect(map?.id).not.toBe(session.repertoire.id);
    expect(map?.data.nodes).toEqual(session.repertoire.data.nodes);
  });

  it('refuses text that is not a chess-map file with an ImportError', () => {
    expect(() => format.read('{"hello":"world"}')).toThrow(ImportError);
    expect(() => format.read('nope')).toThrow(ImportError);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Reads the JSON chunk of a binary glTF. */
function gltfJson(path: string) {
  const buf = readFileSync(path);
  expect(buf.toString('ascii', 0, 4)).toBe('glTF');
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + length)) as {
    animations?: { name: string }[];
    skins?: unknown[];
    extensionsUsed?: string[];
  };
}

describe('reaper.glb', () => {
  const json = gltfJson(new URL('../public/models/reaper.glb', import.meta.url).pathname);

  it('has a skin and every clip the scene plays', () => {
    expect(json.skins?.length).toBe(1);
    const clips = (json.animations ?? []).map((a) => a.name).sort();
    expect(clips).toEqual(
      ['gavel', 'glance', 'idle', 'inspect', 'nod', 'page', 'pen', 'polish', 'reject', 'stamp', 'tear', 'yawn'].sort(),
    );
  });

  it('uses meshopt compression only (decoder ships with three-stdlib; no Draco)', () => {
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(json.extensionsUsed ?? []).not.toContain('KHR_draco_mesh_compression');
  });
});

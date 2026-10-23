import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Color} from 'three';
import { Euler, Matrix4, Quaternion, Vector3, type BufferGeometry, type InstancedMesh } from 'three';

export interface InstanceSpec {
  matrix: Matrix4;
  color?: Color;
}

/** Instance buffers grow in powers of two so adding an item rarely recreates the mesh. */
export const capacityFor = (n: number) => Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

/**
 * One draw call for many copies of a geometry whose transforms only change when React props change.
 * (drei's <Instances> rewrites matrices every frame; this writes them once per change.)
 */
export function StaticInstances({
  geometry,
  items,
  children,
}: {
  geometry: BufferGeometry;
  items: readonly InstanceSpec[];
  /** The material. Per-instance `color` multiplies the material color. */
  children: ReactNode;
}) {
  const capacity = capacityFor(items.length);
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      if (item.color) mesh.setColorAt(i, item.color);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, capacity]);

  return (
    <instancedMesh key={capacity} ref={ref} args={[geometry, undefined, capacity]} frustumCulled={false}>
      {children}
    </instancedMesh>
  );
}

const ONE = new Vector3(1, 1, 1);

/** Compose position + Euler rotation (+ optional uniform scale) into a matrix. */
export function trs(
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
  scale?: readonly [number, number, number],
): Matrix4 {
  return new Matrix4().compose(
    new Vector3(...position),
    new Quaternion().setFromEuler(new Euler(...rotation)),
    scale ? new Vector3(...scale) : ONE,
  );
}

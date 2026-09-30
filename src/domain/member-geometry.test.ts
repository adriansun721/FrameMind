import { describe, expect, it } from "vitest";
import { calculateMemberGeometry } from "./member-geometry";

function expectVector(actual: { x: number; y: number; z: number }, expected: [number, number, number]) {
  expect([actual.x, actual.y, actual.z]).toEqual(expected.map((value) => expect.closeTo(value, 10)));
}

describe("member geometry", () => {
  it("uses global Z as the reference for a horizontal member", () => {
    const geometry = calculateMemberGeometry({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, 0);

    expect(geometry.length).toBe(4);
    expect(geometry.referenceAxis).toBe("global-z");
    expectVector(geometry.localX, [1, 0, 0]);
    expectVector(geometry.localY, [0, 1, 0]);
    expectVector(geometry.localZ, [0, 0, 1]);
  });

  it("uses global Y as the fallback for a vertical member", () => {
    const geometry = calculateMemberGeometry({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }, 0);

    expect(geometry.referenceAxis).toBe("global-y");
    expectVector(geometry.localX, [0, 0, 1]);
    expectVector(geometry.localY, [1, 0, 0]);
    expectVector(geometry.localZ, [0, 1, 0]);
  });

  it("rotates the section axes about local X using the entered angle", () => {
    const geometry = calculateMemberGeometry({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, 90);

    expect(geometry.length).toBeCloseTo(Math.sqrt(2), 10);
    expectVector(geometry.localY, [-Math.SQRT1_2, 0, Math.SQRT1_2]);
    expectVector(geometry.localZ, [0, -1, 0]);
  });

  it("rejects coincident endpoints", () => {
    expect(() => calculateMemberGeometry({ x: 2, y: 1, z: 3 }, { x: 2, y: 1, z: 3 }, 0)).toThrow(
      "杆件长度必须大于零",
    );
  });
});

import { describe, expect, it } from "vitest";
import { confirmedStickerFace, faceAtPoint } from "./stickerTarget";

const face = (id, x = 0.2) => ({ id, stale: false, landmarks: [{ x, y: 0.2 }, { x: x + 0.2, y: 0.4 }] });
const frame = () => ({ controller: { kind: "locked", handId: 1 }, faces: [face(7)],
  controllerTarget: { status: "confirmed", handId: 1, faceId: 7, observedAt: 200 } });

describe("sticker target gates", () => {
  it("only accepts fresh evidence for the current controller and live face", () => {
    const data = frame();
    expect(confirmedStickerFace(data, 550)).toBe(7);
    expect(confirmedStickerFace(data, 551)).toBeNull();
    expect(confirmedStickerFace(data, 199)).toBeNull();
    data.controller.handId = 2;
    expect(confirmedStickerFace(data, 200)).toBeNull();
    data.controller.handId = 1;
    data.faces[0].stale = true;
    expect(confirmedStickerFace(data, 200)).toBeNull();
  });
  it.each(["pending", "ambiguous", "unavailable"])("blocks sticker placement while %s", status => {
    const data = frame(); data.controllerTarget.status = status;
    expect(confirmedStickerFace(data, 200)).toBeNull();
  });
  it("requires an explicit unambiguous face hit for mouse selection", () => {
    expect(faceAtPoint([face(1), face(2, 0.6)], { x: 0.3, y: 0.3 })).toBe(1);
    expect(faceAtPoint([face(1), face(2)], { x: 0.3, y: 0.3 })).toBeNull();
    expect(faceAtPoint([face(1)], { x: 0.9, y: 0.3 })).toBeNull();
    expect(faceAtPoint([{ ...face(1), stale: true }], { x: 0.3, y: 0.3 })).toBeNull();
  });
});

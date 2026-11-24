import { describe, expect, it } from "vitest";
import { deriveProjectName, isAudioFile } from "./projectName";
import { formatTime } from "./format";

describe("deriveProjectName", () => {
  it.each([
    ["Summer Anthem.mp3", "Summer Anthem"],
    ["Summer Anthem v2.mp3", "Summer Anthem"],
    ["Summer Anthem_v12.mp3", "Summer Anthem"],
    ["Summer Anthem-v3.wav", "Summer Anthem"],
    ["Summer Anthem_master.mp3", "Summer Anthem"],
    ["Summer Anthem FINAL.mp3", "Summer Anthem"],
    ["Summer Anthem v2_master.mp3", "Summer Anthem"],
    ["Summer Anthem (1).mp3", "Summer Anthem"],
    ["Summer Anthem mixdown.mp3", "Summer Anthem"],
    ["C:\\Exports\\Remix Draft.mp3", "Remix Draft"],
    ["Mix.mp3", "Mix"],
    ["v2.mp3", "v2"],
    ["Remix.mp3", "Remix"],
    ["Mastermind.mp3", "Mastermind"],
  ])("%s -> %s", (input, expected) => {
    expect(deriveProjectName(input)).toBe(expected);
  });
});

describe("isAudioFile", () => {
  it("accepts mp3 and wav", () => {
    expect(isAudioFile("a.mp3")).toBe(true);
    expect(isAudioFile("a.WAV")).toBe(true);
  });
  it("rejects temp and other files", () => {
    expect(isAudioFile("a.flp")).toBe(false);
    expect(isAudioFile("a.mp3.part")).toBe(false);
    expect(isAudioFile("~a.mp3")).toBe(false);
    expect(isAudioFile(".a.mp3")).toBe(false);
  });
});

describe("formatTime", () => {
  it.each([
    [0, "0:00"],
    [134.7, "2:14"],
    [3725, "1:02:05"],
    [NaN, "0:00"],
  ])("%s -> %s", (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });
});

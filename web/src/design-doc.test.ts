import { describe, expect, it } from "vitest";
import designDoc from "../../DESIGN.md?raw";

describe("DESIGN.md", () => {
  it("documents the compact Wabi-Sabi design system contract", () => {
    expect(designDoc).toContain("visual_style: wabi-sabi");
    expect(designDoc).toContain("## Overview");
    expect(designDoc).toContain("## Colors");
    expect(designDoc).toContain("## Typography");
    expect(designDoc).toContain("## Layout");
    expect(designDoc).toContain("## Components");
    expect(designDoc).toContain("## Do's and Don'ts");
    expect(designDoc).toContain("compact");
    expect(designDoc).toContain("--tl-surface");
    expect(designDoc).toContain("--tl-primary");
  });
});

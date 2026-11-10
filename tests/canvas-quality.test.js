"use strict";
const assert = require("node:assert/strict");
require("../canvas-quality.js");

const api = globalThis.NGCanvasQuality;
assert.equal(typeof api?.resolve, "function");
assert.equal(api.DEFAULT_MAX_PIXELS, 2800000);

const phone = api.resolve(390, 844, 3, { maxDpr: 2 });
assert.equal(phone.dpr, 2, "ordinary phone dimensions should retain a crisp 2x backing scale");
assert.ok(phone.pixels <= phone.maxPixels);

const compactTablet = api.resolve(800, 600, 3, { maxDpr: 2.25 });
assert.equal(compactTablet.dpr, 2.25, "compact tablet view should retain the configured high-DPI ceiling");
const tablet = api.resolve(1024, 768, 2.5, { maxDpr: 2.25 });
assert.ok(tablet.limited && tablet.dpr < 2.25 && tablet.dpr > 1.8,
  "larger tablet buffers should lower density only as much as the memory budget requires");
assert.ok(tablet.pixels <= 2800000);

for (const [width, height, dpr] of [
  [1440, 900, 2],
  [1920, 1080, 2.25],
  [2560, 1440, 2.5],
  [3840, 2160, 3],
  [390, 720, 3]
]) {
  const result = api.resolve(width, height, dpr, { maxDpr: 2.25, maxPixels: 2800000, maxDimension: 8192 });
  assert.ok(result.backingWidth >= 1 && result.backingHeight >= 1);
  assert.ok(result.backingWidth <= 8192 && result.backingHeight <= 8192);
  assert.ok(result.pixels <= 2800000, width + "x" + height + " backing store must respect the pixel budget");
  assert.ok(result.dpr > 0 && Number.isFinite(result.dpr));
  assert.equal(result.pixels, result.backingWidth * result.backingHeight);
}

const huge = api.resolve(12000, 9000, 4, { maxPixels: 2800000, maxDimension: 8192 });
assert.ok(huge.backingWidth <= 8192 && huge.backingHeight <= 8192,
  "extreme displays must respect browser canvas dimension limits");
assert.ok(huge.pixels <= 2800000);

const zeroSize = api.resolve(0, -10, 2);
assert.ok(zeroSize.backingWidth >= 1 && zeroSize.backingHeight >= 1,
  "zero-sized viewports must still produce a valid minimal backing store");
const invalidDpr = api.resolve(400, 800, NaN);
assert.equal(invalidDpr.dpr, 1, "invalid device pixel ratios must fall back safely");

console.log("NEUROGENESIS canvas quality: phone/tablet sharpness, 4K memory budget, dimension cap and invalid viewport fallbacks passed.");

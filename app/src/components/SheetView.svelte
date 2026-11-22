<script lang="ts">
  // The current sheet's front and back as printed, drawn straight from the Layout: each side is an SVG
  // whose viewBox is the sheet in points, so engine rects are used as they are.
  import { onDestroy, untrack } from "svelte";
  import type { Layout, PagePlacement } from "../../../engine/src/index.ts";
  import type { PageBoxes } from "../lib/backend.ts";
  import { fittedStage, imageRectForPlacement, sheetTransform, sidesLayout, thumbnailWidth } from "../lib/sheet-geometry.ts";
  import { BitmapUrls } from "../lib/thumbnail-urls.ts";
  import { ThumbnailCache, previewFailure, startThumbnailWorker } from "../lib/thumbnails.ts";

  /** `boxes[i]` is PDF page i's boxes, which place its preview so the trim lands on the placement's content. */
  let { layout, pdf, boxes }: { layout: Layout; pdf: ArrayBuffer; boxes: PageBoxes[] } = $props();
  const uid = $props.id();

  const worker = startThumbnailWorker();
  const cache = new ThumbnailCache(worker);
  const urls = new BitmapUrls();
  let previewsUnavailable = $state(false);
  onDestroy(() => {
    worker.terminate();
    urls.clear();
  });

  // A cancel is routine and a single failed page keeps its number placeholder; only a dead cache
  // (the worker failed, or the PDF couldn't be opened) gets the note.
  function thumbnailFailed(error: unknown) {
    if (previewFailure(error) === "unavailable") previewsUnavailable = true;
  }

  // Declared before the thumbnail effect so the load reaches the worker before any render.
  $effect(() => {
    cache.load(pdf).catch(thumbnailFailed);
  });

  let chosen = $state(0);
  const count = $derived(layout.sheets.length);
  // When the sheet count shrinks below the chosen sheet, show the last one.
  const index = $derived(Math.min(chosen, count - 1));
  const sheet = $derived(layout.sheets[index]);

  function step(by: number) {
    chosen = Math.max(0, Math.min(count - 1, index + by));
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  }

  // The sides fill the space they're given, side by side or stacked, whichever shows the sheet larger.
  const GAP = 12;
  const CAPTION_GAP = 8;
  let areaWidth = $state(0);
  let areaHeight = $state(0);
  let captionHeight = $state(0);
  const sides = $derived(sidesLayout(layout.sheet, { width: areaWidth, height: areaHeight }, GAP, captionHeight + CAPTION_GAP));
  // Each stage hugs its sheet, so the caption sits right above it.
  const stage = $derived(fittedStage(layout.sheet, sides.stage));
  const t = $derived(sheetTransform(layout.sheet, stage));
  /** Sheet points per CSS pixel, for strokes and badges that keep their size on screen. */
  const px = $derived(1 / t.scale);

  /** Thumbnail URLs by 0-based PDF page, for the current sheet's pages. */
  let hrefs = $state.raw(new Map<number, string>());

  $effect(() => {
    if (!sheet || t.scale === 0) return;
    const placed = [...sheet.front.placements, ...sheet.back.placements].filter((p) => p.pdfPage !== null);
    const pages = new Set(placed.map((p) => p.pdfPage!));
    cache.cancelAllExcept(pages);
    urls.keepAtLeast(pages.size);
    untrack(() => {
      if ([...hrefs.keys()].some((page) => !pages.has(page))) {
        hrefs = new Map([...hrefs].filter(([page]) => pages.has(page)));
      }
    });
    const scale = t.scale;
    let current = true;
    for (const p of placed) {
      const page = p.pdfPage!;
      cache
        .get(page, thumbnailWidth(p, boxes[page]!, scale, window.devicePixelRatio || 1))
        .then((bitmap) => urls.url(bitmap))
        .then((url) => {
          if (current && hrefs.get(page) !== url) hrefs = new Map(hrefs).set(page, url);
        })
        .catch(thumbnailFailed);
    }
    return () => {
      current = false;
    };
  });

  function rotateAbout(p: PagePlacement): string | undefined {
    if (p.rotation === 0) return undefined;
    const { x, y, width, height } = p.content;
    return `rotate(${p.rotation} ${x + width / 2} ${y + height / 2})`;
  }
</script>

<svelte:window {onkeydown} />

{#snippet side(name: "front" | "back", label: string)}
  {@const placements = sheet![name].placements}
  <figure class="side" style:gap="{CAPTION_GAP}px">
    <figcaption bind:clientHeight={captionHeight}>{label}</figcaption>
    <div class="stage" style:width="{stage.width}px" style:height="{stage.height}px">
      {#if t.scale > 0}
        <svg
          data-testid="sheet-{name}"
          viewBox="0 0 {layout.sheet.width} {layout.sheet.height}"
          width={layout.sheet.width * t.scale}
          height={layout.sheet.height * t.scale}
          style:left="{t.offsetX}px"
          style:top="{t.offsetY}px"
        >
          <defs>
            <pattern id="{uid}-hatch-{name}" patternUnits="userSpaceOnUse" width={8 * px} height={8 * px} patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2={8 * px} class="hatch" stroke-width={2 * px} />
            </pattern>
            {#each placements as p, i (i)}
              <clipPath id="{uid}-clip-{name}-{i}">
                <rect x={p.clip.x} y={p.clip.y} width={p.clip.width} height={p.clip.height} />
              </clipPath>
            {/each}
          </defs>
          <rect class="paper" x="0" y="0" width={layout.sheet.width} height={layout.sheet.height} stroke-width={px} />
          {#each placements as p, i (i)}
            {#if p.pdfPage === null}
              <rect
                data-testid="blank-panel"
                x={p.panel.x}
                y={p.panel.y}
                width={p.panel.width}
                height={p.panel.height}
                fill="url(#{uid}-hatch-{name})"
              />
            {:else}
              {@const image = imageRectForPlacement(p, boxes[p.pdfPage]!)}
              <rect class="placeholder" x={p.panel.x} y={p.panel.y} width={p.panel.width} height={p.panel.height} />
              <!-- The clip is on a group: on the image it would turn with the image's rotation. -->
              <g clip-path="url(#{uid}-clip-{name}-{i})">
                <image
                  data-testid="placement-image"
                  data-pdf-page={p.pdfPage}
                  x={image.x}
                  y={image.y}
                  width={image.width}
                  height={image.height}
                  transform={rotateAbout(p)}
                  preserveAspectRatio="none"
                  href={hrefs.get(p.pdfPage)}
                />
              </g>
            {/if}
          {/each}
          {#if name === "front"}
            {#each sheet!.cutLines as l, i (i)}
              <line data-testid="cut-line" class="cut" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke-width={px} />
            {/each}
            {#each sheet!.foldLines as l, i (i)}
              <line
                data-testid="fold-line"
                data-opens-by-trim={l.opensByTrim}
                class="fold"
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                stroke-width={1.5 * px}
                stroke-dasharray={l.opensByTrim ? `${1.5 * px} ${3 * px}` : `${6 * px} ${4 * px}`}
              />
            {/each}
          {/if}
          {#each placements as p, i (i)}
            {#if p.pdfPage !== null}
              {@const label = String(p.pdfPage + 1)}
              <g data-testid="badge" data-side={name} data-pdf-page={p.pdfPage} class="badge">
                <rect
                  x={p.panel.x + 4 * px}
                  y={p.panel.y + 4 * px}
                  width={(8 + 7 * label.length) * px}
                  height={16 * px}
                  rx={3 * px}
                />
                <text x={p.panel.x + 8 * px} y={p.panel.y + 16 * px} font-size={11 * px}>{label}</text>
              </g>
            {/if}
          {/each}
        </svg>
      {/if}
    </div>
  </figure>
{/snippet}

<div class="sheet-view">
  {#if sheet}
    <div class="stepper" data-testid="sheet-stepper">
      <button type="button" aria-label="Previous sheet" data-testid="sheet-prev" disabled={index === 0} onclick={() => step(-1)}>←</button>
      <span>Sheet {index + 1} of {count}</span>
      <button type="button" aria-label="Next sheet" data-testid="sheet-next" disabled={index === count - 1} onclick={() => step(1)}>→</button>
    </div>
    <div class="sides" bind:clientWidth={areaWidth} bind:clientHeight={areaHeight} style:flex-direction={sides.direction} style:gap="{GAP}px">
      {@render side("front", "Front")}
      {@render side("back", "Back (as printed)")}
    </div>
    {#if previewsUnavailable}
      <p class="hint" data-testid="previews-unavailable">Page previews are unavailable</p>
    {/if}
  {:else}
    <p class="hint">No sheets to show until the settings are fixed.</p>
  {/if}
</div>

<style>
  .sheet-view {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .stepper {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
  }
  .stepper button {
    padding: var(--space-1) var(--space-3);
  }
  /* Sized by its parent, never by the stages inside it, which are sized from this measurement. */
  .sides {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .side {
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  figcaption {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .stage {
    position: relative;
  }
  svg {
    position: absolute;
    overflow: hidden;
  }
  .paper {
    fill: var(--surface);
    stroke: var(--line);
  }
  .placeholder {
    fill: var(--bg);
  }
  .hatch {
    stroke: var(--line);
  }
  .cut {
    stroke: var(--text);
  }
  .fold {
    stroke: var(--accent);
  }
  .badge rect {
    fill: var(--text);
    opacity: 0.75;
  }
  .badge text {
    fill: #fff;
    font-family: var(--font);
  }
</style>

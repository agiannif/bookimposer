<script lang="ts">
  // The current sheet's front and back as printed, drawn straight from the Layout: each side is an SVG
  // whose viewBox is the sheet in points, so engine rects are used as they are.
  import { onDestroy, untrack } from "svelte";
  import type { Layout, PagePlacement, Rotation } from "../../../engine/src/index.ts";
  import type { PageBoxes } from "../lib/backend.ts";
  import {
    badgeAnchor, fittedStage, imageRectForPlacement, markStrokes, sheetTransform, sideViews, sidesLayout, thumbnailWidth, viewSize, viewTransform,
  } from "../lib/sheet-geometry.ts";
  import { panelLabel } from "../lib/layout-view.ts";
  import { BitmapUrls } from "../lib/thumbnail-urls.ts";
  import { ThumbnailCache, previewFailure, startThumbnailWorker } from "../lib/thumbnails.ts";

  /**
   * `boxes[i]` is PDF page i's boxes, which place its preview so the trim lands on the placement's content.
   * `marks` says which marks the export draws, for showing them as exported.
   */
  let { layout, pdf, boxes, marks }: { layout: Layout; pdf: ArrayBuffer; boxes: PageBoxes[]; marks: { cut: boolean; fold: boolean } } = $props();
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

  /** Off shows the full cut and fold lines on both sides; on shows both sides' marks as the export prints them. */
  let marksAsExported = $state(false);

  // Each side turns so most of its own pages read upright. The user's turn adds to both sides and holds
  // while those defaults stay the same; when they change (other folds, other sheet), it is dropped.
  const defaults = $derived(sideViews(layout.sheets, 0));
  const defaultsKey = $derived(`${defaults.front} ${defaults.back}`);
  let picked = $state<{ base: string; turn: Rotation } | null>(null);
  const extraTurn = $derived(picked && picked.base === defaultsKey ? picked.turn : 0);
  function turn(by: 90 | 270) {
    picked = { base: defaultsKey, turn: ((extraTurn + by) % 360) as Rotation };
  }
  const views = $derived({
    front: ((defaults.front + extraTurn) % 360) as Rotation,
    back: ((defaults.back + extraTurn) % 360) as Rotation,
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
  // Sized from the front's view alone: every duplex flip leaves the back's view 0 or 180 degrees from the
  // front's, which shows the same size. A quarter turn between them would need both sizes here.
  const sides = $derived(sidesLayout(viewSize(layout.sheet, views.front), { width: areaWidth, height: areaHeight }, GAP, captionHeight + CAPTION_GAP));
  /**
   * How a side with view `view` is drawn: the turned sheet's size, the stage that hugs it (so the caption
   * sits right above it), its transform, and `px`, sheet points per CSS pixel for strokes and badges that
   * keep their size on screen.
   */
  function sideFit(view: Rotation) {
    const shown = viewSize(layout.sheet, view);
    const stage = fittedStage(shown, sides.stage);
    const t = sheetTransform(shown, stage);
    return { view, shown, stage, t, px: 1 / t.scale };
  }
  const fits = $derived({ front: sideFit(views.front), back: sideFit(views.back) });

  /** Thumbnail URLs by 0-based PDF page, for the current sheet's pages. */
  let hrefs = $state.raw(new Map<number, string>());

  $effect(() => {
    const scale = Math.max(fits.front.t.scale, fits.back.t.scale);
    if (!sheet || scale === 0) return;
    const placed = [...sheet.front.placements, ...sheet.back.placements].filter((p) => p.pdfPage !== null);
    const pages = new Set(placed.map((p) => p.pdfPage!));
    cache.cancelAllExcept(pages);
    urls.keepAtLeast(pages.size);
    untrack(() => {
      if ([...hrefs.keys()].some((page) => !pages.has(page))) {
        hrefs = new Map([...hrefs].filter(([page]) => pages.has(page)));
      }
    });
    let current = true;
    for (const p of placed) {
      const page = p.pdfPage!;
      cache
        .get(page, thumbnailWidth(p, boxes[page]!, scale, window.devicePixelRatio || 1))
        .then(async (bitmap) => {
          // A superseded run's bitmap would only push this run's URLs out of the cap.
          if (!current) return;
          const url = await urls.url(bitmap);
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
  {@const { view, shown, stage, t, px } = fits[name]}
  <figure class="side" style:gap="{CAPTION_GAP}px">
    <figcaption bind:clientHeight={captionHeight}>{label}</figcaption>
    <div class="stage" style:width="{stage.width}px" style:height="{stage.height}px">
      {#if t.scale > 0}
        <svg
          data-testid="sheet-{name}"
          viewBox="0 0 {shown.width} {shown.height}"
          width={shown.width * t.scale}
          height={shown.height * t.scale}
          style:left="{t.offsetX}px"
          style:top="{t.offsetY}px"
        >
          <g transform={viewTransform(layout.sheet, view)}>
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
              <!-- A blank leaf a board wraps is numbered like the board's pages; padding is not. -->
              <rect
                data-testid="blank-panel"
                data-leaf={panelLabel(layout, p) !== null}
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
          {#if marksAsExported}
            <!-- At least a pixel wide so a thin stroke stays visible; positions and dashes are the export's. -->
            {#each markStrokes(sheet![name].marks, marks, layout.markStyle) as m, i (i)}
              <line
                data-testid="mark"
                data-kind={m.kind}
                class="mark"
                x1={m.x1}
                y1={m.y1}
                x2={m.x2}
                y2={m.y2}
                stroke-width={Math.max(layout.markStyle.strokeWidth, px)}
                stroke-dasharray={m.dash?.join(" ")}
              />
            {/each}
          {:else}
            {#each sheet![name].guides.cut as l, i (i)}
              <line data-testid="cut-line" class="cut" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke-width={px} />
            {/each}
            {#each sheet![name].guides.fold as l, i (i)}
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
            {@const label = panelLabel(layout, p)}
            {#if label !== null}
              {@const anchor = badgeAnchor(p.panel, view)}
              <!-- Turned back against the view so the number reads upright, at the panel's corner that shows top left. -->
              <g
                data-testid="badge"
                data-side={name}
                data-pdf-page={p.pdfPage}
                class="badge"
                transform="translate({anchor.x} {anchor.y}) rotate({-view})"
              >
                <rect
                  x={4 * px}
                  y={4 * px}
                  width={(8 + 7 * label.length) * px}
                  height={16 * px}
                  rx={3 * px}
                />
                <text x={8 * px} y={16 * px} font-size={11 * px}>{label}</text>
              </g>
            {/if}
          {/each}
          </g>
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
      <span class="rotate">
        <button type="button" aria-label="Rotate view left" title="Rotate view left" data-testid="rotate-left" onclick={() => turn(270)}>↺</button>
        <button type="button" aria-label="Rotate view right" title="Rotate view right" data-testid="rotate-right" onclick={() => turn(90)}>↻</button>
        <button type="button" data-testid="rotate-reset" disabled={extraTurn === 0} onclick={() => (picked = null)}>Reset</button>
      </span>
      <label class="check"><input type="checkbox" bind:checked={marksAsExported} data-testid="marks-preview" /> Show marks as exported</label>
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
  /* Wraps between controls, never inside one, when the sheet area is narrow. */
  .stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2) var(--space-3);
    white-space: nowrap;
  }
  .rotate {
    display: flex;
    gap: var(--space-1);
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
    font-size: var(--text-sm);
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
    stroke: var(--control);
  }
  .placeholder {
    fill: var(--canvas);
  }
  .hatch {
    stroke: var(--line);
  }
  .cut {
    stroke: var(--text);
  }
  .fold {
    stroke: var(--fold-line);
  }
  .mark {
    stroke: var(--text);
  }
  .badge rect {
    fill: var(--text);
    opacity: 0.75;
  }
  .badge text {
    fill: var(--surface);
    font-family: var(--font);
  }
</style>

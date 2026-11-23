<script lang="ts">
  // Inside the Threlte canvas: the camera with orbit and zoom, the lights, and the book model, laid out for
  // the current (animated) spread position. The canvas renders on demand, so every change invalidates.
  import { T, useThrelte } from "@threlte/core";
  import { OrbitControls } from "@threlte/extras";
  import type { Texture } from "three";
  import type { BookFace } from "../../../assembler/assemble.ts";
  import type { BookModel } from "../lib/book-scene.ts";

  /** `painted` changes whenever a texture is painted, so faces pick up their new textures. */
  let { model, position, textureFor, painted, aspect }: {
    model: BookModel;
    position: number;
    textureFor: (face: BookFace) => Texture | null;
    painted: number;
    aspect: number;
  } = $props();

  const { invalidate } = useThrelte();

  $effect(() => {
    model.place(position);
    invalidate();
  });

  $effect(() => {
    void painted;
    model.setTextures(textureFor);
    invalidate();
  });

  const FOV = 35;
  // Far enough back to show the open book (two pages wide, one tall) in the panel, from a little below.
  const distance = $derived.by(() => {
    const half = Math.tan((FOV * Math.PI) / 360);
    return 1.15 * Math.max(0.5 / half, model.width / (half * Math.max(aspect, 0.1)));
  });
</script>

<T.PerspectiveCamera makeDefault position={[0, -0.3 * distance, distance]} fov={FOV} near={0.01} far={100}>
  <OrbitControls enablePan={false} minDistance={0.5} maxDistance={20} />
</T.PerspectiveCamera>
<T.AmbientLight intensity={1.8} />
<T.DirectionalLight position={[2, 3, 4]} intensity={1.2} />
<T is={model.group} dispose={false} />

<script lang="ts">
  // Indeterminate progress, modeled on VS Code's own editor/panel progress
  // bar: a 2px track with a sliding segment, flush with the top edge.
  interface Props {
    label?: string
  }
  let { label = 'Loading' }: Props = $props()
</script>

<div class="progress" role="progressbar" aria-label={label} aria-busy="true">
  <div class="bit"></div>
</div>

<style>
  .progress {
    position: absolute;
    inset: 0 0 auto 0;
    height: 2px;
    overflow: hidden;
    z-index: 20;
    pointer-events: none;
  }
  .bit {
    position: absolute;
    inset: 0 auto 0 0;
    width: 2%;
    background: var(--se-progress);
    animation: slide 4s linear infinite;
    will-change: transform;
  }
  @keyframes slide {
    0% {
      transform: translateX(0) scaleX(1);
    }
    50% {
      transform: translateX(2500%) scaleX(3);
    }
    100% {
      transform: translateX(4900%) scaleX(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bit {
      animation: none;
      width: 100%;
      opacity: 0.6;
    }
  }
</style>

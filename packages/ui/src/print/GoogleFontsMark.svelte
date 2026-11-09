<script lang="ts">
  // The Google Fonts mark, for the button that turns Google Fonts on and off in the print's font picker. The path is
  // Simple Icons' "Google Fonts" icon (CC0 1.0); the mark is a trademark of Google LLC, shown only to name that service.
  interface Props {
    size?: number
  }
  let { size = 16 }: Props = $props()
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false">
  <path d="M4 2.8A3.6 3.6 0 1 0 4 10a3.6 3.6 0 0 0 0-7.2zm7.6 0v18.4h7.2a5.2 5.2 0 1 1 0-10.4 4 4 0 1 1 0-8zm7.2 0v8a4 4 0 1 0 0-8zm0 8v10.4A5.2 5.2 0 0 0 24 16a5.2 5.2 0 0 0-5.2-5.2zm-7.7-7.206L0 21.199h8.8l2.3-3.64Z" />
</svg>

<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';
import { startAppUpdatePolling } from './services/appUpdate';

onLaunch(() => {
  void startAppUpdatePolling();
});
</script>

<template>
  <slot />
</template>

<style lang="scss">
page {
  min-height: 100%;
  background: #f2f8f8;
  color: #102a43;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
</style>

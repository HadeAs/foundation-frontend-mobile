<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { ContainerContentNode } from '../types/container';
import type { InventoryStatus } from '../types/inventory';

const props = defineProps<{
  nodes: ContainerContentNode[];
}>();

const expandedNodeIds = shallowRef<Set<string>>(new Set());
const visibleTreeRows = computed(() => {
  const rows: Array<{ id: string; level: number; node: ContainerContentNode }> = [];

  function append(nodes: ContainerContentNode[], level: number) {
    nodes.forEach((node) => {
      rows.push({ id: node.id, level, node });
      if (node.kind === 'container' && expandedNodeIds.value.has(node.id)) {
        append(node.children, level + 1);
      }
    });
  }

  append(props.nodes, 0);
  return rows;
});

function collectContainerNodeIds(nodes: ContainerContentNode[]) {
  const ids: string[] = [];

  nodes.forEach((node) => {
    if (node.kind !== 'container') {
      return;
    }

    ids.push(node.id);
    ids.push(...collectContainerNodeIds(node.children));
  });

  return ids;
}

function statusClass(status: InventoryStatus) {
  return {
    'node-status--normal': status === '正常',
    'node-status--locked': status === '锁定',
    'node-status--expired': status === '过期'
  };
}

function nodeIndent(level: number) {
  return `${level * 52}rpx`;
}

function isExpanded(node: ContainerContentNode) {
  return node.kind === 'container' && expandedNodeIds.value.has(node.id);
}

function toggleNode(node: ContainerContentNode) {
  if (node.kind !== 'container') {
    return;
  }

  const nextIds = new Set(expandedNodeIds.value);
  if (nextIds.has(node.id)) {
    nextIds.delete(node.id);
  } else {
    nextIds.add(node.id);
  }
  expandedNodeIds.value = nextIds;
}

watch(
  () => props.nodes,
  (nodes) => {
    expandedNodeIds.value = new Set(collectContainerNodeIds(nodes));
  },
  { immediate: true }
);
</script>

<template>
  <view class="container-tree">
    <view class="container-tree__title">层级内容</view>
    <view class="tree-root">
      <view
        v-for="row in visibleTreeRows"
        :key="row.id"
        class="tree-branch"
        :style="{ paddingLeft: nodeIndent(row.level) }"
      >
        <template v-if="row.node.kind === 'container'">
          <view class="tree-node tree-node--container" @tap="toggleNode(row.node)">
            <view
              class="tree-node__toggle"
              :class="{ 'tree-node__toggle--expanded': isExpanded(row.node) }"
            ></view>
            <view class="tree-node__body">
              <view class="tree-node__main">{{ row.node.container.code }}</view>
              <view class="tree-node__sub">
                {{ row.node.container.type }} · {{ row.node.children.length }} 项内容
              </view>
            </view>
          </view>
        </template>

        <template v-else>
          <view class="tree-node tree-node--inventory">
            <view class="tree-node__body">
              <view class="tree-node__main">{{ row.node.inventory.barcodeNo }}</view>
              <view class="tree-node__sub">
                {{ row.node.inventory.materialCode }} / {{ row.node.inventory.materialName }}
              </view>
              <view class="tree-node__meta">
                {{ row.node.inventory.quantity }}({{ row.node.inventory.unit }}) · {{ row.node.inventory.locationCode }}
              </view>
            </view>
            <view class="node-status" :class="statusClass(row.node.inventory.status)">
              {{ row.node.inventory.status }}
            </view>
          </view>
        </template>
      </view>

      <view v-if="nodes.length === 0" class="tree-empty">当前容器下暂无子容器或库存</view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.container-tree {
  margin-top: 20rpx;
  border: 2rpx solid #d8e2ef;
  border-radius: 8rpx;
  background: #ffffff;
}

.container-tree__title {
  min-height: 72rpx;
  padding: 0 24rpx;
  border-bottom: 2rpx solid #edf2f7;
  color: #102a43;
  font-size: 28rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
}

.tree-root {
  padding: 18rpx 20rpx 22rpx;
}

.tree-branch {
  margin-bottom: 14rpx;
}

.tree-branch:last-child {
  margin-bottom: 0;
}

.tree-node {
  min-height: 96rpx;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
}

.tree-node--container {
  background: #edf6ff;
  padding: 16rpx 20rpx 16rpx 0;
}

.tree-node--inventory {
  background: #f5f8fc;
  padding: 18rpx 20rpx 18rpx 0;
}

.tree-node__toggle {
  width: 72rpx;
  height: 72rpx;
  flex: none;
  position: relative;
}

.tree-node__toggle::before {
  content: "";
  position: absolute;
  left: 28rpx;
  top: 22rpx;
  width: 0;
  height: 0;
  border-top: 14rpx solid transparent;
  border-bottom: 14rpx solid transparent;
  border-left: 18rpx solid #123f7a;
}

.tree-node__toggle--expanded::before {
  left: 22rpx;
  top: 28rpx;
  border-left: 14rpx solid transparent;
  border-right: 14rpx solid transparent;
  border-top: 18rpx solid #123f7a;
  border-bottom: 0;
}

.tree-node__body {
  min-width: 0;
  flex: 1;
}

.tree-node__main {
  color: #102a43;
  font-size: 30rpx;
  font-weight: 800;
}

.tree-node__sub,
.tree-node__meta {
  margin-top: 8rpx;
  color: #64748b;
  font-size: 24rpx;
  line-height: 34rpx;
}

.node-status {
  flex: none;
  min-width: 92rpx;
  height: 48rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-status--normal {
  background: #dcfce7;
  color: #15803d;
}

.node-status--locked {
  background: #fee2e2;
  color: #b91c1c;
}

.node-status--expired {
  background: #fef3c7;
  color: #b45309;
}

.tree-empty {
  padding: 36rpx 0;
  text-align: center;
  color: #64748b;
  font-size: 26rpx;
}
</style>

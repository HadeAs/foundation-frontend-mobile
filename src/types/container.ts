import type { InventoryItem } from './inventory';

export type ContainerType = '托盘' | '周转箱' | '料架';

export interface ManagedContainer {
  id: string;
  code: string;
  type: ContainerType;
}

export interface ContainerInventoryNode {
  kind: 'inventory';
  id: string;
  inventory: InventoryItem;
}

export interface ContainerChildNode {
  kind: 'container';
  id: string;
  container: ManagedContainer;
  children: ContainerContentNode[];
}

export type ContainerContentNode = ContainerInventoryNode | ContainerChildNode;

export interface ContainerDetail {
  container: ManagedContainer;
  children: ContainerContentNode[];
}

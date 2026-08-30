import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

interface PageResult<T> {
  items: T[];
  hasMore: boolean;
}

interface UsePagedQueryOptions<T> {
  pageSize: number;
  fetchPage: (options: { page: number; pageSize: number; keyword: string }) => Promise<PageResult<T>>;
  fetchLatest?: (count: number) => Promise<T[]>;
  getId?: (item: T) => string;
  latestCount?: number;
  debounceMs?: number;
}

export function usePagedQuery<T>({
  pageSize,
  fetchPage,
  fetchLatest,
  getId,
  latestCount = 4,
  debounceMs = 260
}: UsePagedQueryOptions<T>) {
  const queryText = shallowRef('');
  const items = shallowRef<T[]>([]);
  const page = shallowRef(1);
  const hasMore = shallowRef(true);
  const initialLoading = shallowRef(false);
  const loadingMore = shallowRef(false);
  const refreshing = shallowRef(false);
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  function mergeUnique(nextItems: T[], currentItems: T[]) {
    if (!getId) {
      return [...nextItems, ...currentItems];
    }

    const existing = new Set(nextItems.map(getId));
    return [...nextItems, ...currentItems.filter((item) => !existing.has(getId(item)))];
  }

  async function loadFirstPage() {
    const currentRequestId = ++requestId;
    initialLoading.value = true;
    try {
      const result = await fetchPage({ page: 1, pageSize, keyword: queryText.value });
      if (currentRequestId !== requestId) {
        return;
      }

      items.value = result.items;
      page.value = 1;
      hasMore.value = result.hasMore;
    } finally {
      if (currentRequestId === requestId) {
        initialLoading.value = false;
      }
    }
  }

  async function loadNextPage() {
    if (loadingMore.value || initialLoading.value || refreshing.value || !hasMore.value) {
      return;
    }

    const currentRequestId = requestId;
    loadingMore.value = true;
    try {
      const nextPage = page.value + 1;
      const result = await fetchPage({ page: nextPage, pageSize, keyword: queryText.value });
      if (currentRequestId !== requestId) {
        return;
      }

      items.value = [...items.value, ...result.items];
      page.value = nextPage;
      hasMore.value = result.hasMore;
    } finally {
      if (currentRequestId === requestId) {
        loadingMore.value = false;
      }
    }
  }

  async function refreshLatest() {
    if (refreshing.value) {
      return;
    }

    const currentRequestId = ++requestId;
    refreshing.value = true;
    try {
      if (queryText.value.trim() || !fetchLatest) {
        const result = await fetchPage({ page: 1, pageSize, keyword: queryText.value });
        if (currentRequestId !== requestId) {
          return;
        }

        items.value = result.items;
        page.value = 1;
        hasMore.value = result.hasMore;
        return;
      }

      const latest = await fetchLatest(latestCount);
      if (currentRequestId !== requestId) {
        return;
      }

      items.value = mergeUnique(latest, items.value);
    } finally {
      if (currentRequestId === requestId) {
        refreshing.value = false;
      }
    }
  }

  function clearQuery() {
    queryText.value = '';
  }

  function setQuery(value: string) {
    queryText.value = value;
  }

  watch(queryText, () => {
    if (queryTimer) {
      clearTimeout(queryTimer);
    }

    queryTimer = setTimeout(() => {
      void loadFirstPage();
    }, debounceMs);
  });

  onMounted(() => {
    void loadFirstPage();
  });

  onBeforeUnmount(() => {
    if (queryTimer) {
      clearTimeout(queryTimer);
    }
  });

  return {
    queryText,
    items,
    hasMore,
    initialLoading,
    loadingMore,
    refreshing,
    clearQuery,
    setQuery,
    loadNextPage,
    refreshLatest
  };
}

export function memoryStorage(initialValues = {}, options = {}) {
  const values = new Map(Object.entries(initialValues));
  const getItemCalls = [];
  const setItemCalls = [];

  return {
    getItemCalls,
    setItemCalls,
    getItem(key) {
      getItemCalls.push(key);
      if (options.getItemError) {
        throw options.getItemError;
      }

      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      setItemCalls.push({ key, value });
      if (options.setItemError) {
        throw options.setItemError;
      }

      values.set(key, String(value));
    },
  };
}

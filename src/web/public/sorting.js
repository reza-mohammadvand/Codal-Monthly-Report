(function initializeCodalDashboardSorting(root) {
  function numericValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function compareNullableNumbers(left, right, direction = "asc") {
    const leftNumber = numericValue(left);
    const rightNumber = numericValue(right);
    if (leftNumber === null && rightNumber === null) return 0;
    if (leftNumber === null) return 1;
    if (rightNumber === null) return -1;
    if (leftNumber === rightNumber) return 0;
    if (direction === "desc") return leftNumber > rightNumber ? -1 : 1;
    return leftNumber < rightNumber ? -1 : 1;
  }

  root.CodalDashboardSorting = Object.freeze({ compareNullableNumbers });
}(globalThis));

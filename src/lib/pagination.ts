/**
 * Номера страниц для пейджера: первая, соседние с текущей, последняя. Пропуск без знака
 * читался как опечатка («1 2 4»), поэтому одну пропущенную страницу дописываем, а больше
 * одной отмечаем нулём: на его месте пейджер рисует многоточие.
 */
export function pageNumbers(page: number, pageCount: number): number[] {
  return [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((value) => value >= 1 && value <= pageCount)
    .sort((left, right) => left - right)
    .flatMap((number, index, list) => {
      const gap = index ? number - list[index - 1] : 1;
      return gap === 2 ? [number - 1, number] : gap > 2 ? [0, number] : [number];
    });
}

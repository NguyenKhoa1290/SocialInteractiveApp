// Tim cung mot cach trong danh sach ban be va popup them thanh vien.
export function matchesUserSearch(
  query: string,
  user: { userId: number; nickname: string; displayName: string },
): boolean {
  if (!query.trim()) return true;
  const term = query.trim().replace(/^[@#]+/, "").trim().toLocaleLowerCase();
  return term.length > 0 && (
    String(user.userId) === term ||
    user.nickname.toLocaleLowerCase().includes(term) ||
    user.displayName.toLocaleLowerCase().includes(term)
  );
}

/** Latin slug used for landing page URLs, e.g. "Kafr El Sheikh" -> "kafr-el-sheikh". */
export function slugify(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export const newId = (): string => crypto.randomUUID()
export const now = (): number => Date.now()

/** Common metadata for a brand-new record. */
export const fresh = () => {
  const t = now()
  return { created_at: t, updated_at: t, edited_at: null, deleted: false }
}

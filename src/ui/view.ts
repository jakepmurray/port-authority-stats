import { createContext, useContext } from 'react'

/**
 * How shared pages (dashboard, stats) are being shown: normally, or inside the
 * read-only team view, where links stay under #/team and edit controls are hidden.
 */
export interface View {
  readOnly: boolean
  /** Hash prefix for in-app links: '' normally, 'team/' in team view. */
  base: string
  /** Team view: the snapshot source, kept in shared dashboard links so they open for anyone. */
  src?: string | null
}
export const ViewContext = createContext<View>({ readOnly: false, base: '' })
export const useView = () => useContext(ViewContext)

import { permanentRedirect } from 'next/navigation'

/** `/reads` was the previous slug, and `/news`. */
export default function ReadsPage(): never {
  permanentRedirect('/articles')
}

import { permanentRedirect } from 'next/navigation'

/** `/news` was the original slug. */
export default function NewsPage(): never {
  permanentRedirect('/reads')
}

import { redirect } from 'next/navigation'

/** Relays moved into Settings. */
export default function RelaysPage(): never {
  redirect('/settings#relays-heading')
}

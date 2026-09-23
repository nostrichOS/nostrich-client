/** Opening a `<dialog>` without landing focus on its close button. */
export function openModal(dialog: HTMLDialogElement | null, focus?: HTMLElement | null): void {
  if (dialog === null || dialog.open) return
  dialog.showModal()
  // A named destination wins.
  const target = focus ?? dialog
  target.focus()
}
